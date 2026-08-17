<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminNotification;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\OrderTrackingEvent;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ProductRating;
use App\Models\Promotion;
use App\Support\OrderNotifier;
use App\Support\ReturnPresenter;
use DateTimeInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    private const PH_TIME_ZONE = 'Asia/Manila';

    private const ALLOWED_CUSTOMER_STAGES = ['to_pay', 'to_ship', 'to_receive', 'completed'];

    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    private const ALLOWED_PAYMENT_STATUSES = ['paid', 'pending', 'refunded'];

    private const STAGE_LABELS = [
        'to_pay' => 'To Pay',
        'to_ship' => 'To Ship',
        'to_receive' => 'To Receive',
        'completed' => 'Completed',
    ];

    private const LIFECYCLE_LABELS = [
        'incoming' => 'Incoming',
        'pending' => 'Pending',
        'rejected' => 'Rejected',
        'completed' => 'Completed',
    ];

    /**
     * Cached result of the optional `order_items.product_image_reference`
     * column check. Null means "not inspected yet".
     */
    private static ?bool $orderItemsHaveImageReference = null;

    public function customerStore(Request $request): JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'product_id' => 'nullable|integer|exists:products,id',
            'product_name' => 'required_without:items|string|max:180',
            'product_image' => 'nullable|string',
            'quantity' => 'required_without:items|integer|min:1|max:999',
            'unit_price' => 'nullable|numeric|min:0|max:9999999.99',
            'total_amount' => 'required_without:items|numeric|min:0|max:9999999.99',
            'items' => 'nullable|array|min:1',
            'items.*.product_id' => 'nullable|integer|exists:products,id',
            'items.*.product_name' => 'required_with:items|string|max:180',
            'items.*.product_image' => 'nullable|string',
            'items.*.quantity' => 'required_with:items|integer|min:1|max:999',
            'items.*.unit_price' => 'nullable|numeric|min:0|max:9999999.99',
            'items.*.line_total' => 'nullable|numeric|min:0|max:9999999.99',
            'payment_method' => 'required|string|max:30',
            'payment_reference' => 'nullable|string|max:180',
            'notes' => 'nullable|string|max:2000',
            'customer_name' => 'nullable|string|max:160',
            'customer_contact' => 'nullable|string|max:180',
            'courier_name' => 'nullable|string|max:120',
            'courier_tracking_no' => 'nullable|string|max:140',
            'location_name' => 'nullable|string|max:160',
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
        ]);

        $paymentMethod = $this->normalizePaymentMethod($validated['payment_method']);
        if ($paymentMethod === null) {
            return response()->json([
                'message' => 'Unsupported payment method. Allowed values are GCash, COP, and COD.',
            ], 422);
        }

        $customer = $request->user();
        $orderItems = $this->normalizeRequestedOrderItems($validated);

        if (count($orderItems) < 1) {
            return response()->json([
                'message' => 'At least one order item is required.',
            ], 422);
        }

        $quantity = array_reduce(
            $orderItems,
            fn (int $carry, array $item): int => $carry + max(1, (int) ($item['quantity'] ?? 1)),
            0,
        );

        $totalAmount = 0.0;

        if ($quantity < 1) {
            return response()->json([
                'message' => 'Invalid order quantity.',
            ], 422);
        }

        $paymentStatus = $paymentMethod === 'GCash' ? 'paid' : 'pending';
        $customerStage = $paymentStatus === 'paid' ? 'to_ship' : 'to_pay';

        try {
            $createdOrder = DB::transaction(function () use ($validated, $customer, $orderItems, $quantity, $paymentMethod, $paymentStatus, $customerStage): Order {
                $productIds = collect($orderItems)
                    ->pluck('product_id')
                    ->filter(fn ($id) => !is_null($id))
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values();

                $productsById = Product::query()
                    ->whereIn('id', $productIds)
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');

                $activePromotions = Promotion::query()->where('is_enabled', true)->get();
                $serverPricedItems = [];
                foreach ($orderItems as $lineItem) {
                    $product = !is_null($lineItem['product_id']) ? $productsById->get((int) $lineItem['product_id']) : null;
                    $basePrice = $product ? (float) $product->price : max(0, (float) ($lineItem['unit_price'] ?? 0));
                    $promotion = $product ? $activePromotions->filter(fn (Promotion $candidate) => $candidate->appliesTo($product))->sortByDesc('discount_percent')->first() : null;
                    $unitPrice = round($basePrice * (1 - (($promotion ? (int) $promotion->discount_percent : 0) / 100)), 2);
                    $lineItem['unit_price'] = $unitPrice;
                    $lineItem['line_total'] = round($unitPrice * max(1, (int) $lineItem['quantity']), 2);
                    $serverPricedItems[] = $lineItem;
                }
                $orderItems = $serverPricedItems;
                $totalAmount = round(array_reduce($orderItems, fn (float $carry, array $item): float => $carry + (float) $item['line_total'], 0.0), 2);

                foreach ($orderItems as $lineItem) {
                    $lineProductId = $lineItem['product_id'];
                    if (is_null($lineProductId)) {
                        continue;
                    }

                    $product = $productsById->get((int) $lineProductId);
                    if (!$product) {
                        throw new \RuntimeException('One or more products are no longer available. Please refresh and try again.');
                    }

                    $availableStock = max(0, (int) $product->stock);
                    $requestedQuantity = max(1, (int) $lineItem['quantity']);

                    if ($availableStock < $requestedQuantity) {
                        throw new \RuntimeException(
                            "Insufficient stock for product: {$product->name}. Available: {$availableStock}",
                        );
                    }
                }

                $order = Order::query()->create([
                    'order_no' => null,
                    'customer_id' => $customer?->id,
                    'customer_name' => $validated['customer_name']
                        ?? $customer?->name
                        ?? $customer?->username
                        ?? $customer?->email
                        ?? 'Customer',
                    'customer_contact' => $validated['customer_contact']
                        ?? $customer?->email
                        ?? 'N/A',
                    'quantity' => $quantity,
                    'subtotal' => $totalAmount,
                    'total' => $totalAmount,
                    'payment_method' => $paymentMethod,
                    'payment_reference' => $validated['payment_reference'] ?? $this->defaultPaymentReference($paymentMethod),
                    'lifecycle_status' => 'incoming',
                    'customer_stage' => $customerStage,
                    'notes' => $validated['notes'] ?? null,
                    'courier_name' => $validated['courier_name'] ?? 'J&T Express',
                    'courier_tracking_no' => $validated['courier_tracking_no'] ?? null,
                    'location_name' => $validated['location_name'] ?? null,
                    'last_known_lat' => $validated['latitude'] ?? null,
                    'last_known_lng' => $validated['longitude'] ?? null,
                ]);

                $order->order_no = $this->generateOrderNo((int) $order->id);
                $order->save();

                foreach ($orderItems as $lineItem) {
                    // Extract a lightweight image reference (URL) for fast
                    // customer-facing thumbnails without needing a separate
                    // image endpoint request.
                    $imageRef = $this->extractLightweightImageReference(
                        $lineItem['product_image'] ?? null,
                        $lineItem['product_id'] ?? null,
                        $productsById,
                    );

                    $itemAttributes = [
                        'order_id' => $order->id,
                        'product_id' => $lineItem['product_id'],
                        'product_name' => $lineItem['product_name'],
                        'product_image' => $lineItem['product_image'],
                        'unit_price' => $lineItem['unit_price'],
                        'quantity' => $lineItem['quantity'],
                        'line_total' => $lineItem['line_total'],
                    ];

                    // Only write the optimisation column when the database
                    // actually has it, so older schemas keep accepting orders.
                    if ($this->orderItemsHaveImageReference()) {
                        $itemAttributes['product_image_reference'] = $imageRef;
                    }

                    OrderItem::query()->create($itemAttributes);
                }

                foreach ($orderItems as $lineItem) {
                    $lineProductId = $lineItem['product_id'];
                    if (is_null($lineProductId)) {
                        continue;
                    }

                    $product = $productsById->get((int) $lineProductId);
                    if (!$product) {
                        continue;
                    }

                    $remainingStock = max(0, (int) $product->stock - (int) $lineItem['quantity']);
                    $product->stock = $remainingStock;
                    $product->stock_status = $remainingStock > 0 ? 'in_stock' : 'out_of_stock';
                    $product->save();
                }

                Payment::query()->create([
                    'order_id' => $order->id,
                    'payment_no' => $this->generatePaymentNo((int) $order->id),
                    'method' => $paymentMethod,
                    'reference' => $validated['payment_reference'] ?? $this->defaultPaymentReference($paymentMethod),
                    'amount' => $totalAmount,
                    'status' => $paymentStatus,
                    'paid_at' => $paymentStatus === 'paid' ? now() : null,
                ]);

                $trackingLabel = $this->buildOrderItemLabelFromRows($orderItems);

                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $customer?->id,
                    'stage' => 'to_pay',
                    'event_type' => 'system',
                    'title' => "Order placed: {$trackingLabel}",
                    'description' => 'Your order has been received and is currently being reviewed.',
                    'location_name' => $validated['location_name'] ?? null,
                    'latitude' => $validated['latitude'] ?? null,
                    'longitude' => $validated['longitude'] ?? null,
                    'occurred_at' => now(),
                    'metadata' => [
                        'lifecycle_status' => 'incoming',
                    ],
                ]);

                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $customer?->id,
                    'stage' => $customerStage,
                    'event_type' => 'system',
                    'title' => $paymentStatus === 'paid' ? 'Payment confirmed' : 'Awaiting payment confirmation',
                    'description' => $paymentStatus === 'paid'
                        ? 'Payment was confirmed and the order is queued for shipping.'
                        : 'Payment is pending. We will verify and continue processing your order shortly.',
                    'occurred_at' => now(),
                    'metadata' => [
                        'payment_status' => $paymentStatus,
                    ],
                ]);

                return $order;
            });

            $createdOrder->load([
                'items',
                'payment',
                'trackingEvents' => fn ($query) => $query->orderByDesc('occurred_at')->orderByDesc('id'),
            ]);

            // --- Admin/Staff Notification: New Order ---
            $customerName = $createdOrder->customer_name ?? 'A customer';
            $orderNoLabel = $createdOrder->order_no ?? "ORD-{$createdOrder->id}";
            $itemLabel = $this->buildOrderItemLabelFromOrder($createdOrder);
            $this->createAdminNotification(
                'order',
                "New Order: {$orderNoLabel}",
                "{$customerName} placed a new order for {$itemLabel}. Total: ₱" . number_format((float) $createdOrder->total, 2, '.', ','),
                ['order_id' => $createdOrder->id, 'order_no' => $orderNoLabel]
            );

            // --- Customer Email: Order Confirmed ---
            $emailHtml = $this->buildOrderEmailHtml(
                $createdOrder,
                'Your Order Has Been Received',
                "Hi {$customerName},\n\nThank you for placing your order with UCN-FMRC. We have received your order and it is currently under review. You will be notified once it has been processed.\n\nPlease keep your order number for your reference.",
                '#800000'
            );
            $this->sendCustomerOrderEmail($createdOrder, "Order Received – {$orderNoLabel}", $emailHtml);

            return response()->json([
                'message' => 'Order placed successfully.',
                'data' => $this->transformOrderDetail($createdOrder, false, true),
            ], 201);

        } catch (\Exception $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'Unable to place order at the moment.',
            ], 400);
        }
    }

    public function customerIndex(Request $request): Response|JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        $orders = Order::query()
            ->select([
                'id',
                'order_no',
                'customer_id',
                'customer_name',
                'customer_contact',
                'quantity',
                'total',
                'payment_method',
                'payment_reference',
                'lifecycle_status',
                'customer_stage',
                'notes',
                'courier_name',
                'courier_tracking_no',
                'location_name',
                'last_known_lat',
                'last_known_lng',
                'completed_at',
                'created_at',
                'updated_at',
            ])
            ->with([
                'items' => fn ($query) => $query
                    ->select($this->customerOrderItemColumns()),
                'payment:id,order_id,payment_no,method,reference,amount,status,paid_at',
                'latestTrackingEvent',
                'ratings:id,order_id,order_item_id,product_id,stars,feedback,media,is_anonymous,admin_reply,replied_at,created_at,updated_at',
                // Returns ride along with the orders so the Returns tab, the
                // per-order badges and the ETag all come from this one request.
                'returns' => fn ($query) => $query
                    ->where('is_archived', false)
                    ->with(['items', 'latestEvent'])
                    ->orderByDesc('id'),
            ])
            ->where('customer_id', $request->user()->id)
            ->orderBy('created_at', 'asc')
            ->get();

        $data = $orders
            ->map(fn (Order $order) => $this->transformOrderSummary($order, false, true))
            ->values();

        $returnRows = $orders
            ->flatMap(fn (Order $order) => $order->returns->map(function (OrderReturn $orderReturn) use ($order) {
                // The order is already in memory — hand it to the presenter so it
                // can print the order number without another query.
                $orderReturn->setRelation('order', $order);

                return ReturnPresenter::summary($orderReturn, false);
            }))
            ->values()
            ->all();

        // Open requests first (they need the customer's attention), newest first.
        usort($returnRows, function (array $left, array $right): int {
            $leftOpen = $left['status_group'] === 'open' ? 0 : 1;
            $rightOpen = $right['status_group'] === 'open' ? 0 : 1;

            return $leftOpen <=> $rightOpen ?: (int) $right['id'] <=> (int) $left['id'];
        });

        $counts = [
            'all'         => $data->count(),
            'to_pay'      => $data->where('customer_stage', 'to_pay')->where('lifecycle_status', '!=', 'rejected')->count(),
            'to_ship'     => $data->where('customer_stage', 'to_ship')->where('lifecycle_status', '!=', 'rejected')->count(),
            'to_receive'  => $data->where('customer_stage', 'to_receive')->where('lifecycle_status', '!=', 'rejected')->count(),
            'completed'   => $data->where('customer_stage', 'completed')->where('lifecycle_status', '!=', 'rejected')->count(),
            'to_rate'     => $data->where('customer_stage', 'completed')->where('lifecycle_status', '!=', 'rejected')->where('has_rating', false)->count(),
            'returns'     => count($returnRows),
            'returns_open' => count(array_filter($returnRows, fn (array $row) => $row['status_group'] === 'open')),
        ];

        $payload = [
            'data' => $data,
            'counts' => $counts,
            'returns' => $returnRows,
            'return_window_days' => OrderReturn::WINDOW_DAYS,
        ];
        $etag = '"' . hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) . '"';
        $responseHeaders = [
            'Cache-Control' => 'private, no-cache, must-revalidate',
            'ETag' => $etag,
            'Vary' => 'Authorization',
        ];

        if (trim((string) $request->header('If-None-Match')) === $etag) {
            return response('', 304, $responseHeaders);
        }

        return response()->json($payload)->withHeaders($responseHeaders);
    }

    public function customerShow(Request $request, Order $order): Response|JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        if ((int) $order->customer_id !== (int) $request->user()->id) {
            return response()->json([
                'message' => 'You are not allowed to access this order.',
            ], 403);
        }

        $order->load([
            'items' => fn ($query) => $query
                ->select($this->customerOrderItemColumns()),
            'payment',
            'latestTrackingEvent',
            'ratings',
            'returns' => fn ($query) => $query
                ->where('is_archived', false)
                ->with(['items', 'latestEvent'])
                ->orderByDesc('id'),
            'trackingEvents' => fn ($query) => $query->orderByDesc('occurred_at')->orderByDesc('id'),
        ]);

        $payload = [
            'data' => $this->transformOrderDetail($order, false, true),
        ];
        $etag = '"' . hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) . '"';
        $responseHeaders = [
            'Cache-Control' => 'private, no-cache, must-revalidate',
            'ETag' => $etag,
            'Vary' => 'Authorization',
        ];

        if (trim((string) $request->header('If-None-Match')) === $etag) {
            return response('', 304, $responseHeaders);
        }

        return response()->json($payload)->withHeaders($responseHeaders);
    }

    public function customerItemImage(Request $request, Order $order, int|string $orderItem): Response|JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        // Do not use implicit OrderItem model binding here. It selects the
        // multi-megabyte product_image snapshot before we know whether a small
        // cached thumbnail can satisfy the request.
        $item = OrderItem::query()
            ->select(['id', 'order_id', 'updated_at'])
            ->find($orderItem);

        if (!$item) {
            return response()->json([
                'message' => 'Order image is unavailable.',
            ], 404);
        }

        if (
            (int) $order->customer_id !== (int) $request->user()->id ||
            (int) $item->order_id !== (int) $order->id
        ) {
            return response()->json([
                'message' => 'You are not allowed to access this order image.',
            ], 403);
        }

        if ($request->boolean('thumbnail')) {
            $cachedThumbnail = $this->readCachedOrderItemThumbnail($item);
            if ($cachedThumbnail !== null) {
                return $this->orderImageResponse($request, ...$cachedThumbnail);
            }
        }

        // Fetch the large snapshot only for a full-image request or the first
        // thumbnail request that still needs to build its persistent cache.
        $storedImage = OrderItem::query()
            ->whereKey($item->id)
            ->value('product_image');
        $decoded = $this->decodeStoredProductImage($storedImage);
        if ($decoded === null) {
            return response()->json([
                'message' => 'Order image is unavailable.',
            ], 404);
        }

        [$imageBytes, $mimeType] = $decoded;

        if ($request->boolean('thumbnail')) {
            $thumbnail = $this->buildOrderItemThumbnail($imageBytes, $item);
            if ($thumbnail !== null) {
                [$imageBytes, $mimeType] = $thumbnail;
            }
        }

        return $this->orderImageResponse($request, $imageBytes, $mimeType);
    }

    private function orderImageResponse(Request $request, string $imageBytes, string $mimeType): Response
    {
        $etag = '"' . hash('sha256', $imageBytes) . '"';
        $headers = [
            'Cache-Control' => 'private, max-age=86400, immutable',
            'Content-Length' => (string) strlen($imageBytes),
            'Content-Type' => $mimeType,
            'ETag' => $etag,
            'Vary' => 'Authorization',
        ];

        if (trim((string) $request->header('If-None-Match')) === $etag) {
            return response('', 304, $headers);
        }

        return response($imageBytes, 200, $headers);
    }

    /** Customer marks an order as received — moves it from to_receive → completed */
    public function customerMarkReceived(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        if ((int) $order->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'You are not allowed to update this order.'], 403);
        }

        if ($order->customer_stage !== 'to_receive') {
            return response()->json(['message' => 'Only orders in "To Receive" status can be marked as received.'], 422);
        }

        if ($order->lifecycle_status === 'rejected') {
            return response()->json(['message' => 'Rejected orders cannot be updated.'], 422);
        }

        $order->customer_stage = 'completed';
        $order->lifecycle_status = 'completed';
        $order->completed_at = Carbon::now();
        $order->save();

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()->id,
            'stage'              => 'completed',
            'event_type'         => 'system',
            'title'              => 'Order Received',
            'description'        => 'Customer confirmed receipt of the order.',
            'occurred_at'        => now(),
            'metadata'           => ['source' => 'customer_received'],
        ]);

        $order->load([
            'items' => fn ($query) => $query
                ->select($this->customerOrderItemColumns()),
            'payment',
            'latestTrackingEvent',
            'ratings',
            'returns' => fn ($query) => $query
                ->where('is_archived', false)
                ->with(['items', 'latestEvent'])
                ->orderByDesc('id'),
            'trackingEvents' => fn ($query) => $query->orderByDesc('occurred_at')->orderByDesc('id'),
        ]);

        return response()->json([
            'message' => 'Order marked as received.',
            'data'    => $this->transformOrderDetail($order, false, true),
        ]);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $orders = Order::query()
            ->with([
                'items:id,order_id,product_id,product_name,unit_price,quantity,line_total',
                'payment:id,order_id,payment_no,method,reference,amount,status,paid_at',
                'latestTrackingEvent',
            ])
            ->where('is_archived', false)
            ->orderBy('created_at', 'asc')
            ->get();

        $mapped = $orders->map(
            fn (Order $order) => $this->transformOrderSummary($order, false)
        );

        $incoming = $mapped->where('lifecycle_status', 'incoming')->values();
        $directory = $mapped->where('lifecycle_status', '!=', 'incoming')->values();

        $payments = $orders
            ->map(function (Order $order) {
                if (!$order->payment) {
                    return null;
                }

                return $this->transformPaymentRow($order);
            })
            ->filter()
            ->values();

        // Returns ride along with the orders payload so the Returns & Refunds
        // panel renders inside the same syncOrders() pass (and the same poll).
        $returns = OrderReturn::query()
            ->with([
                'order:id,order_no,customer_name,customer_contact,total,payment_method,customer_stage,lifecycle_status,completed_at',
                'items',
                'customer:id,name,email',
                'handler:id,name,role',
                'latestEvent',
            ])
            ->where('is_archived', false)
            ->orderByDesc('id')
            ->get()
            ->map(fn (OrderReturn $orderReturn) => ReturnPresenter::summary($orderReturn, true))
            ->values();

        $returnsSummary = [
            'total'       => $returns->count(),
            'requested'   => $returns->where('status', 'requested')->count(),
            'in_progress' => $returns
                ->whereIn('status', ['approved', 'item_in_transit', 'item_received', 'refund_processing'])
                ->count(),
            'refunded'    => $returns->where('status', 'refunded')->count(),
            'rejected'    => $returns->where('status', 'rejected')->count(),
            'cancelled'   => $returns->where('status', 'cancelled')->count(),
            'open'        => $returns->where('status_group', 'open')->count(),
            'refunded_amount' => round(
                (float) $returns->sum(fn (array $row) => (float) ($row['refunded_amount'] ?? 0)),
                2,
            ),
        ];

        return response()->json([
            'incoming' => $incoming,
            'directory' => $directory,
            'payments' => $payments,
            'returns' => $returns,
            'returns_summary' => $returnsSummary,
            'return_window_days' => OrderReturn::WINDOW_DAYS,
            'generated_at' => $this->formatPhilippineIso(now()),
        ]);
    }

    public function adminShow(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $order->load([
            'items',
            'payment',
            'trackingEvents' => fn ($query) => $query->orderByDesc('occurred_at')->orderByDesc('id'),
        ]);

        return response()->json([
            'data' => $this->transformOrderDetail($order),
        ]);
    }

    public function approveBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdmin($request)) {
            return $denied;
        }

        $ids = $this->validatedBulkIds($request);
        $processedIds = DB::transaction(function () use ($request, $ids): array {
            $orders = Order::query()
                ->with(['payment', 'items', 'customer'])
                ->whereIn('id', $ids)
                ->where('is_archived', false)
                ->where('lifecycle_status', 'incoming')
                ->lockForUpdate()
                ->get();

            foreach ($orders as $order) {
                $paymentStatus = $order->payment?->status;
                $nextCustomerStage = $paymentStatus === 'paid' ? 'to_ship' : $order->customer_stage;
                if (!in_array($nextCustomerStage, self::ALLOWED_CUSTOMER_STAGES, true)) {
                    $nextCustomerStage = 'to_pay';
                }

                $order->lifecycle_status = 'pending';
                $order->customer_stage = $nextCustomerStage;
                $order->approved_at = Carbon::now();
                $order->save();

                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $request->user()?->id,
                    'stage' => $order->customer_stage,
                    'event_type' => 'admin_update',
                    'title' => 'Order approved',
                    'description' => 'Your order has been confirmed and is now being processed.',
                    'occurred_at' => now(),
                    'metadata' => ['lifecycle_status' => 'pending'],
                ]);

                $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
                $this->createAdminNotification(
                    'success',
                    "Order Approved: {$orderNoLabel}",
                    "Order {$orderNoLabel} for {$order->customer_name} has been approved and moved to pending processing.",
                    ['order_id' => $order->id, 'order_no' => $orderNoLabel]
                );

                $emailHtml = $this->buildOrderEmailHtml(
                    $order,
                    'Your Order Has Been Approved',
                    "Hi {$order->customer_name},\n\nGreat news! Your order {$orderNoLabel} has been approved and is now being processed. We will update you again once your order is ready for shipping or pickup.",
                    '#059669'
                );
                $this->sendCustomerOrderEmail($order, "Order Approved – {$orderNoLabel}", $emailHtml);
            }

            return $orders->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
        });

        if (!$processedIds) {
            return response()->json(['message' => 'No incoming orders were found to approve.'], 404);
        }

        return $this->bulkActionResponse('approve', 'incoming_orders', $ids, $processedIds);
    }

    public function rejectBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdmin($request)) {
            return $denied;
        }

        $ids = $this->validatedBulkIds($request);
        $processedIds = DB::transaction(function () use ($request, $ids): array {
            $orders = Order::query()
                ->with(['payment', 'items', 'customer'])
                ->whereIn('id', $ids)
                ->where('is_archived', false)
                ->where('lifecycle_status', 'incoming')
                ->lockForUpdate()
                ->get();

            foreach ($orders as $order) {
                $order->lifecycle_status = 'rejected';
                $order->rejected_at = Carbon::now();
                $order->save();

                $genericReason = 'Your order could not be processed at this time.';
                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $request->user()?->id,
                    'stage' => $order->customer_stage,
                    'event_type' => 'admin_update',
                    'title' => 'Order rejected',
                    'description' => $genericReason,
                    'occurred_at' => now(),
                    'metadata' => ['lifecycle_status' => 'rejected'],
                ]);

                $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
                $this->createAdminNotification(
                    'warning',
                    "Order Rejected: {$orderNoLabel}",
                    "Order {$orderNoLabel} for {$order->customer_name} was rejected. Reason: No reason provided",
                    ['order_id' => $order->id, 'order_no' => $orderNoLabel]
                );

                $emailHtml = $this->buildOrderEmailHtml(
                    $order,
                    'Your Order Could Not Be Processed',
                    "Hi {$order->customer_name},\n\nUnfortunately, your order {$orderNoLabel} could not be processed at this time.\n\nReason: No reason provided\n\nIf you have questions, please contact us directly or place a new order. We apologize for any inconvenience.",
                    '#dc2626'
                );
                $this->sendCustomerOrderEmail($order, "Order Update – {$orderNoLabel}", $emailHtml);
            }

            return $orders->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
        });

        if (!$processedIds) {
            return response()->json(['message' => 'No incoming orders were found to reject.'], 404);
        }

        return $this->bulkActionResponse('reject', 'incoming_orders', $ids, $processedIds);
    }

    public function approve(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        if ($order->lifecycle_status !== 'incoming') {
            return response()->json([
                'message' => 'Only incoming orders can be approved.',
            ], 422);
        }

        $paymentStatus = $order->payment?->status;
        $nextCustomerStage = $paymentStatus === 'paid' ? 'to_ship' : $order->customer_stage;

        if (!in_array($nextCustomerStage, self::ALLOWED_CUSTOMER_STAGES, true)) {
            $nextCustomerStage = 'to_pay';
        }

        $order->lifecycle_status = 'pending';
        $order->customer_stage = $nextCustomerStage;
        $order->approved_at = Carbon::now();
        $order->save();

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => $order->customer_stage,
            'event_type' => 'admin_update',
            'title' => 'Order approved',
            'description' => 'Your order has been confirmed and is now being processed.',
            'occurred_at' => now(),
            'metadata' => [
                'lifecycle_status' => 'pending',
            ],
        ]);

        $order->load(['items', 'payment', 'latestTrackingEvent']);

        // --- Admin/Staff Notification: Order Approved ---
        $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
        $this->createAdminNotification(
            'success',
            "Order Approved: {$orderNoLabel}",
            "Order {$orderNoLabel} for {$order->customer_name} has been approved and moved to pending processing.",
            ['order_id' => $order->id, 'order_no' => $orderNoLabel]
        );

        // --- Customer Email: Order Approved ---
        $emailHtml = $this->buildOrderEmailHtml(
            $order,
            'Your Order Has Been Approved',
            "Hi {$order->customer_name},\n\nGreat news! Your order {$orderNoLabel} has been approved and is now being processed. We will update you again once your order is ready for shipping or pickup.",
            '#059669'
        );
        $this->sendCustomerOrderEmail($order, "Order Approved – {$orderNoLabel}", $emailHtml);

        return response()->json([
            'message' => 'Order approved successfully.',
            'data' => $this->transformOrderSummary($order),
        ]);
    }

    public function reject(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'reason' => 'nullable|string|max:500',
        ]);

        if (!in_array($order->lifecycle_status, ['incoming', 'pending'], true)) {
            return response()->json([
                'message' => 'Only incoming or pending orders can be rejected.',
            ], 422);
        }

        $order->lifecycle_status = 'rejected';
        $order->rejected_at = Carbon::now();
        if (!empty($validated['reason'])) {
            $order->notes = trim(($order->notes ? $order->notes . "\n\n" : '') . 'Rejection reason: ' . $validated['reason']);
        }
        $order->save();

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => $order->customer_stage,
            'event_type' => 'admin_update',
            'title' => 'Order rejected',
            'description' => $validated['reason'] ?? 'Your order could not be processed at this time.',
            'occurred_at' => now(),
            'metadata' => [
                'lifecycle_status' => 'rejected',
            ],
        ]);

        $order->load(['items', 'payment', 'latestTrackingEvent']);

        // --- Admin/Staff Notification: Order Rejected ---
        $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
        $reason = $validated['reason'] ?? 'No reason provided';
        $this->createAdminNotification(
            'warning',
            "Order Rejected: {$orderNoLabel}",
            "Order {$orderNoLabel} for {$order->customer_name} was rejected. Reason: {$reason}",
            ['order_id' => $order->id, 'order_no' => $orderNoLabel]
        );

        // --- Customer Email: Order Rejected ---
        $emailHtml = $this->buildOrderEmailHtml(
            $order,
            'Your Order Could Not Be Processed',
            "Hi {$order->customer_name},\n\nUnfortunately, your order {$orderNoLabel} could not be processed at this time.\n\nReason: {$reason}\n\nIf you have questions, please contact us directly or place a new order. We apologize for any inconvenience.",
            '#dc2626'
        );
        $this->sendCustomerOrderEmail($order, "Order Update – {$orderNoLabel}", $emailHtml);

        return response()->json([
            'message' => 'Order rejected successfully.',
            'data' => $this->transformOrderSummary($order),
        ]);
    }

    public function complete(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        if (!in_array($order->lifecycle_status, ['pending', 'completed'], true)) {
            return response()->json([
                'message' => 'Only pending orders can be marked as completed.',
            ], 422);
        }

        $order->lifecycle_status = 'completed';
        $order->customer_stage = 'completed';
        $order->completed_at = Carbon::now();
        $order->save();

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => 'completed',
            'event_type' => 'admin_update',
            'title' => 'Order completed',
            'description' => 'Your order has been fulfilled and is now complete. Thank you for your purchase!',
            'occurred_at' => now(),
            'metadata' => [
                'lifecycle_status' => 'completed',
            ],
        ]);

        $order->load(['items', 'payment', 'latestTrackingEvent']);

        // --- Admin/Staff Notification: Order Completed ---
        $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
        $this->createAdminNotification(
            'success',
            "Order Completed: {$orderNoLabel}",
            "Order {$orderNoLabel} for {$order->customer_name} has been marked as completed. Total collected: ₱" . number_format((float) $order->total, 2, '.', ','),
            ['order_id' => $order->id, 'order_no' => $orderNoLabel]
        );

        // --- Customer Email: Order Completed ---
        $emailHtml = $this->buildOrderEmailHtml(
            $order,
            'Your Order Is Complete!',
            "Hi {$order->customer_name},\n\nYour order {$orderNoLabel} has been marked as completed. Thank you for choosing UCN-FMRC!\n\nWe hope to serve you again. If you have any feedback, feel free to reach out to us.",
            '#800000'
        );
        $this->sendCustomerOrderEmail($order, "Order Completed – {$orderNoLabel}", $emailHtml);

        return response()->json([
            'message' => 'Order marked as completed.',
            'data' => $this->transformOrderSummary($order),
        ]);
    }

    public function archiveBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'source' => ['required', 'string', Rule::in(['rejected', 'payments'])],
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $source = $validated['source'];
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();
        $archivedAt = Carbon::now();

        $processedIds = DB::transaction(function () use ($source, $ids, $archivedAt): array {
            $query = Order::query()
                ->whereIn('id', $ids)
                ->where('is_archived', false);

            if ($source === 'rejected') {
                $query->where('lifecycle_status', 'rejected');
            } else {
                $query
                    ->where('lifecycle_status', 'completed')
                    ->whereHas('payment');
            }

            $eligibleIds = (clone $query)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($eligibleIds) {
                Order::query()->whereIn('id', $eligibleIds)->where('is_archived', false)->update([
                    'is_archived' => true,
                    'archived_at' => $archivedAt,
                    'updated_at' => now(),
                ]);
            }

            return $eligibleIds;
        });

        if (!$processedIds) {
            return response()->json([
                'message' => $source === 'rejected'
                    ? 'No rejected orders were found to archive.'
                    : 'No payment records with active orders were found to archive.',
            ], 404);
        }

        return $this->bulkActionResponse(
            'archive',
            $source === 'rejected' ? 'rejected_orders' : 'payments',
            $ids,
            $processedIds
        );
    }

    public function adminArchive(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $order->is_archived = true;
        $order->archived_at = Carbon::now();
        $order->save();

        return response()->json([
            'message' => 'Order archived successfully.',
            'order_id' => (int) $order->id,
            'order_no' => $order->order_no,
        ]);
    }

    public function adminArchivePayment(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        // Archive the order (moves it out of payment history)
        $order->is_archived = true;
        $order->archived_at = Carbon::now();
        $order->save();

        return response()->json([
            'message' => 'Payment record archived successfully.',
            'order_id' => (int) $order->id,
        ]);
    }

    public function adminUnarchivePayment(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        // Unarchive the order
        $order->is_archived = false;
        $order->archived_at = null;
        $order->save();

        return response()->json([
            'message' => 'Payment record restored successfully.',
            'order_id' => (int) $order->id,
        ]);
    }

    public function adminDestroy(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $orderId = (int) $order->id;
        $orderNo = $order->order_no;
        $order->delete();

        return response()->json([
            'message' => 'Order deleted successfully.',
            'order_id' => $orderId,
            'order_no' => $orderNo,
        ]);
    }

    public function adminDestroyPayment(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $payment = $order->payment;
        $paymentNo = null;

        if ($payment) {
            $paymentNo = $payment->payment_no;
            $payment->delete();
        }

        $order->update([
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_pay',
            'payment_method' => null,
            'payment_reference' => null,
        ]);

        return response()->json([
            'message' => 'Payment record removed successfully.',
            'order_id' => (int) $order->id,
            'payment_no' => $paymentNo,
        ]);
    }

    public function updateTracking(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'stage' => 'nullable|in:to_pay,to_ship,to_receive,completed',
            'title' => 'nullable|string|max:160',
            'description' => 'nullable|string|max:2000',
            'event_type' => 'nullable|in:system,admin_update,courier_update',
            'courier_name' => 'nullable|string|max:120',
            'courier_tracking_no' => 'nullable|string|max:140',
            'location_name' => 'nullable|string|max:160',
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
        ]);

        $nextStage = $validated['stage'] ?? $order->customer_stage;
        $title = trim((string) ($validated['title'] ?? ''));

        if ($title === '') {
            $title = match ($nextStage) {
                'to_ship' => 'Order moved to shipping queue',
                'to_receive' => 'Order is out for delivery / pickup',
                'completed' => 'Order marked as completed',
                default => 'Order is waiting for payment confirmation',
            };
        }

        if (!empty($validated['courier_name'])) {
            $order->courier_name = $validated['courier_name'];
        }

        if (array_key_exists('courier_tracking_no', $validated)) {
            $order->courier_tracking_no = $validated['courier_tracking_no'];
        }

        if (!empty($validated['location_name'])) {
            $order->location_name = $validated['location_name'];
        }

        if (array_key_exists('latitude', $validated)) {
            $order->last_known_lat = $validated['latitude'];
        }

        if (array_key_exists('longitude', $validated)) {
            $order->last_known_lng = $validated['longitude'];
        }

        $order->customer_stage = $nextStage;

        if ($nextStage === 'completed') {
            $order->lifecycle_status = 'completed';
            $order->completed_at = Carbon::now();
        } elseif ($order->lifecycle_status === 'incoming') {
            $order->lifecycle_status = 'pending';
            $order->approved_at = $order->approved_at ?? now();
        }

        $order->save();

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => $nextStage,
            'event_type' => $validated['event_type'] ?? 'admin_update',
            'title' => $title,
            'description' => $validated['description'] ?? null,
            'location_name' => $validated['location_name'] ?? null,
            'latitude' => $validated['latitude'] ?? null,
            'longitude' => $validated['longitude'] ?? null,
            'occurred_at' => now(),
        ]);

        $order->load([
            'items',
            'payment',
            'trackingEvents' => fn ($query) => $query->orderByDesc('occurred_at')->orderByDesc('id'),
        ]);

        // --- Admin/Staff Notification: Tracking Updated ---
        $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
        $this->createAdminNotification(
            'info',
            "Tracking Updated: {$orderNoLabel}",
            "Order {$orderNoLabel} status updated to '{$title}' (Stage: " . (self::STAGE_LABELS[$nextStage] ?? $nextStage) . ").",
            ['order_id' => $order->id, 'order_no' => $orderNoLabel, 'stage' => $nextStage]
        );

        // --- Customer Email: Tracking / Stage Update ---
        $stageLabel = self::STAGE_LABELS[$nextStage] ?? ucfirst(str_replace('_', ' ', $nextStage));
        $emailHtml = $this->buildOrderEmailHtml(
            $order,
            "Order Update: {$stageLabel}",
            "Hi {$order->customer_name},\n\nYour order {$orderNoLabel} has a new status update.\n\nUpdate: {$title}\n" .
                (!empty($validated['description']) ? "Details: {$validated['description']}" : ''),
            '#1d4ed8'
        );
        $this->sendCustomerOrderEmail($order, "Order Update – {$orderNoLabel}", $emailHtml);

        return response()->json([
            'message' => 'Tracking update saved.',
            'data' => $this->transformOrderDetail($order),
        ]);
    }

    public function updatePaymentStatus(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'status' => 'required|in:paid,pending,refunded',
        ]);

        $payment = $order->payment;
        if (!$payment) {
            $payment = Payment::query()->create([
                'order_id' => $order->id,
                'payment_no' => $this->generatePaymentNo((int) $order->id),
                'method' => $order->payment_method,
                'reference' => $order->payment_reference,
                'amount' => $order->total,
                'status' => 'pending',
                'paid_at' => null,
            ]);
        }

        $nextStatus = strtolower($validated['status']);
        if (!in_array($nextStatus, self::ALLOWED_PAYMENT_STATUSES, true)) {
            return response()->json([
                'message' => 'Invalid payment status.',
            ], 422);
        }

        $payment->status = $nextStatus;
        $payment->paid_at = $nextStatus === 'paid' ? now() : null;
        $payment->save();

        if ($nextStatus === 'paid' && $order->customer_stage === 'to_pay' && $order->lifecycle_status !== 'rejected') {
            $order->customer_stage = 'to_ship';
            if ($order->lifecycle_status === 'incoming') {
                $order->lifecycle_status = 'pending';
                $order->approved_at = $order->approved_at ?? now();
            }
            $order->save();
        }

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => $order->customer_stage,
            'event_type' => 'admin_update',
            'title' => 'Payment status updated',
            'description' => 'Payment status changed to ' . strtoupper($nextStatus) . '.',
            'occurred_at' => now(),
            'metadata' => [
                'payment_status' => $nextStatus,
            ],
        ]);

        $order->load(['items', 'payment', 'latestTrackingEvent']);

        // --- Admin/Staff Notification: Payment Status Updated ---
        $orderNoLabel = $order->order_no ?? "ORD-{$order->id}";
        $this->createAdminNotification(
            'info',
            "Payment Updated: {$orderNoLabel}",
            "Payment for order {$orderNoLabel} ({$order->customer_name}) changed to " . strtoupper($nextStatus) . ".",
            ['order_id' => $order->id, 'order_no' => $orderNoLabel, 'payment_status' => $nextStatus]
        );

        // --- Customer Email: Payment Confirmed ---
        if ($nextStatus === 'paid') {
            $emailHtml = $this->buildOrderEmailHtml(
                $order,
                'Payment Confirmed',
                "Hi {$order->customer_name},\n\nYour payment for order {$orderNoLabel} has been confirmed. Your order is now being prepared for shipping or pickup.\n\nThank you for your purchase!",
                '#059669'
            );
            $this->sendCustomerOrderEmail($order, "Payment Confirmed – {$orderNoLabel}", $emailHtml);
        }

        return response()->json([
            'message' => 'Payment status updated.',
            'payment' => $this->transformPaymentRow($order),
            'order' => $this->transformOrderSummary($order),
        ]);
    }

    private function validatedBulkIds(Request $request): array
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);

        return collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    private function bulkActionResponse(
        string $action,
        string $scope,
        array $requestedIds,
        array $processedIds,
    ): JsonResponse {
        $pastTense = match ($action) {
            'approve' => 'approved',
            'reject' => 'rejected',
            'archive' => 'archived',
            default => $action,
        };

        return response()->json([
            'action' => $action,
            'scope' => $scope,
            'processed_ids' => array_values($processedIds),
            'processed_count' => count($processedIds),
            'skipped_ids' => array_values(array_diff($requestedIds, $processedIds)),
            'message' => count($processedIds) . " order(s) {$pastTense} successfully.",
        ]);
    }

    private function ensureCustomer(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || $user->role !== 'customer') {
            return response()->json([
                'message' => 'Forbidden. Customer access is required.',
            ], 403);
        }

        return null;
    }

    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }

    /**
     * Create an in-app notification for admin & staff.
     *
     * The bodies of these four helpers now live in App\Support\OrderNotifier so the
     * return/refund flow reuses the exact same notification + email template.
     * They stay here as thin wrappers so no existing call site had to change.
     */
    private function createAdminNotification(string $type, string $title, string $message, array $metadata = []): void
    {
        OrderNotifier::notifyAdmins($type, $title, $message, $metadata);
    }

    /**
     * Send a transactional order-status email to the customer.
     * Falls back gracefully when mail is not configured (log driver).
     */
    private function sendCustomerOrderEmail(Order $order, string $subject, string $htmlBody): void
    {
        OrderNotifier::emailCustomer($order, $subject, $htmlBody);
    }

    /**
     * Build the styled HTML email body for order status notifications.
     */
    private function buildOrderEmailHtml(Order $order, string $headline, string $bodyText, string $statusColor = '#800000'): string
    {
        return OrderNotifier::buildEmailHtml($order, $headline, $bodyText, $statusColor);
    }

    private function dispatchAfterResponse(callable $callback): void
    {
        OrderNotifier::afterResponse($callback);
    }

    private function normalizePaymentMethod(string $raw): ?string
    {
        $value = strtolower(trim($raw));

        return match ($value) {
            'gcash', 'g-cash' => 'GCash',
            'cop', 'cash on pickup', 'cash-on-pickup' => 'COP',
            'cod', 'cash on delivery', 'cash-on-delivery' => 'COD',
            default => null,
        };
    }

    private function defaultPaymentReference(string $paymentMethod): string
    {
        return match ($paymentMethod) {
            'GCash' => 'Awaiting GCash reference',
            'COP' => 'Awaiting Cash-on-Pickup',
            'COD' => 'To be collected upon delivery',
            default => 'Pending reference',
        };
    }

    private function generateOrderNo(int $orderId): string
    {
        return 'ORD-' . now()->format('ymd') . '-' . str_pad((string) $orderId, 5, '0', STR_PAD_LEFT);
    }

    private function generatePaymentNo(int $orderId): string
    {
        return 'PAY-' . now()->format('ymd') . '-' . str_pad((string) $orderId, 5, '0', STR_PAD_LEFT);
    }

    private function createTrackingEvent(Order $order, array $payload): void
    {
        OrderTrackingEvent::query()->create([
            'order_id' => $order->id,
            'created_by_user_id' => $payload['created_by_user_id'] ?? null,
            'stage' => $payload['stage'] ?? 'to_pay',
            'event_type' => $payload['event_type'] ?? 'system',
            'title' => $payload['title'] ?? 'Order update',
            'description' => $payload['description'] ?? null,
            'location_name' => $payload['location_name'] ?? null,
            'latitude' => $payload['latitude'] ?? null,
            'longitude' => $payload['longitude'] ?? null,
            'metadata' => $payload['metadata'] ?? null,
            'occurred_at' => $payload['occurred_at'] ?? now(),
        ]);
    }

    /**
     * Columns loaded for customer-facing order items.
     *
     * `product_image_reference` is an optional optimisation column. When a
     * database has not been migrated with it yet, selecting it aborts the whole
     * orders query with an SQL error — which made every My Orders tab fall back
     * to the cached list and left each thumbnail spinning forever. Detecting it
     * once per request keeps the endpoint working on both schema versions.
     *
     * The heavy `product_image` snapshot is intentionally excluded: thumbnails
     * are streamed through the dedicated image endpoint instead.
     *
     * @return array<int, string>
     */
    private function customerOrderItemColumns(): array
    {
        $columns = [
            'id',
            'order_id',
            'product_id',
            'product_name',
            'unit_price',
            'quantity',
            'line_total',
        ];

        if ($this->orderItemsHaveImageReference()) {
            array_splice($columns, 4, 0, ['product_image_reference']);
        }

        return $columns;
    }

    private function orderItemsHaveImageReference(): bool
    {
        if (self::$orderItemsHaveImageReference === null) {
            try {
                self::$orderItemsHaveImageReference = Schema::hasColumn(
                    'order_items',
                    'product_image_reference',
                );
            } catch (\Throwable $error) {
                Log::warning('[ORDER ITEMS] Unable to inspect product_image_reference column', [
                    'message' => $error->getMessage(),
                ]);

                self::$orderItemsHaveImageReference = false;
            }
        }

        return self::$orderItemsHaveImageReference;
    }

    private function transformOrderItem(
        OrderItem $lineItem,
        bool $includeProductImages,
        bool $includeCustomerImageEndpoints,
    ): array {
        $summaryItem = [
            'id' => $lineItem->id,
            'product_id' => $lineItem->product_id,
            'product_name' => $lineItem->product_name,
            'unit_price' => (float) $lineItem->unit_price,
            'quantity' => (int) $lineItem->quantity,
            'line_total' => (float) $lineItem->line_total,
        ];

        $storedImage = $lineItem->getAttribute('product_image');
        $imageReference = $this->lightweightProductImageReference(
            $lineItem->getAttribute('product_image_reference') ?? $storedImage
        );

        if ($includeProductImages) {
            $summaryItem['product_image'] = $storedImage;
        } elseif ($includeCustomerImageEndpoints) {
            if ($imageReference !== null) {
                $summaryItem['product_image'] = $imageReference;
            } else {
                $imageEndpoint = sprintf(
                    '/customer/orders/%d/items/%d/image',
                    (int) $lineItem->order_id,
                    (int) $lineItem->id,
                );
                $summaryItem['product_image_endpoint'] = $imageEndpoint . '?thumbnail=1';
                $summaryItem['product_image_full_endpoint'] = $imageEndpoint;
            }
        }

        return $summaryItem;
    }

    /**
     * Return/refund state for one order row.
     *
     * Deliberately mirrors OrderReturnController::evaluateEligibility() so the
     * button the customer sees and the rule the API enforces cannot disagree.
     * Everything is read from already eager-loaded relations — an order list
     * must never fan out into per-row queries.
     */
    private function buildReturnState(Order $order): array
    {
        $returnsLoaded = $order->relationLoaded('returns');
        $returns = $returnsLoaded ? $order->returns : collect();

        $latest = $returnsLoaded
            ? $returns->sortByDesc('id')->first()
            : ($order->relationLoaded('latestReturn') ? $order->latestReturn : null);

        $active = $returnsLoaded
            ? $returns->first(fn (OrderReturn $row) => in_array($row->status, OrderReturn::OPEN_STATUSES, true))
            : ($order->relationLoaded('activeReturn') ? $order->activeReturn : null);

        $anchor = $order->completed_at ?? $order->updated_at ?? $order->created_at;
        $deadline = $anchor
            ? Carbon::instance($anchor)->timezone(self::PH_TIME_ZONE)->addDays(OrderReturn::WINDOW_DAYS)
            : null;
        $daysRemaining = $deadline ? max(0, (int) ceil(now()->diffInDays($deadline, false))) : null;

        $blockedReason = null;

        if ($order->lifecycle_status === 'rejected') {
            $blockedReason = 'This order was rejected, so there is nothing to return.';
        } elseif ($order->customer_stage !== 'completed') {
            $blockedReason = 'Only completed orders can be returned. Confirm you received the order first.';
        } elseif ($active) {
            $blockedReason = 'A return request for this order is already being processed.';
        } elseif ($returnsLoaded && !$this->hasReturnableItem($order, $returns)) {
            $blockedReason = 'Every item in this order has already been returned.';
        } elseif ($deadline && now()->greaterThan($deadline)) {
            $blockedReason = 'The ' . OrderReturn::WINDOW_DAYS . '-day return window for this order closed on '
                . $this->formatPhilippineLabel($deadline) . '.';
        }

        $refundedAmount = $latest?->refunded_amount;

        return [
            'return_window_days'      => OrderReturn::WINDOW_DAYS,
            'return_deadline'         => $this->formatPhilippineIso($deadline),
            'return_deadline_label'   => $this->formatPhilippineLabel($deadline),
            'return_days_remaining'   => $daysRemaining,
            'return_eligible'         => $blockedReason === null,
            'return_blocked_reason'   => $blockedReason,
            'has_return'              => (bool) $latest,
            'return_open'             => (bool) $active,
            'returns_count'           => $returnsLoaded ? $returns->count() : 0,
            'return_id'               => $latest?->id,
            'return_no'               => $latest?->return_no,
            'return_no_display'       => $latest?->return_no ? '#' . $latest->return_no : null,
            'return_status'           => $latest?->status,
            'return_status_label'     => $latest?->statusLabel(),
            'return_status_group'     => $latest
                ? (in_array($latest->status, OrderReturn::TERMINAL_STATUSES, true) ? 'closed' : 'open')
                : null,
            'return_resolution'       => $latest?->resolution,
            'return_resolution_label' => $latest?->resolutionLabel(),
            'return_requested_at'     => $this->formatPhilippineIso($latest?->requested_at ?? $latest?->created_at),
            'return_requested_at_label' => $this->formatPhilippineLabel($latest?->requested_at ?? $latest?->created_at),
            'return_refunded_amount'  => $refundedAmount !== null ? (float) $refundedAmount : null,
            'return_refunded_amount_label' => $refundedAmount !== null
                ? $this->formatMoney((float) $refundedAmount)
                : null,
        ];
    }

    /**
     * Does any line still have quantity left to return?
     *
     * @param  \Illuminate\Support\Collection<int, OrderReturn>  $returns
     */
    private function hasReturnableItem(Order $order, $returns): bool
    {
        $items = $order->relationLoaded('items') ? $order->items : collect();

        if ($items->isEmpty()) {
            // Unknown without the lines — let the dedicated endpoint decide.
            return true;
        }

        $returnedByItem = [];

        foreach ($returns as $orderReturn) {
            if (in_array($orderReturn->status, ['cancelled', 'rejected'], true)
                || !$orderReturn->relationLoaded('items')) {
                continue;
            }

            foreach ($orderReturn->items as $line) {
                $key = (int) $line->order_item_id;
                $returnedByItem[$key] = ($returnedByItem[$key] ?? 0) + (int) $line->quantity;
            }
        }

        return $items->contains(
            fn (OrderItem $lineItem) => ((int) $lineItem->quantity - ($returnedByItem[(int) $lineItem->id] ?? 0)) > 0
        );
    }

    private function transformOrderSummary(
        Order $order,
        bool $includeProductImages = true,
        bool $includeCustomerImageEndpoints = false,
    ): array
    {
        $item = $order->items->first();
        $productNameLabel = $this->buildOrderItemLabelFromOrder($order);
        $payment = $order->payment;
        // Defensive: only read the ratings relation if it was eager-loaded to
        // avoid triggering lazy-loading (which may be disabled in strict mode).
        $ratings = $order->relationLoaded('ratings') ? $order->ratings : collect();
        $ratingsByItem = $ratings
            ->filter(fn (ProductRating $rating) => $rating->order_item_id !== null)
            ->keyBy(fn (ProductRating $rating) => (string) $rating->order_item_id);
        $ratableItems = $order->items;
        $firstRating = $ratings->first();
        $hasRating = $ratableItems->isNotEmpty()
            && $ratableItems->every(fn (OrderItem $lineItem) => $ratingsByItem->has((string) $lineItem->id));

        // Provide each product line individually so admin/staff list cards and
        // the payment history can display every ordered item (instead of only
        // the collapsed "First Item (+N more)" label).
        $summaryItems = $order->items
            ->map(fn (OrderItem $lineItem) => $this->transformOrderItem(
                $lineItem,
                $includeProductImages,
                $includeCustomerImageEndpoints,
            ))
            ->values()
            ->all();

        $customerAddressDetails = $this->extractAddressDetailsFromNotes($order->notes);
        $customerAddressLine = trim((string) ($order->location_name ?? ''));
        $customerAddress = $this->buildCustomerAddress($customerAddressLine, $customerAddressDetails);

        $createdAt = $order->created_at;
        $latestEvent = $order->latestTrackingEvent;

        $summary = [
            'id' => $order->id,
            'order_no' => $order->order_no,
            'order_no_display' => '#' . ($order->order_no ?: ('ORD-' . $order->id)),
            'order_number' => $order->order_no,
            'customer_id' => $order->customer_id,
            'customer_name' => $order->customer_name,
            'customer_contact' => $order->customer_contact,
            'customer_address' => $customerAddress,
            'customer_address_line' => $customerAddressLine !== '' ? $customerAddressLine : null,
            'customer_address_details' => $customerAddressDetails !== '' ? $customerAddressDetails : null,
            'product_name' => $productNameLabel,
            'items' => $summaryItems,
            'items_count' => count($summaryItems),
            'quantity' => (int) ($order->quantity ?: ($item?->quantity ?? 1)),

            'unit_price' => (float) ($item?->unit_price ?? 0),
            'total_amount' => (float) $order->total,
            'total_label' => $this->formatMoney((float) $order->total),
            'payment_method' => $payment?->method ?? $order->payment_method,
            'payment_reference' => $payment?->reference ?? $order->payment_reference,
            'payment_status' => $payment?->status ?? 'pending',
            'has_rating'          => $hasRating,
            'rating_count'        => $ratings->count(),
            'rating_total_items'  => $ratableItems->count(),
            'rating_stars'        => $firstRating?->stars,
            'rating_feedback'     => $firstRating?->feedback,
            'rating_admin_reply'  => $firstRating?->admin_reply,
            'rating_replied_at'   => $firstRating?->replied_at?->toIso8601String(),
            'rating_submitted_at' => $firstRating?->created_at?->toIso8601String(),
            'lifecycle_status' => $order->lifecycle_status,
            'lifecycle_status_label' => self::LIFECYCLE_LABELS[$order->lifecycle_status] ?? 'Pending',
            'customer_stage' => $order->customer_stage,
            'customer_stage_label' => self::STAGE_LABELS[$order->customer_stage] ?? 'To Pay',
            'notes' => $order->notes,
            'courier_name' => $order->courier_name,
            'courier_tracking_no' => $order->courier_tracking_no,
            'location_name' => $order->location_name,
            'latitude' => $order->last_known_lat !== null ? (float) $order->last_known_lat : null,
            'longitude' => $order->last_known_lng !== null ? (float) $order->last_known_lng : null,
            'created_at' => $this->formatPhilippineIso($createdAt),
            'created_at_label' => $this->formatPhilippineLabel($createdAt),
            'latest_event' => $latestEvent ? $this->transformTimelineEvent($latestEvent) : null,
        ];

        // Return/refund badges + the "Return / Refund" button's own gate.
        $summary = array_merge($summary, $this->buildReturnState($order));

        if ($includeProductImages) {
            $summary['product_image'] = $item?->product_image;
        } elseif ($includeCustomerImageEndpoints && isset($summaryItems[0])) {
            if (array_key_exists('product_image', $summaryItems[0])) {
                $summary['product_image'] = $summaryItems[0]['product_image'];
            }
            if (array_key_exists('product_image_endpoint', $summaryItems[0])) {
                $summary['product_image_endpoint'] = $summaryItems[0]['product_image_endpoint'];
            }
            if (array_key_exists('product_image_full_endpoint', $summaryItems[0])) {
                $summary['product_image_full_endpoint'] = $summaryItems[0]['product_image_full_endpoint'];
            }
        }

        return $summary;
    }

    private function transformOrderDetail(
        Order $order,
        bool $includeProductImages = true,
        bool $includeCustomerImageEndpoints = false,
    ): array
    {
        $summary = $this->transformOrderSummary(
            $order,
            $includeProductImages,
            $includeCustomerImageEndpoints,
        );

        $items = $order->items
            ->map(fn (OrderItem $item) => $this->transformOrderItem(
                $item,
                $includeProductImages,
                $includeCustomerImageEndpoints,
            ))
            ->values()
            ->all();

        $timeline = $order->trackingEvents
            ->sortByDesc(fn (OrderTrackingEvent $event) => $event->occurred_at?->getTimestamp() ?? 0)
            ->values()
            ->map(fn (OrderTrackingEvent $event) => $this->transformTimelineEvent($event))
            ->all();

        return array_merge($summary, [
            'items' => $items,
            'timeline' => $timeline,
        ]);
    }

    private function lightweightProductImageReference(mixed $value): ?string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 2048) {
            return null;
        }

        $reference = trim($value);
        if ($reference === '' || str_starts_with(strtolower($reference), 'data:')) {
            return null;
        }

        return $reference;
    }

    /**
     * Extract a lightweight image URL reference for an order item.
     *
     * Prefers the submitted product_image if it's a short URL. Falls back to
     * the Product's current image_data (if it's a URL, not a data-URI).
     * Returns null when only base64 data is available (the endpoint-based
     * thumbnail loading will handle those).
     */
    private function extractLightweightImageReference(
        ?string $submittedImage,
        int|string|null $productId,
        ?\Illuminate\Support\Collection $productsById = null,
    ): ?string {
        // 1. Try the submitted image first
        $ref = $this->lightweightProductImageReference($submittedImage);
        if ($ref !== null) {
            return $ref;
        }

        // 2. Fall back to the product's current image_data
        if ($productId !== null && $productsById !== null) {
            $product = $productsById->get((int) $productId);
            if ($product) {
                $ref = $this->lightweightProductImageReference($product->image_data ?? null);
                if ($ref !== null) {
                    return $ref;
                }
            }
        }

        return null;
    }

    /**
     * Decode a stored data-URI image without exposing it in an orders JSON payload.
     *
     * @return array{0: string, 1: string}|null
     */
    private function decodeStoredProductImage(?string $storedImage): ?array
    {
        if (!is_string($storedImage) || $storedImage === '') {
            return null;
        }

        $commaPosition = strpos($storedImage, ',');
        if ($commaPosition === false) {
            return null;
        }

        $header = substr($storedImage, 0, $commaPosition);
        if (!preg_match('/^data:(image\/(?:png|jpe?g|gif|webp));base64$/i', $header, $matches)) {
            return null;
        }

        $imageBytes = base64_decode(substr($storedImage, $commaPosition + 1), true);
        if (!is_string($imageBytes) || $imageBytes === '') {
            return null;
        }

        $mimeType = strtolower($matches[1]);
        if ($mimeType === 'image/jpg') {
            $mimeType = 'image/jpeg';
        }

        return [$imageBytes, $mimeType];
    }

    /**
     * Build and cache a compact square thumbnail for order-history cards.
     *
     * @return array{0: string, 1: string}|null
     */
    private function buildOrderItemThumbnail(string $sourceBytes, ?OrderItem $item = null): ?array
    {
        if (!function_exists('imagecreatefromstring')) {
            return null;
        }

        $useWebp = function_exists('imagewebp');
        $extension = $useWebp ? 'webp' : 'jpg';
        $mimeType = $useWebp ? 'image/webp' : 'image/jpeg';
        $cachePath = 'order-thumbnails/' . hash('sha256', $sourceBytes) . '.' . $extension;
        $itemCachePath = $item
            ? $this->orderItemThumbnailCachePath($item, $extension)
            : null;

        try {
            if (Storage::disk('local')->exists($cachePath)) {
                $cached = Storage::disk('local')->get($cachePath);
                if (is_string($cached) && $cached !== '') {
                    if ($itemCachePath !== null) {
                        Storage::disk('local')->put($itemCachePath, $cached);
                    }
                    return [$cached, $mimeType];
                }
            }

            $imageInfo = @getimagesizefromstring($sourceBytes);
            $sourceWidth = (int) ($imageInfo[0] ?? 0);
            $sourceHeight = (int) ($imageInfo[1] ?? 0);
            if (
                $sourceWidth < 1 ||
                $sourceHeight < 1 ||
                ($sourceWidth * $sourceHeight) > 40_000_000
            ) {
                return null;
            }

            $source = @imagecreatefromstring($sourceBytes);
            if ($source === false) {
                return null;
            }

            $targetSize = 240;
            $thumbnail = imagecreatetruecolor($targetSize, $targetSize);
            if ($thumbnail === false) {
                imagedestroy($source);
                return null;
            }

            $white = imagecolorallocate($thumbnail, 255, 255, 255);
            imagefill($thumbnail, 0, 0, $white);

            $cropSize = min($sourceWidth, $sourceHeight);
            $sourceX = (int) floor(($sourceWidth - $cropSize) / 2);
            $sourceY = (int) floor(($sourceHeight - $cropSize) / 2);
            imagecopyresampled(
                $thumbnail,
                $source,
                0,
                0,
                $sourceX,
                $sourceY,
                $targetSize,
                $targetSize,
                $cropSize,
                $cropSize,
            );

            ob_start();
            $encoded = $useWebp
                ? imagewebp($thumbnail, null, 80)
                : imagejpeg($thumbnail, null, 84);
            $thumbnailBytes = ob_get_clean();

            imagedestroy($thumbnail);
            imagedestroy($source);

            if (!$encoded || !is_string($thumbnailBytes) || $thumbnailBytes === '') {
                return null;
            }

            Storage::disk('local')->put($cachePath, $thumbnailBytes);
            if ($itemCachePath !== null) {
                Storage::disk('local')->put($itemCachePath, $thumbnailBytes);
            }

            return [$thumbnailBytes, $mimeType];
        } catch (\Throwable $error) {
            Log::warning('[ORDER THUMBNAIL] Unable to generate thumbnail', [
                'message' => $error->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Read an item-addressable thumbnail without selecting product_image.
     *
     * @return array{0: string, 1: string}|null
     */
    private function readCachedOrderItemThumbnail(OrderItem $item): ?array
    {
        $useWebp = function_exists('imagewebp');
        $extension = $useWebp ? 'webp' : 'jpg';
        $mimeType = $useWebp ? 'image/webp' : 'image/jpeg';
        $cachePath = $this->orderItemThumbnailCachePath($item, $extension);

        try {
            if (!Storage::disk('local')->exists($cachePath)) {
                return null;
            }

            $cached = Storage::disk('local')->get($cachePath);
            return is_string($cached) && $cached !== ''
                ? [$cached, $mimeType]
                : null;
        } catch (\Throwable $error) {
            Log::warning('[ORDER THUMBNAIL] Unable to read cached thumbnail', [
                'order_item_id' => $item->id,
                'message' => $error->getMessage(),
            ]);

            return null;
        }
    }

    private function orderItemThumbnailCachePath(OrderItem $item, string $extension): string
    {
        $version = $item->updated_at?->format('YmdHis') ?? 'unversioned';

        return sprintf(
            'order-thumbnails/items/%d-%s.%s',
            (int) $item->id,
            $version,
            $extension,
        );
    }

    private function normalizeRequestedOrderItems(array $validated): array
    {
        $rawItems = [];

        if (!empty($validated['items']) && is_array($validated['items'])) {
            $rawItems = $validated['items'];
        } else {
            $rawItems[] = [
                'product_id' => $validated['product_id'] ?? null,
                'product_name' => $validated['product_name'] ?? 'Custom Order',
                'product_image' => $validated['product_image'] ?? null,
                'quantity' => $validated['quantity'] ?? 1,
                'unit_price' => $validated['unit_price'] ?? null,
                'line_total' => $validated['total_amount'] ?? null,
            ];
        }

        $normalized = [];

        foreach ($rawItems as $rawItem) {
            $lineQuantity = max(1, (int) ($rawItem['quantity'] ?? 1));

            $lineTotal = array_key_exists('line_total', $rawItem) && !is_null($rawItem['line_total'])
                ? (float) $rawItem['line_total']
                : null;

            $lineUnitPrice = array_key_exists('unit_price', $rawItem) && !is_null($rawItem['unit_price'])
                ? (float) $rawItem['unit_price']
                : null;

            if (is_null($lineTotal) && !is_null($lineUnitPrice)) {
                $lineTotal = round(max(0, $lineUnitPrice) * $lineQuantity, 2);
            }

            if (is_null($lineUnitPrice) && !is_null($lineTotal) && $lineQuantity > 0) {
                $lineUnitPrice = round(max(0, $lineTotal) / $lineQuantity, 2);
            }

            if (is_null($lineTotal)) {
                $lineTotal = 0.0;
            }

            if (is_null($lineUnitPrice)) {
                $lineUnitPrice = $lineQuantity > 0 ? round($lineTotal / $lineQuantity, 2) : 0.0;
            }

            $lineProductName = trim((string) ($rawItem['product_name'] ?? ''));
            if ($lineProductName === '') {
                $lineProductName = 'Custom Order';
            }

            $lineProductId = array_key_exists('product_id', $rawItem) && !is_null($rawItem['product_id'])
                ? (int) $rawItem['product_id']
                : null;

            $normalized[] = [
                'product_id' => $lineProductId,
                'product_name' => $lineProductName,
                'product_image' => $rawItem['product_image'] ?? null,
                'quantity' => $lineQuantity,
                'unit_price' => round(max(0, $lineUnitPrice), 2),
                'line_total' => round(max(0, $lineTotal), 2),
            ];
        }

        if (count($normalized) === 1 && array_key_exists('total_amount', $validated)) {
            $fallbackTotal = round(max(0, (float) ($validated['total_amount'] ?? 0)), 2);
            $normalized[0]['line_total'] = $fallbackTotal;
            $qty = max(1, (int) $normalized[0]['quantity']);
            $normalized[0]['unit_price'] = $qty > 0 ? round($fallbackTotal / $qty, 2) : 0.0;
        }

        return $normalized;
    }

    private function buildOrderItemLabelFromRows(array $rows): string
    {
        if (count($rows) < 1) {
            return 'Custom Order';
        }

        $firstName = trim((string) ($rows[0]['product_name'] ?? 'Custom Order'));
        if ($firstName === '') {
            $firstName = 'Custom Order';
        }

        $extraCount = max(0, count($rows) - 1);
        if ($extraCount > 0) {
            return $firstName . ' (+' . $extraCount . ' more)';
        }

        return $firstName;
    }

    private function buildOrderItemLabelFromOrder(Order $order): string
    {
        if (!$order->relationLoaded('items')) {
            $order->load('items');
        }

        $rows = $order->items
            ->map(fn (OrderItem $item) => [
                'product_name' => $item->product_name,
            ])
            ->values()
            ->all();

        return $this->buildOrderItemLabelFromRows($rows);
    }

    private function transformTimelineEvent(OrderTrackingEvent $event): array
    {
        return [
            'id' => $event->id,
            'stage' => $event->stage,
            'stage_label' => self::STAGE_LABELS[$event->stage] ?? 'To Pay',
            'event_type' => $event->event_type,
            'title' => $event->title,
            'description' => $event->description,
            'location_name' => $event->location_name,
            'latitude' => $event->latitude !== null ? (float) $event->latitude : null,
            'longitude' => $event->longitude !== null ? (float) $event->longitude : null,
            'occurred_at' => $this->formatPhilippineIso($event->occurred_at),
            'occurred_at_label' => $this->formatPhilippineLabel($event->occurred_at),
            'metadata' => $event->metadata,
        ];
    }

    private function transformPaymentRow(Order $order): array
    {
        $payment = $order->payment;

        return [
            'payment_id' => $payment?->payment_no,
            'order_id' => $order->id,
            'order_no' => $order->order_no,
            'order_no_display' => '#' . ($order->order_no ?: ('ORD-' . $order->id)),
            'customer_name' => $order->customer_name,
            'method' => $payment?->method ?? $order->payment_method,
            'reference' => $payment?->reference ?? $order->payment_reference,
            'amount' => (float) ($payment?->amount ?? $order->total),
            'amount_label' => $this->formatMoney((float) ($payment?->amount ?? $order->total)),
            'status' => $payment?->status ?? 'pending',
            'date_paid' => $this->formatPhilippineIso($payment?->paid_at),
            'date_paid_label' => $this->formatPhilippineLabel($payment?->paid_at) ?? '-',
            'lifecycle_status' => $order->lifecycle_status,
        ];
    }

    private function extractAddressDetailsFromNotes(?string $notes): string
    {
        $raw = trim((string) $notes);
        if ($raw === '') {
            return '';
        }

        $segments = str_contains($raw, '|')
            ? explode('|', $raw)
            : (preg_split('/\r\n|\r|\n/', $raw) ?: []);

        $addressSegments = [];

        foreach ($segments as $segment) {
            $piece = trim((string) $segment);
            if ($piece === '') {
                continue;
            }

            $lower = strtolower($piece);
            if (
                str_starts_with($lower, 'department:') ||
                str_starts_with($lower, 'role:') ||
                str_starts_with($lower, 'rejection reason:')
            ) {
                continue;
            }

            $addressSegments[] = $piece;
            if (count($addressSegments) >= 2) {
                break;
            }
        }

        return implode(', ', $addressSegments);
    }

    private function buildCustomerAddress(string $addressLine, string $addressDetails): ?string
    {
        if ($addressLine === '' && $addressDetails === '') {
            return null;
        }

        if ($addressLine === '') {
            return $addressDetails;
        }

        if ($addressDetails === '') {
            return $addressLine;
        }

        if (str_contains(strtolower($addressDetails), strtolower($addressLine))) {
            return $addressDetails;
        }

        return $addressLine . "\n" . $addressDetails;
    }

    private function formatPhilippineIso(?DateTimeInterface $dateTime): ?string
    {
        if (!$dateTime) {
            return null;
        }

        return Carbon::instance($dateTime)->timezone(self::PH_TIME_ZONE)->toIso8601String();
    }

    private function formatPhilippineLabel(?DateTimeInterface $dateTime): ?string
    {
        if (!$dateTime) {
            return null;
        }

        return Carbon::instance($dateTime)->timezone(self::PH_TIME_ZONE)->format('M d, Y h:i A');
    }

    private function formatMoney(float $amount): string
    {
        return '₱ ' . number_format($amount, 2, '.', ',');
    }
}
