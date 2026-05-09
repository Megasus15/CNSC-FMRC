<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminNotification;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderTrackingEvent;
use App\Models\Payment;
use App\Models\Product;
use DateTimeInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

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

        $totalAmount = round(
            array_reduce(
                $orderItems,
                fn (float $carry, array $item): float => $carry + max(0, (float) ($item['line_total'] ?? 0)),
                0.0,
            ),
            2,
        );

        if ($quantity < 1) {
            return response()->json([
                'message' => 'Invalid order quantity.',
            ], 422);
        }

        $paymentStatus = $paymentMethod === 'GCash' ? 'paid' : 'pending';
        $customerStage = $paymentStatus === 'paid' ? 'to_ship' : 'to_pay';

        try {
            $createdOrder = DB::transaction(function () use ($validated, $customer, $orderItems, $quantity, $totalAmount, $paymentMethod, $paymentStatus, $customerStage): Order {
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
                    OrderItem::query()->create([
                        'order_id' => $order->id,
                        'product_id' => $lineItem['product_id'],
                        'product_name' => $lineItem['product_name'],
                        'product_image' => $lineItem['product_image'],
                        'unit_price' => $lineItem['unit_price'],
                        'quantity' => $lineItem['quantity'],
                        'line_total' => $lineItem['line_total'],
                    ]);
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
                "Hi {$customerName},\n\nThank you for placing your order with CNSC-FMRC. We have received your order and it is currently under review. You will be notified once it has been processed.\n\nPlease keep your order number for your reference.",
                '#800000'
            );
            $this->sendCustomerOrderEmail($createdOrder, "Order Received – {$orderNoLabel}", $emailHtml);

            return response()->json([
                'message' => 'Order placed successfully.',
                'data' => $this->transformOrderDetail($createdOrder),
            ], 201);

        } catch (\Exception $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'Unable to place order at the moment.',
            ], 400);
        }
    }

    public function customerIndex(Request $request): JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        $orders = Order::query()
            ->with([
                'items:id,order_id,product_name,product_image,unit_price,quantity,line_total',
                'payment:id,order_id,payment_no,method,reference,amount,status,paid_at',
                'latestTrackingEvent',
            ])
            ->where('customer_id', $request->user()->id)
            ->orderBy('created_at', 'asc')
            ->get();

        $data = $orders->map(fn (Order $order) => $this->transformOrderSummary($order))->values();

        $counts = [
            'all' => $data->count(),
            'to_pay' => $data->where('customer_stage', 'to_pay')->where('lifecycle_status', '!=', 'rejected')->count(),
            'to_ship' => $data->where('customer_stage', 'to_ship')->where('lifecycle_status', '!=', 'rejected')->count(),
            'to_receive' => $data->where('customer_stage', 'to_receive')->where('lifecycle_status', '!=', 'rejected')->count(),
            'completed' => $data->where('customer_stage', 'completed')->where('lifecycle_status', '!=', 'rejected')->count(),
        ];

        return response()->json([
            'data' => $data,
            'counts' => $counts,
        ]);
    }

    public function customerShow(Request $request, Order $order): JsonResponse
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
            'items',
            'payment',
            'trackingEvents' => fn ($query) => $query->orderByDesc('occurred_at')->orderByDesc('id'),
        ]);

        return response()->json([
            'data' => $this->transformOrderDetail($order),
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
                'items:id,order_id,product_name,product_image,unit_price,quantity,line_total',
                'payment:id,order_id,payment_no,method,reference,amount,status,paid_at',
                'latestTrackingEvent',
            ])
            ->orderBy('created_at', 'asc')
            ->get();

        $mapped = $orders->map(fn (Order $order) => $this->transformOrderSummary($order));

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

        return response()->json([
            'incoming' => $incoming,
            'directory' => $directory,
            'payments' => $payments,
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
        $order->approved_at = now();
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
        $order->rejected_at = now();
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
        $order->completed_at = now();
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
            "Hi {$order->customer_name},\n\nYour order {$orderNoLabel} has been marked as completed. Thank you for choosing CNSC-FMRC!\n\nWe hope to serve you again. If you have any feedback, feel free to reach out to us.",
            '#800000'
        );
        $this->sendCustomerOrderEmail($order, "Order Completed – {$orderNoLabel}", $emailHtml);

        return response()->json([
            'message' => 'Order marked as completed.',
            'data' => $this->transformOrderSummary($order),
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
            $order->completed_at = now();
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
     */
    private function createAdminNotification(string $type, string $title, string $message, array $metadata = []): void
    {
        try {
            AdminNotification::create([
                'type'     => $type,
                'title'    => $title,
                'message'  => $message,
                'is_read'  => false,
                'metadata' => $metadata ?: null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Could not create admin notification: ' . $e->getMessage());
        }
    }

    /**
     * Send a transactional order-status email to the customer.
     * Falls back gracefully when mail is not configured (log driver).
     */
    private function sendCustomerOrderEmail(Order $order, string $subject, string $htmlBody): void
    {
        // Ensure customer relation is loaded so we can grab their email
        if (!$order->relationLoaded('customer') && $order->customer_id) {
            $order->load('customer');
        }

        // Priority: User.email → customer_contact (only if it looks like email)
        $emailAddress = $order->customer?->email ?? null;

        if (!$emailAddress && $order->customer_contact) {
            $contact = trim($order->customer_contact);
            if (filter_var($contact, FILTER_VALIDATE_EMAIL)) {
                $emailAddress = $contact;
            }
        }

        if (!$emailAddress) {
            Log::info("Skipping order email — no valid customer email for Order #{$order->id}");
            return;
        }

        $orderId = (string) $order->id;
        $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
        $fromName = config('mail.from.name', 'CNSC-FMRC');

        $emailDispatch = function () use ($emailAddress, $subject, $htmlBody, $orderId, $fromAddress, $fromName) {
            try {
                Mail::html($htmlBody, function ($message) use ($emailAddress, $subject, $fromAddress, $fromName) {
                    $message->to($emailAddress)
                        ->subject($subject)
                        ->from($fromAddress, $fromName);
                });

                Log::info("Customer order email sent to {$emailAddress} | Subject: {$subject} | Order #{$orderId}");
            } catch (\Throwable $e) {
                Log::error("Customer order email FAILED for Order #{$orderId} to {$emailAddress}: " . $e->getMessage());
            }
        };

        $this->dispatchAfterResponse($emailDispatch);
    }

    /**
     * Build the styled HTML email body for order status notifications.
     */
    private function buildOrderEmailHtml(Order $order, string $headline, string $bodyText, string $statusColor = '#800000'): string
    {
        $orderNo   = htmlspecialchars($order->order_no ?? "ORD-{$order->id}", ENT_QUOTES);
        $headline  = htmlspecialchars($headline, ENT_QUOTES);
        $bodyText  = nl2br(htmlspecialchars($bodyText, ENT_QUOTES));
        $total     = '₱ ' . number_format((float) $order->total, 2, '.', ',');
        $stage     = self::STAGE_LABELS[$order->customer_stage] ?? 'Processing';
        $stageHtml = htmlspecialchars($stage, ENT_QUOTES);

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{$headline}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09);max-width:600px;">
        <!-- Header -->
        <tr>
          <td style="background:{$statusColor};padding:28px 36px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:.3px;">CNSC-FMRC</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px;">Fabrication &amp; Manufacturing Research Center</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">
            <h2 style="margin:0 0 12px;color:#1a202c;font-size:18px;">{$headline}</h2>
            <p style="margin:0 0 20px;color:#4a5568;font-size:14px;line-height:1.7;">{$bodyText}</p>
            <!-- Order summary chip -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:18px 22px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#718096;padding-bottom:8px;">Order Number</td>
                      <td align="right" style="font-size:13px;font-weight:700;color:#1a202c;padding-bottom:8px;">{$orderNo}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#718096;padding-bottom:8px;">Status</td>
                      <td align="right" style="font-size:13px;font-weight:700;color:{$statusColor};padding-bottom:8px;">{$stageHtml}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#718096;">Total Amount</td>
                      <td align="right" style="font-size:14px;font-weight:700;color:#1a202c;">{$total}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#718096;font-size:12px;">You can track your order status by logging into your account at any time.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fb;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;">
            <p style="margin:0;color:#a0aec0;font-size:11px;">© 2025 CNSC-FMRC · Camarines Norte State College</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
HTML;
    }

    private function dispatchAfterResponse(callable $callback): void
    {
        try {
            app()->terminating($callback);
        } catch (\Throwable $e) {
            $callback();
        }
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

    private function transformOrderSummary(Order $order): array
    {
        $item = $order->items->first();
        $productNameLabel = $this->buildOrderItemLabelFromOrder($order);
        $payment = $order->payment;
        $customerAddressDetails = $this->extractAddressDetailsFromNotes($order->notes);
        $customerAddressLine = trim((string) ($order->location_name ?? ''));
        $customerAddress = $this->buildCustomerAddress($customerAddressLine, $customerAddressDetails);

        $createdAt = $order->created_at;
        $latestEvent = $order->latestTrackingEvent;

        return [
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
            'product_image' => $item?->product_image,
            'quantity' => (int) ($order->quantity ?: ($item?->quantity ?? 1)),
            'unit_price' => (float) ($item?->unit_price ?? 0),
            'total_amount' => (float) $order->total,
            'total_label' => $this->formatMoney((float) $order->total),
            'payment_method' => $payment?->method ?? $order->payment_method,
            'payment_reference' => $payment?->reference ?? $order->payment_reference,
            'payment_status' => $payment?->status ?? 'pending',
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
    }

    private function transformOrderDetail(Order $order): array
    {
        $summary = $this->transformOrderSummary($order);

        $items = $order->items
            ->map(fn (OrderItem $item) => [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'product_image' => $item->product_image,
                'unit_price' => (float) $item->unit_price,
                'quantity' => (int) $item->quantity,
                'line_total' => (float) $item->line_total,
            ])
            ->values()
            ->all();

        $timeline = $order->trackingEvents
            ->sortByDesc(fn (OrderTrackingEvent $event) => $event->occurred_at?->getTimestamp() ?? 0)
            ->values()
            ->map(fn (OrderTrackingEvent $event) => $this->transformTimelineEvent($event))
            ->all();

        return $summary + [
            'items' => $items,
            'timeline' => $timeline,
        ];
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
