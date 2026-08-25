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
use Illuminate\Http\UploadedFile;
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

    /** Where a customer's GCash receipt screenshot is stored on the public disk. */
    private const PAYMENT_PROOF_FOLDER = 'payment-proofs';

    private const STAGE_LABELS = [
        'to_pay' => 'To Pay',
        'to_ship' => 'To Ship',
        'to_receive' => 'To Receive',
        'completed' => 'Completed',
    ];

    /**
     * The same four stages, named for an order that never travels.
     *
     * A pickup order in `to_ship` is being packed for the counter, not handed to
     * a courier, and `to_receive` means it is already sitting at FMRC waiting -
     * "To Ship" and "To Receive" both describe a parcel in motion. Only the two
     * middle stages differ: "To Pay" and "Completed" mean the same thing either
     * way, and they are also the tab names the customer filters by, so renaming
     * them would leave the chip disagreeing with the tab that holds it.
     */
    private const PICKUP_STAGE_LABELS = [
        'to_pay' => 'To Pay',
        'to_ship' => 'Preparing',
        'to_receive' => 'Ready for Pickup',
        'completed' => 'Completed',
    ];

    private const LIFECYCLE_LABELS = [
        'incoming' => 'Incoming',
        'pending' => 'Pending',
        'rejected' => 'Rejected',
        'completed' => 'Completed',
        'cancelled' => 'Cancelled',
    ];

    /** Where pickup orders are collected; mirrored into `location_name`. */
    private const PICKUP_LOCATION_NAME = 'FMRC Office, University of Camarines Norte, Daet';

    /**
     * Coordinates of the FMRC office, used as the pickup destination pin and as
     * the origin of a delivery route.
     */
    private const PICKUP_LATITUDE = 14.1122;

    private const PICKUP_LONGITUDE = 122.9550;

    private const FULFILLMENT_LABELS = [
        'pickup' => 'Pickup at FMRC',
        'delivery' => 'Courier Delivery',
    ];


    /**
     * Cached result of the optional `order_items.product_image_reference`
     * column check. Null means "not inspected yet".
     */
    private static ?bool $orderItemsHaveImageReference = null;

    /**
     * Column listings per table, cached for the life of the request so the
     * select-list guards below cost one metadata query each instead of one
     * per column.
     *
     * @var array<string, array<int, string>>
     */
    private static array $tableColumns = [];

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

            // How the customer receives the order. Everything below is only
            // required for a delivery: a pickup has no destination to validate,
            // and demanding a barangay from someone collecting at the counter
            // would just be a fake field they have to fill in.
            'fulfillment_type' => 'nullable|in:pickup,delivery',
            'delivery_recipient_name' => 'required_if:fulfillment_type,delivery|nullable|string|max:160',
            'delivery_contact_no' => 'required_if:fulfillment_type,delivery|nullable|string|max:40',
            'delivery_street' => 'required_if:fulfillment_type,delivery|nullable|string|max:255',
            'delivery_barangay' => 'required_if:fulfillment_type,delivery|nullable|string|max:120',
            'delivery_city' => 'required_if:fulfillment_type,delivery|nullable|string|max:120',
            'delivery_province' => 'required_if:fulfillment_type,delivery|nullable|string|max:120',
            'delivery_postal_code' => 'required_if:fulfillment_type,delivery|nullable|digits:4',
            'delivery_landmark' => 'nullable|string|max:255',
            'delivery_lat' => 'nullable|numeric|between:-90,90',
            'delivery_lng' => 'nullable|numeric|between:-180,180',
        ], [
            'delivery_recipient_name.required_if' => 'Please provide the recipient name for delivery.',
            'delivery_contact_no.required_if' => 'Please provide a contact number the courier can call.',
            'delivery_street.required_if' => 'Please provide the house/unit number and street.',
            'delivery_barangay.required_if' => 'Please provide the barangay.',
            'delivery_city.required_if' => 'Please provide the city or municipality.',
            'delivery_province.required_if' => 'Please provide the province.',
            'delivery_postal_code.required_if' => 'Please provide the 4-digit postal code.',
            'delivery_postal_code.digits' => 'A Philippine postal code is exactly 4 digits (Daet is 4600).',
        ]);

        $paymentMethod = $this->normalizePaymentMethod($validated['payment_method']);
        if ($paymentMethod === null) {
            return response()->json([
                'message' => 'Unsupported payment method. Allowed values are GCash, COP, and COD.',
            ], 422);
        }

        // Payment method and fulfillment are two different questions, and only
        // cash answers both at once: Cash-on-Pickup is by definition collected
        // at the centre, Cash-on-Delivery is by definition handed to a courier.
        // GCash is prepaid, so the customer still has to say which one they want
        // - defaulting a silent GCash order to delivery would ship an item that
        // was meant to be collected.
        $fulfillmentType = $this->resolveFulfillmentType(
            $paymentMethod,
            $validated['fulfillment_type'] ?? null,
        );

        if ($fulfillmentType === null) {
            return response()->json([
                'message' => 'Please choose whether this order is for pickup or delivery.',
                'errors' => ['fulfillment_type' => ['Choose pickup or delivery.']],
            ], 422);
        }

        if ($fulfillmentType === Order::FULFILLMENT_DELIVERY) {
            // required_if only fires when the client sent the discriminator, so
            // re-check here for the COD case where the server inferred it.
            $missing = $this->missingDeliveryAddressFields($validated);
            if ($missing !== []) {
                return response()->json([
                    'message' => 'Complete delivery details are required before placing this order.',
                    'errors' => $missing,
                ], 422);
            }
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

        // A GCash order can be placed before the money is sent, the way Shopee and
        // Lazada do it: the order is recorded, a deadline is shown, and the
        // customer pays from My Orders afterwards. A reference number supplied
        // here is still accepted - it just is not demanded up front, because
        // forcing it meant sending money before knowing the order would go
        // through. What is never optional is that the digits be plausible: a
        // half-typed reference is worse than none, since staff would hunt for a
        // number that was never issued.
        $gcashReference = null;
        $paymentDueAt = null;
        if ($paymentMethod === 'GCash') {
            $rawReference = trim((string) ($validated['payment_reference'] ?? ''));
            $expectedDigits = (int) config('payments.gcash.reference_digits', 13);

            if ($rawReference !== '') {
                $gcashReference = $this->normalizeGcashReference($rawReference);

                if ($gcashReference === null) {
                    return response()->json([
                        'message' => 'That GCash reference number does not look right.',
                        'errors' => [
                            'payment_reference' => [
                                "A GCash reference number is exactly {$expectedDigits} digits. Leave it blank if you have not sent the payment yet - you can enter it later from My Orders.",
                            ],
                        ],
                    ], 422);
                }
            }

            $windowHours = max(1, (int) config('payments.gcash.payment_window_hours', 48));
            $paymentDueAt = now()->addHours($windowHours);
        }

        // A customer-typed reference number is a claim, not a receipt. Marking
        // the order paid on the strength of it would push an unpaid order into
        // the shipping queue, so a manual GCash order waits for staff to match
        // the reference in their own GCash app and confirm it.
        $gcashAutoConfirm = (bool) config('payments.gcash.auto_confirm', false);
        $paymentStatus = ($paymentMethod === 'GCash' && $gcashAutoConfirm) ? 'paid' : 'pending';
        $customerStage = $paymentStatus === 'paid' ? 'to_ship' : 'to_pay';

        try {
            $createdOrder = DB::transaction(function () use ($validated, $customer, $orderItems, $quantity, $paymentMethod, $paymentStatus, $customerStage, $fulfillmentType, $gcashReference, $paymentDueAt): Order {
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

                $isPickup = $fulfillmentType === Order::FULFILLMENT_PICKUP;

                // A pickup order carries no destination at all - storing a
                // half-filled address on it would later be indistinguishable
                // from a delivery whose address went missing.
                $deliveryParts = $isPickup ? [
                    'delivery_recipient_name' => null,
                    'delivery_contact_no' => null,
                    'delivery_street' => null,
                    'delivery_barangay' => null,
                    'delivery_city' => null,
                    'delivery_province' => null,
                    'delivery_postal_code' => null,
                    'delivery_landmark' => null,
                    'delivery_lat' => null,
                    'delivery_lng' => null,
                ] : [
                    'delivery_recipient_name' => $this->cleanAddressPart($validated['delivery_recipient_name'] ?? null)
                        ?? $validated['customer_name']
                        ?? $customer?->name,
                    'delivery_contact_no' => $this->cleanAddressPart($validated['delivery_contact_no'] ?? null),
                    'delivery_street' => $this->cleanAddressPart($validated['delivery_street'] ?? null),
                    'delivery_barangay' => $this->cleanAddressPart($validated['delivery_barangay'] ?? null),
                    'delivery_city' => $this->cleanAddressPart($validated['delivery_city'] ?? null),
                    'delivery_province' => $this->cleanAddressPart($validated['delivery_province'] ?? null),
                    'delivery_postal_code' => $this->cleanAddressPart($validated['delivery_postal_code'] ?? null),
                    'delivery_landmark' => $this->cleanAddressPart($validated['delivery_landmark'] ?? null),
                    'delivery_lat' => $validated['delivery_lat'] ?? null,
                    'delivery_lng' => $validated['delivery_lng'] ?? null,
                ];

                // `location_name` predates the structured columns and is still
                // what the admin table, the courier label and the old customer
                // screens read, so keep it as a mirror rather than a source.
                $locationName = $isPickup
                    ? self::PICKUP_LOCATION_NAME
                    : ($this->buildAddressLineFromParts($deliveryParts) ?: ($validated['location_name'] ?? null));

                $order = Order::query()->create(array_merge([
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
                    // The GCash reference is normalised to bare digits so staff
                    // can search for it verbatim; other methods keep their
                    // human-readable placeholder. A GCash order placed before the
                    // money was sent carries the placeholder until the customer
                    // submits their reference from My Orders.
                    'payment_reference' => $paymentMethod === 'GCash'
                        ? ($gcashReference ?? $this->defaultPaymentReference($paymentMethod))
                        : ($validated['payment_reference'] ?? $this->defaultPaymentReference($paymentMethod)),
                    // Only GCash has a deadline: cash is handed over at the
                    // counter or to the courier, so there is nothing to wait for.
                    'payment_due_at' => $paymentDueAt,
                    'fulfillment_type' => $fulfillmentType,
                    'lifecycle_status' => 'incoming',
                    'customer_stage' => $customerStage,
                    'notes' => $validated['notes'] ?? null,
                    // A pickup never travels, so it gets a handover code at the
                    // counter instead of a courier and a tracking number.
                    'courier_name' => $isPickup ? null : ($validated['courier_name'] ?? $this->defaultCourierLabel()),
                    'courier_tracking_no' => $isPickup ? null : ($validated['courier_tracking_no'] ?? null),
                    'pickup_code' => $isPickup ? $this->generatePickupCode() : null,
                    'location_name' => $locationName,
                    // A pickup order sits at the FMRC counter from the start, so
                    // its last-known point is known immediately.
                    'last_known_lat' => $isPickup
                        ? self::PICKUP_LATITUDE
                        : ($validated['latitude'] ?? null),
                    'last_known_lng' => $isPickup
                        ? self::PICKUP_LONGITUDE
                        : ($validated['longitude'] ?? null),
                ], $deliveryParts));

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
                    'reference' => $paymentMethod === 'GCash'
                        ? ($gcashReference ?? $this->defaultPaymentReference($paymentMethod))
                        : ($validated['payment_reference'] ?? $this->defaultPaymentReference($paymentMethod)),
                    'amount' => $totalAmount,
                    'status' => $paymentStatus,
                    // A reference typed at checkout is the customer's claim that
                    // they already sent the money; without one there is nothing to
                    // have submitted yet.
                    'submitted_at' => $gcashReference !== null ? now() : null,
                    'paid_at' => $paymentStatus === 'paid' ? now() : null,
                ]);

                $trackingLabel = $this->buildOrderItemLabelFromRows($orderItems);

                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $customer?->id,
                    'stage' => 'to_pay',
                    'event_type' => 'system',
                    'title' => "Order placed: {$trackingLabel}",
                    'description' => $isPickup
                        ? 'Your order has been received and is being reviewed. You will collect it at the FMRC office once it is ready.'
                        : 'Your order has been received and is currently being reviewed.',
                    'location_name' => $locationName,
                    'latitude' => $isPickup
                        ? self::PICKUP_LATITUDE
                        : ($deliveryParts['delivery_lat'] ?? null),
                    'longitude' => $isPickup
                        ? self::PICKUP_LONGITUDE
                        : ($deliveryParts['delivery_lng'] ?? null),
                    'occurred_at' => now(),
                    'metadata' => [
                        'lifecycle_status' => 'incoming',
                        'fulfillment_type' => $fulfillmentType,
                    ],
                ]);

                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $customer?->id,
                    'stage' => $customerStage,
                    'event_type' => 'system',
                    'title' => match (true) {
                        $paymentStatus === 'paid' => 'Payment confirmed',
                        $paymentMethod === 'GCash' && $gcashReference === null => 'Waiting for your GCash payment',
                        default => 'Awaiting payment confirmation',
                    },
                    'description' => $this->initialPaymentEventDescription(
                        $paymentMethod,
                        $paymentStatus,
                        $isPickup,
                        $gcashReference !== null,
                    ),
                    'occurred_at' => now(),
                    'metadata' => [
                        'payment_status' => $paymentStatus,
                        'fulfillment_type' => $fulfillmentType,
                        'payment_due_at' => optional($paymentDueAt)->toIso8601String(),
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

            // --- Admin/Staff Notification: GCash payment to verify ---
            // A GCash order is money that has supposedly already moved, so it
            // needs a different action from a cash order: open GCash, search
            // for the reference, then confirm the payment. Folding that into the
            // generic "new order" line would bury it.
            //
            // Only raised when a reference actually arrived. An order placed to be
            // paid later has nothing to reconcile yet, and announcing a
            // verification task for it would send staff hunting for a number the
            // customer has not been given. That notification is raised instead by
            // customerSubmitPayment(), when the reference does arrive.
            if ($createdOrder->payment_method === 'GCash'
                && $createdOrder->payment?->status !== 'paid'
                && $gcashReference !== null
            ) {
                $this->createAdminNotification(
                    'warning',
                    "Verify GCash Payment: {$orderNoLabel}",
                    "{$customerName} says they sent ₱" . number_format((float) $createdOrder->total, 2, '.', ',')
                        . " via GCash with reference {$createdOrder->payment_reference}. Match it in the FMRC GCash app, then mark the payment as paid.",
                    [
                        'order_id' => $createdOrder->id,
                        'order_no' => $orderNoLabel,
                        'payment_reference' => $createdOrder->payment_reference,
                        'requires_payment_verification' => true,
                    ]
                );
            }

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

        } catch (\RuntimeException $e) {
            // Raised on purpose above for things the customer can act on -
            // "Insufficient stock for product X", "no longer available". These
            // messages are written for them, so pass them straight through.
            return response()->json([
                'message' => $e->getMessage() ?: 'Unable to place order at the moment.',
            ], 422);
        } catch (\Throwable $e) {
            // Anything else is ours, not theirs. The previous version echoed
            // $e->getMessage() verbatim, which put a full MySQL error - the
            // database name, host, port, every column of the INSERT - inside the
            // customer's "Order Failed" popup. Log it where it belongs and give
            // them a sentence they can actually use.
            Log::error('[ORDERS] Checkout failed', [
                'customer_id' => $request->user()?->id,
                'payment_method' => $paymentMethod,
                'fulfillment_type' => $fulfillmentType,
                'exception' => $e::class,
                'message' => $e->getMessage(),
                'file' => $e->getFile().':'.$e->getLine(),
            ]);

            return response()->json([
                'message' => 'We could not place your order right now. Nothing was charged. Please try again in a moment, or contact FMRC if it keeps happening.',
            ], 500);
        }
    }

    public function customerIndex(Request $request): Response|JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        $orders = Order::query()
            ->select($this->existingColumns('orders', [
                'id',
                'order_no',
                'customer_id',
                'customer_name',
                'customer_contact',
                'quantity',
                'total',
                'payment_method',
                'payment_reference',
                // Without this column the GCash deadline line and the overdue
                // styling in My Orders silently render as nothing, because the
                // transform reads it straight off the model.
                'payment_due_at',
                'fulfillment_type',
                'lifecycle_status',
                'customer_stage',
                // Same trap as `payment_due_at` above: the cancel sheet, the
                // "Cancellation requested" band and the Cancelled tab all read
                // these straight off the model, so leaving them out of the
                // select renders them as nothing at all.
                'cancel_state',
                'cancel_reason',
                'cancel_reason_detail',
                'cancel_requested_at',
                'cancelled_at',
                'cancel_decided_at',
                'cancel_decision_note',
                'cancel_refund_due',
                'notes',
                'courier_name',
                'courier_tracking_no',
                'location_name',
                'last_known_lat',
                'last_known_lng',
                // Structured destination: the list renders the same address the
                // detail modal does, so the columns have to come along.
                'delivery_recipient_name',
                'delivery_contact_no',
                'delivery_street',
                'delivery_barangay',
                'delivery_city',
                'delivery_province',
                'delivery_postal_code',
                'delivery_landmark',
                'delivery_lat',
                'delivery_lng',
                'pickup_code',
                'pickup_ready_at',
                'picked_up_at',
                'completed_at',
                'created_at',
                'updated_at',
            ]))
            ->with([
                'items' => fn ($query) => $query
                    ->select($this->customerOrderItemColumns()),
                // `refunded_at`/`refund_reference` are part of this list for the
                // same reason `paid_at` is: the customer's card has to be able to
                // say "Refunded on <date>" after a cancellation, and a column left
                // out of the select reads back as null rather than as an error.
                'payment' => fn ($query) => $query->select($this->paymentSelectColumns()),
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

        // A cancelled order is no longer waiting on anybody, so it leaves the
        // working tabs and appears under Cancelled instead - the same treatment
        // `rejected` already gets, except that this one the customer asked for
        // and therefore has to be able to find again.
        $live = ['rejected', 'cancelled'];

        $counts = [
            'all'         => $data->count(),
            'to_pay'      => $data->where('customer_stage', 'to_pay')->whereNotIn('lifecycle_status', $live)->count(),
            'to_ship'     => $data->where('customer_stage', 'to_ship')->whereNotIn('lifecycle_status', $live)->count(),
            'to_receive'  => $data->where('customer_stage', 'to_receive')->whereNotIn('lifecycle_status', $live)->count(),
            'completed'   => $data->where('customer_stage', 'completed')->whereNotIn('lifecycle_status', $live)->count(),
            'to_rate'     => $data->where('customer_stage', 'completed')->whereNotIn('lifecycle_status', $live)->where('has_rating', false)->count(),
            'cancelled'   => $data->where('lifecycle_status', 'cancelled')->count(),
            // Requests still awaiting a decision, so the customer can see the
            // tab is worth opening.
            'cancel_pending' => $data->where('cancel_pending', true)->count(),
            'returns'     => count($returnRows),
            'returns_open' => count(array_filter($returnRows, fn (array $row) => $row['status_group'] === 'open')),
        ];

        $payload = [
            'data' => $data,
            'counts' => $counts,
            'returns' => $returnRows,
            'return_window_days' => OrderReturn::WINDOW_DAYS,
            // Sent once for the whole list rather than repeated on every order:
            // the sheet is the same sheet whichever card opened it, and this
            // payload is re-hashed for an ETag on every poll.
            'cancel_reason_options' => $this->cancelReasonOptions(),
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
            // Quote the stage by the name this order actually shows, or a pickup
            // customer is told to look for a "To Receive" chip that does not exist.
            $stageName = $this->stageLabel($order, 'to_receive');

            return response()->json([
                'message' => "Only orders in \"{$stageName}\" status can be marked as received.",
            ], 422);
        }

        if ($order->lifecycle_status === 'rejected') {
            return response()->json(['message' => 'Rejected orders cannot be updated.'], 422);
        }

        $order->customer_stage = 'completed';
        $order->lifecycle_status = 'completed';
        $order->completed_at = Carbon::now();

        // A pickup order finishes at the FMRC counter, so the customer pressing
        // this button *is* the handover. Without stamping it here, `picked_up_at`
        // would stay empty on every order the customer closed themselves and only
        // ever be filled on the ones staff closed for them.
        $isPickup = $order->isPickup();
        if ($isPickup) {
            $order->picked_up_at = $order->picked_up_at ?? now();
        }

        $order->save();

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()->id,
            'stage'              => 'completed',
            'event_type'         => 'system',
            'title'              => $isPickup ? 'Order collected' : 'Order Received',
            'description'        => $isPickup
                ? 'Customer confirmed they collected the order at the FMRC office.'
                : 'Customer confirmed receipt of the order.',
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

    /**
     * Customer: "I have sent the GCash payment, here is my reference number."
     *
     * This is the second half of a Shopee-style flow - the order was placed first,
     * the money follows. Nothing here marks the order paid: the reference is a
     * claim, and only staff confirming it against the FMRC GCash account turns it
     * into revenue. What this does is give staff something to reconcile and give
     * the customer a receipt trail that they submitted it.
     */
    public function customerSubmitPayment(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        if ((int) $order->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'You are not allowed to update this order.'], 403);
        }

        if ($order->payment_method !== 'GCash') {
            return response()->json([
                'message' => 'This order is not paid through GCash, so there is no reference number to submit.',
            ], 422);
        }

        if ($order->lifecycle_status === 'rejected') {
            return response()->json([
                'message' => 'This order was rejected. Do not send any payment for it - contact FMRC if you already did.',
            ], 422);
        }

        $order->load('payment');

        if ($order->payment?->status === 'paid') {
            return response()->json([
                'message' => 'This payment has already been confirmed. There is nothing left to submit.',
            ], 422);
        }

        $expectedDigits = (int) config('payments.gcash.reference_digits', 13);
        $maxKb = max(256, (int) config('payments.gcash.proof_max_kb', 2048));

        $validated = $request->validate([
            'payment_reference' => ['required', 'string', 'max:180'],
            'proof' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', "max:{$maxKb}"],
        ], [
            'payment_reference.required' => "Enter the {$expectedDigits}-digit reference number from your GCash receipt.",
            'proof.mimes' => 'Attach a screenshot as a JPG, PNG or WEBP image.',
            'proof.max' => 'That screenshot is too large. Please attach one under '.round($maxKb / 1024, 1).' MB.',
        ]);

        $reference = $this->normalizeGcashReference($validated['payment_reference']);

        if ($reference === null) {
            return response()->json([
                'message' => 'That GCash reference number does not look right.',
                'errors' => [
                    'payment_reference' => [
                        "A GCash reference number is exactly {$expectedDigits} digits. Check your receipt and try again.",
                    ],
                ],
            ], 422);
        }

        // One reference number is one transfer. Seeing it on a second order means
        // one of the two was never actually paid, and catching it here saves staff
        // from confirming both against a single payment in their GCash app.
        $duplicate = Payment::query()
            ->where('reference', $reference)
            ->where('order_id', '!=', $order->id)
            ->with('order:id,order_no')
            ->first();

        if ($duplicate) {
            $usedOn = $duplicate->order?->order_no ?: ('order #'.$duplicate->order_id);

            return response()->json([
                'message' => "That reference number is already recorded against {$usedOn}. Each GCash transfer has its own reference - please send this order's total separately and submit the new reference.",
                'errors' => ['payment_reference' => ['This reference number is already in use.']],
            ], 422);
        }

        $proofPath = null;
        $proof = $request->file('proof');
        if ($proof instanceof UploadedFile && $proof->isValid()) {
            $proofPath = $proof->store(self::PAYMENT_PROOF_FOLDER, 'public');
        }

        $payment = $order->payment;

        DB::transaction(function () use ($order, &$payment, $reference, $proofPath) {
            if (! $payment) {
                // Older orders were created before a payments row was guaranteed.
                $payment = Payment::query()->create([
                    'order_id' => $order->id,
                    'payment_no' => $this->generatePaymentNo((int) $order->id),
                    'method' => $order->payment_method,
                    'amount' => $order->total,
                    'status' => 'pending',
                ]);
            }

            $previousProof = $payment->proof_path;

            $payment->reference = $reference;
            $payment->status = 'pending';
            $payment->submitted_at = now();
            if ($proofPath !== null) {
                $payment->proof_path = $proofPath;
            }
            $payment->save();

            // A resubmission replaces the screenshot; keeping the old one would
            // leave staff looking at a receipt for a reference nobody recorded.
            if ($proofPath !== null && filled($previousProof) && $previousProof !== $proofPath) {
                Storage::disk('public')->delete($previousProof);
            }

            $order->payment_reference = $reference;
            $order->save();
        });

        $amountLabel = '₱'.number_format((float) $order->total, 2, '.', ',');

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()->id,
            'stage' => $order->customer_stage ?: 'to_pay',
            'event_type' => 'system',
            'title' => 'GCash reference submitted',
            'description' => "We received reference {$reference} for {$amountLabel} and are matching it against the FMRC GCash account. Your order moves forward as soon as it is confirmed.",
            'occurred_at' => now(),
            'metadata' => [
                'source' => 'customer_payment_submission',
                'payment_reference' => $reference,
                'has_proof' => $proofPath !== null || filled($payment->proof_path),
            ],
        ]);

        $customerName = $order->customer_name ?: 'A customer';
        $orderNoLabel = $order->order_no ?: "ORD-{$order->id}";
        $this->createAdminNotification(
            'warning',
            "Verify GCash Payment: {$orderNoLabel}",
            "{$customerName} says they sent {$amountLabel} via GCash with reference {$reference}."
                . ($proofPath !== null ? ' A receipt screenshot is attached.' : '')
                . ' Match it in the FMRC GCash app, then mark the payment as paid.',
            [
                'order_id' => $order->id,
                'order_no' => $orderNoLabel,
                'payment_reference' => $reference,
                'requires_payment_verification' => true,
            ]
        );

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
            'message' => 'Reference number received. FMRC will confirm your payment shortly.',
            'data' => $this->transformOrderDetail($order, false, true),
        ]);
    }

    /**
     * Customer: call off an order that has not been handed over yet.
     *
     * Two outcomes, decided by the server and never by the client - the same
     * split Shopee and Lazada use:
     *
     *  - nothing confirmed and nothing prepared (still at To Pay), so the order
     *    is cancelled on the spot and the stock goes straight back; or
     *  - the payment is confirmed or staff already accepted the order into the
     *    shipping queue, so this only files a request. Staff decide, because by
     *    then the job may already be on a machine and the money may already be
     *    in the FMRC wallet.
     *
     * Either way admin and staff are notified - "MUST CONNECTED TO ADMIN AND
     * STAFF THAT THEY WILL KNOW THAT CUSTOMER CANCEL ORDER".
     */
    public function customerCancel(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        if ((int) $order->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'This order belongs to another account.'], 403);
        }

        $validated = $request->validate([
            'reason' => ['required', Rule::in(Order::CANCEL_REASONS)],
            'reason_detail' => ['nullable', 'string', 'max:600'],
        ]);

        $detail = trim((string) ($validated['reason_detail'] ?? ''));

        if ($validated['reason'] === 'other' && $detail === '') {
            return response()->json([
                'message' => 'Tell us briefly why you are cancelling.',
                'errors' => ['reason_detail' => ['Tell us briefly why you are cancelling.']],
            ], 422);
        }

        $order->load(['payment', 'items']);

        // Cancellation cannot degrade the way an optional column can: the whole
        // point is a record of who called the order off and why, plus a
        // `lifecycle_status` of 'cancelled' that the enum has to accept. If the
        // cancellation migration has not been run on this database, writing it
        // would either lose the reason silently or truncate the enum value, so
        // refuse with something a human can act on instead.
        if (! $order->hasSchemaColumns(['cancel_state', 'cancel_reason', 'cancel_requested_at', 'cancelled_at'])) {
            Log::error('[ORDERS] Cancellation attempted before the cancellation migration was run', [
                'order_id' => $order->id,
            ]);

            return response()->json([
                'message' => 'Order cancellation is not available yet on this site. Please message FMRC and they will cancel it for you.',
            ], 503);
        }

        $availability = $order->cancellationAvailability();

        if (! $availability['allowed']) {
            return response()->json(['message' => $availability['reason']], 422);
        }

        $reasonLabel = Order::CANCEL_REASON_LABELS[$validated['reason']];
        $payment = $order->payment;
        // Either staff already matched the money, or the customer says they sent
        // it and nobody has looked yet. Both mean somebody has to check the FMRC
        // GCash account before this order is closed out.
        $paymentConfirmed = $payment?->status === 'paid';
        $refundDue = $paymentConfirmed || (bool) $payment?->hasCustomerClaim();
        $immediate = $availability['immediate'];
        $restocked = [];

        try {
            DB::transaction(function () use (
                $order,
                $request,
                $validated,
                $detail,
                $immediate,
                $refundDue,
                &$restocked,
            ): void {
                // Re-read under a lock: two taps, or a tap racing staff pressing
                // "Mark payment received", must not both get through.
                $fresh = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
                $fresh->setRelation('payment', $order->payment);

                $recheck = $fresh->cancellationAvailability();
                if (! $recheck['allowed']) {
                    throw new \DomainException($recheck['reason'] ?? 'This order can no longer be cancelled.');
                }

                $fresh->cancel_reason = $validated['reason'];
                $fresh->cancel_reason_detail = $detail !== '' ? $detail : null;
                $fresh->cancel_requested_at = now();
                $fresh->cancel_decision_note = null;
                $fresh->cancel_decided_at = null;
                $fresh->cancel_decided_by_user_id = null;

                if ($immediate) {
                    $fresh->cancel_state = 'approved';
                    $fresh->lifecycle_status = 'cancelled';
                    $fresh->cancelled_at = now();
                    $fresh->cancel_decided_at = now();
                    $fresh->cancel_refund_due = $refundDue;
                    $restocked = $this->restockOrder($order);
                } else {
                    $fresh->cancel_state = 'requested';
                    $fresh->cancel_refund_due = false;
                }

                $fresh->save();

                // Copy the decided values back onto the instance the response and
                // the notifications are built from.
                $order->forceFill($fresh->only([
                    'cancel_state',
                    'cancel_reason',
                    'cancel_reason_detail',
                    'cancel_requested_at',
                    'cancelled_at',
                    'cancel_decided_at',
                    'cancel_decided_by_user_id',
                    'cancel_decision_note',
                    'cancel_refund_due',
                    'lifecycle_status',
                ]))->syncOriginal();
            });
        } catch (\DomainException $error) {
            return response()->json(['message' => $error->getMessage()], 422);
        } catch (\Throwable $error) {
            Log::error('[ORDER CANCEL] '.$error->getMessage());

            return response()->json(['message' => 'Could not cancel this order. Please try again.'], 500);
        }

        $orderNoLabel = $order->order_no ?: "ORD-{$order->id}";
        $amountLabel = $this->formatMoney((float) $order->total);
        $customerName = $order->customer_name ?: 'A customer';

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()->id,
            'stage' => $order->customer_stage ?: 'to_pay',
            'event_type' => 'system',
            'title' => $immediate ? 'Order cancelled' : 'Cancellation requested',
            'description' => $immediate
                ? "You cancelled this order. Reason: {$reasonLabel}."
                : "You asked to cancel this order. Reason: {$reasonLabel}. FMRC will review it shortly.",
            'occurred_at' => now(),
            'metadata' => array_filter([
                'source' => 'customer_cancellation',
                'cancel_reason' => $validated['reason'],
                'cancel_reason_detail' => $detail !== '' ? $detail : null,
                'cancel_state' => $order->cancel_state,
                'refund_due' => $refundDue,
                'restocked' => $restocked ?: null,
            ], fn ($value) => $value !== null),
        ]);

        $moneyLine = match (true) {
            $paymentConfirmed => " The confirmed GCash payment of {$amountLabel} has to be sent back to the customer.",
            $refundDue => " The customer submitted a GCash reference for {$amountLabel} that nobody has verified yet - check the FMRC GCash account, and send the money back if it arrived.",
            default => ' No money was received for this order.',
        };

        $this->createAdminNotification(
            $immediate ? 'info' : 'warning',
            $immediate
                ? "Order Cancelled by Customer: {$orderNoLabel}"
                : "Cancellation Requested: {$orderNoLabel}",
            $immediate
                ? "{$customerName} cancelled order {$orderNoLabel} ({$reasonLabel})."
                    .($detail !== '' ? " Note: {$detail}" : '')
                    .$moneyLine
                : "{$customerName} asked to cancel order {$orderNoLabel} ({$reasonLabel})."
                    .($detail !== '' ? " Note: {$detail}" : '')
                    ." Approve or decline it in Orders."
                    .$moneyLine,
            [
                'order_id' => $order->id,
                'order_no' => $orderNoLabel,
                'cancel_state' => $order->cancel_state,
                'cancel_reason' => $validated['reason'],
                'requires_cancellation_decision' => ! $immediate,
                'refund_due' => $refundDue,
            ]
        );

        $emailHtml = $this->buildOrderEmailHtml(
            $order,
            $immediate ? 'Your Order Has Been Cancelled' : 'We Received Your Cancellation Request',
            $immediate
                ? "Hi {$order->customer_name},\n\nOrder {$orderNoLabel} has been cancelled as you requested.\n\nReason: {$reasonLabel}\n\n"
                    .($refundDue
                        ? "If you already sent the {$amountLabel} through GCash, FMRC will check the account and return it to you. Staff will contact you once it has been sent back.\n\n"
                        : "No payment was collected, so there is nothing to refund.\n\n")
                    .'You can place a new order any time.'
                : "Hi {$order->customer_name},\n\nWe received your request to cancel order {$orderNoLabel}.\n\nReason: {$reasonLabel}\n\nBecause this order is already being prepared, FMRC staff need to review the request. You will be notified as soon as they decide."
                    .($refundDue ? "\n\nIf it is approved and your {$amountLabel} GCash payment has already been confirmed, staff will send the money back to your GCash number." : ''),
            $immediate ? '#b45309' : '#0a5fd6'
        );
        $this->sendCustomerOrderEmail(
            $order,
            ($immediate ? 'Order Cancelled – ' : 'Cancellation Request Received – ').$orderNoLabel,
            $emailHtml
        );

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
            'message' => $immediate
                ? 'Order cancelled.'
                : 'Cancellation request sent. FMRC staff will review it shortly.',
            'immediate' => $immediate,
            'data' => $this->transformOrderDetail($order, false, true),
        ]);
    }

    /**
     * Admin/Staff: accept or refuse a customer's cancellation request.
     *
     * Approving is the only path that puts stock back and flags the refund; a
     * decline hands the order back to its previous stage with a note the
     * customer can read, so the request never just disappears.
     */
    public function decideCancellation(Request $request, Order $order): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'decision' => ['required', Rule::in(['approve', 'decline'])],
            'note' => ['nullable', 'string', 'max:600'],
        ]);

        $order->load(['payment', 'items']);

        if ($order->cancel_state !== 'requested' || $order->isCancelled()) {
            return response()->json([
                'message' => 'There is no cancellation request waiting on this order.',
            ], 422);
        }

        $approve = $validated['decision'] === 'approve';
        $note = trim((string) ($validated['note'] ?? ''));

        if (! $approve && $note === '') {
            return response()->json([
                'message' => 'Tell the customer why the cancellation was declined.',
                'errors' => ['note' => ['Tell the customer why the cancellation was declined.']],
            ], 422);
        }

        $payment = $order->payment;
        $paymentConfirmed = $payment?->status === 'paid';
        $refundDue = $paymentConfirmed || (bool) $payment?->hasCustomerClaim();
        $restocked = [];

        try {
            DB::transaction(function () use ($order, $request, $approve, $note, $refundDue, &$restocked): void {
                $fresh = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

                if ($fresh->cancel_state !== 'requested' || $fresh->lifecycle_status === 'cancelled') {
                    throw new \DomainException('This request has already been decided.');
                }

                $fresh->cancel_state = $approve ? 'approved' : 'declined';
                $fresh->cancel_decided_at = now();
                $fresh->cancel_decided_by_user_id = $request->user()?->id;
                $fresh->cancel_decision_note = $note !== '' ? $note : null;

                if ($approve) {
                    $fresh->lifecycle_status = 'cancelled';
                    $fresh->cancelled_at = now();
                    $fresh->cancel_refund_due = $refundDue;
                    $restocked = $this->restockOrder($order);
                } else {
                    $fresh->cancel_refund_due = false;
                }

                $fresh->save();

                $order->forceFill($fresh->only([
                    'cancel_state',
                    'cancel_decided_at',
                    'cancel_decided_by_user_id',
                    'cancel_decision_note',
                    'cancelled_at',
                    'cancel_refund_due',
                    'lifecycle_status',
                ]))->syncOriginal();
            });
        } catch (\DomainException $error) {
            return response()->json(['message' => $error->getMessage()], 422);
        } catch (\Throwable $error) {
            Log::error('[ORDER CANCEL DECISION] '.$error->getMessage());

            return response()->json(['message' => 'Could not save the decision. Please try again.'], 500);
        }

        $orderNoLabel = $order->order_no ?: "ORD-{$order->id}";
        $amountLabel = $this->formatMoney((float) $order->total);
        $reasonLabel = $order->cancelReasonLabel() ?? 'No reason given';

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => $order->customer_stage ?: 'to_pay',
            'event_type' => 'admin_update',
            'title' => $approve ? 'Cancellation approved' : 'Cancellation declined',
            'description' => $approve
                ? 'FMRC approved your cancellation request.'
                    .($refundDue ? " Your {$amountLabel} GCash payment will be sent back to you." : '')
                    .($note !== '' ? " Note: {$note}" : '')
                : "FMRC could not cancel this order. {$note}",
            'occurred_at' => now(),
            'metadata' => array_filter([
                'cancel_state' => $order->cancel_state,
                'refund_due' => $approve ? $refundDue : false,
                'restocked' => $restocked ?: null,
            ], fn ($value) => $value !== null),
        ]);

        $this->createAdminNotification(
            $approve ? 'info' : 'info',
            $approve
                ? "Cancellation Approved: {$orderNoLabel}"
                : "Cancellation Declined: {$orderNoLabel}",
            $approve
                ? "Order {$orderNoLabel} ({$order->customer_name}) was cancelled. Reason: {$reasonLabel}."
                    .($refundDue ? " A GCash refund of {$amountLabel} is still owed - record it once sent." : '')
                : "The cancellation request on order {$orderNoLabel} ({$order->customer_name}) was declined. {$note}",
            [
                'order_id' => $order->id,
                'order_no' => $orderNoLabel,
                'cancel_state' => $order->cancel_state,
                'refund_due' => $approve ? $refundDue : false,
            ]
        );

        $emailHtml = $this->buildOrderEmailHtml(
            $order,
            $approve ? 'Your Order Has Been Cancelled' : 'We Could Not Cancel Your Order',
            $approve
                ? "Hi {$order->customer_name},\n\nFMRC approved your cancellation request for order {$orderNoLabel}.\n\nReason: {$reasonLabel}\n\n"
                    .($refundDue
                        ? "Your GCash payment of {$amountLabel} will be sent back to the number you paid from. Staff process refunds by hand, so please allow a few working days.\n\n"
                        : "No payment was collected for this order, so there is nothing to refund.\n\n")
                    .($note !== '' ? "Note from FMRC: {$note}\n\n" : '')
                    .'You can place a new order any time.'
                : "Hi {$order->customer_name},\n\nFMRC could not cancel order {$orderNoLabel}.\n\nReason from FMRC: {$note}\n\nYour order continues as normal. If you have questions, please reply to this email or message FMRC directly.",
            $approve ? '#b45309' : '#dc2626'
        );
        $this->sendCustomerOrderEmail(
            $order,
            ($approve ? 'Order Cancelled – ' : 'Cancellation Not Approved – ').$orderNoLabel,
            $emailHtml
        );

        $order->load(['items', 'payment', 'latestTrackingEvent', 'ratings']);

        return response()->json([
            'message' => $approve
                ? 'Order cancelled. The customer has been notified.'
                : 'Cancellation declined. The customer has been notified.',
            'order' => $this->transformOrderSummary($order),
        ]);
    }

    /**
     * Put a cancelled order's quantities back on the shelf.
     *
     * Stock is taken at checkout, so a cancelled order that never restocks leaks
     * inventory: the product stays "sold" forever. Only rows that still point at
     * a live product can be restored - a deleted product has nowhere to go back
     * to - and the running total is recomputed rather than blindly incremented so
     * `stock_status` cannot drift out of step with `stock`.
     *
     * @return array<int, array{product_id: int, quantity: int, stock: int}>
     */
    private function restockOrder(Order $order): array
    {
        $restored = [];

        $lines = $order->relationLoaded('items')
            ? $order->items
            : $order->items()->get();

        foreach ($lines as $lineItem) {
            $productId = (int) ($lineItem->product_id ?? 0);
            $quantity = max(0, (int) $lineItem->quantity);

            if ($productId < 1 || $quantity < 1) {
                continue;
            }

            $product = Product::query()->whereKey($productId)->lockForUpdate()->first();
            if (! $product) {
                continue;
            }

            $product->stock = max(0, (int) $product->stock) + $quantity;
            $product->stock_status = $product->stock > 0 ? 'in_stock' : 'out_of_stock';
            $product->save();

            $restored[] = [
                'product_id' => $productId,
                'quantity' => $quantity,
                'stock' => (int) $product->stock,
            ];
        }

        return $restored;
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
                'payment' => fn ($query) => $query->select($this->paymentSelectColumns()),
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
            // Cancellations do not get their own tab - a cancelled order is still
            // an order and stays in the directory - but staff need to see at a
            // glance that somebody is waiting on a decision, and that a refund is
            // still owed on an order that was already paid.
            'cancellations_summary' => [
                'pending' => $mapped->where('cancel_pending', true)->count(),
                'cancelled' => $mapped->where('is_cancelled', true)->count(),
                'refund_due' => $mapped->where('cancel_refund_due', true)->count(),
            ],
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
                    'description' => $this->approvalEventDescription($order),
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

                // Same leak as the single-order reject(): the stock left the
                // shelf at checkout and nothing puts it back. Already inside
                // the surrounding transaction.
                $restocked = $this->restockOrder($order);

                $genericReason = 'Your order could not be processed at this time.';
                $this->createTrackingEvent($order, [
                    'created_by_user_id' => $request->user()?->id,
                    'stage' => $order->customer_stage,
                    'event_type' => 'admin_update',
                    'title' => 'Order rejected',
                    'description' => $genericReason,
                    'occurred_at' => now(),
                    'metadata' => [
                        'lifecycle_status' => 'rejected',
                        'restocked' => $restocked,
                    ],
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
            'description' => $this->approvalEventDescription($order),
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

        // Checkout already took the stock off the shelf. A rejected order is
        // never fulfilled, so without this the goods are lost on paper - the
        // same leak that cancellations restock. Wrapped with the save so a
        // failed restock cannot leave the order rejected and the stock gone.
        $restocked = DB::transaction(function () use ($order): array {
            return $this->restockOrder($order);
        });

        $this->createTrackingEvent($order, [
            'created_by_user_id' => $request->user()?->id,
            'stage' => $order->customer_stage,
            'event_type' => 'admin_update',
            'title' => 'Order rejected',
            'description' => $validated['reason'] ?? 'Your order could not be processed at this time.',
            'occurred_at' => now(),
            'metadata' => [
                'lifecycle_status' => 'rejected',
                'restocked' => $restocked,
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
        $isPickup = $order->isPickup();

        // A cancelled order has no next stage. Advancing one would tell the
        // customer their cancelled order is out for delivery.
        if ($order->isCancelled()) {
            return response()->json([
                'message' => 'This order was cancelled, so its tracking can no longer be advanced.',
            ], 422);
        }

        if ($title === '') {
            // A pickup order never ships, so the generic "out for delivery"
            // wording would be wrong on the customer's timeline.
            $title = $isPickup
                ? match ($nextStage) {
                    'to_ship' => 'Order is being prepared for pickup',
                    'to_receive' => 'Order is ready for pickup at the FMRC office',
                    'completed' => 'Order collected',
                    default => 'Order is waiting for payment confirmation',
                }
                : match ($nextStage) {
                    'to_ship' => 'Order moved to shipping queue',
                    'to_receive' => 'Order is out for delivery',
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

        // Pickup milestones: "ready" is when the customer may come and collect,
        // "picked up" is the handover itself. Stamped once so a later re-save of
        // the same stage does not keep moving the time.
        if ($isPickup) {
            // Orders placed before pickup codes existed get one the first time
            // staff move them along, so the counter always has something to ask for.
            if (blank($order->pickup_code)) {
                $order->pickup_code = $this->generatePickupCode();
            }

            if ($nextStage === 'to_receive') {
                $order->pickup_ready_at = $order->pickup_ready_at ?? now();
            }

            if ($nextStage === 'completed') {
                $order->picked_up_at = $order->picked_up_at ?? now();
            }
        }

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
            // Only meaningful with `refunded`: the reference GCash printed when
            // staff sent the money back, so the return leg is auditable too.
            'refund_reference' => 'nullable|string|max:64',
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

        // Confirming money on a cancelled order would push it back into the
        // shipping queue and back into Total Revenue. Recording the refund is the
        // only payment move a cancelled order still has.
        if ($nextStatus === 'paid' && $order->isCancelled()) {
            return response()->json([
                'message' => 'This order was cancelled. If the customer did send the money, record it as refunded once you have returned it.',
            ], 422);
        }

        $payment->status = $nextStatus;
        // Never re-stamp an existing confirmation: `paid_at` is when the money
        // was first matched, and reports read it.
        $payment->paid_at = $nextStatus === 'paid'
            ? ($payment->paid_at ?? now())
            : $payment->paid_at;

        if ($nextStatus === 'refunded') {
            $payment->refunded_at = $payment->refunded_at ?? now();
            $refundReference = trim((string) ($validated['refund_reference'] ?? ''));
            if ($refundReference !== '') {
                $payment->refund_reference = $refundReference;
            }
        } elseif ($nextStatus === 'pending') {
            // Setting a payment back to unpaid undoes the confirmation itself, so
            // the timestamp that made it revenue has to go with it.
            $payment->paid_at = null;
        }

        $payment->save();

        if ($nextStatus === 'paid' && $order->customer_stage === 'to_pay' && ! in_array($order->lifecycle_status, ['rejected', 'cancelled'], true)) {
            $order->customer_stage = 'to_ship';
            if ($order->lifecycle_status === 'incoming') {
                $order->lifecycle_status = 'pending';
                $order->approved_at = $order->approved_at ?? now();
            }
            $order->save();
        }

        // The refund that a cancellation left outstanding is now settled.
        if ($nextStatus === 'refunded' && $order->cancel_refund_due) {
            $order->cancel_refund_due = false;
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

    /**
     * Decide whether an order is collected or shipped.
     *
     * Cash payments already answer the question: Cash-on-Pickup is money handed
     * over at the counter, Cash-on-Delivery is money handed to the courier at
     * the door. GCash is prepaid and works either way, so the customer must
     * choose - returning null asks them to.
     */
    private function resolveFulfillmentType(string $paymentMethod, ?string $requested): ?string
    {
        $requested = in_array($requested, [Order::FULFILLMENT_PICKUP, Order::FULFILLMENT_DELIVERY], true)
            ? $requested
            : null;

        return match ($paymentMethod) {
            'COP' => Order::FULFILLMENT_PICKUP,
            'COD' => Order::FULFILLMENT_DELIVERY,
            default => $requested,
        };
    }

    /**
     * The address fields a delivery cannot go out without, as a validation-style
     * error bag so the checkout form can highlight each missing input.
     */
    private function missingDeliveryAddressFields(array $validated): array
    {
        $required = [
            'delivery_contact_no' => 'Please provide a contact number the courier can call.',
            'delivery_street' => 'Please provide the house/unit number and street.',
            'delivery_barangay' => 'Please provide the barangay.',
            'delivery_city' => 'Please provide the city or municipality.',
            'delivery_province' => 'Please provide the province.',
            'delivery_postal_code' => 'Please provide the 4-digit postal code.',
        ];

        $errors = [];
        foreach ($required as $field => $message) {
            if (!filled($this->cleanAddressPart($validated[$field] ?? null))) {
                $errors[$field] = [$message];
            }
        }

        return $errors;
    }

    /** Collapse whitespace and treat a blank string as absent. */
    private function cleanAddressPart(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim(preg_replace('/\s+/u', ' ', (string) $value) ?? '');

        return $value === '' ? null : $value;
    }

    /** The destination on one line, in Philippine address order. */
    private function buildAddressLineFromParts(array $parts): string
    {
        return collect([
            $parts['delivery_street'] ?? null,
            filled($parts['delivery_barangay'] ?? null) ? 'Brgy. ' . $parts['delivery_barangay'] : null,
            $parts['delivery_city'] ?? null,
            $parts['delivery_province'] ?? null,
            $parts['delivery_postal_code'] ?? null,
        ])
            ->filter(fn ($part) => filled($part))
            ->implode(', ');
    }

    /**
     * A short code the customer shows at the counter. Ambiguous characters are
     * left out because this gets read aloud and copied off a screen.
     */
    private function generatePickupCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';

        for ($i = 0; $i < 6; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return 'PU-' . $code;
    }

    /** What the customer is told to do next, which depends on how they pay. */
    private function initialPaymentEventDescription(
        string $paymentMethod,
        string $paymentStatus,
        bool $isPickup,
        bool $hasGcashReference = true,
    ): string {
        if ($paymentStatus === 'paid') {
            return $isPickup
                ? 'Payment was confirmed. We are preparing your order for pickup at the FMRC office.'
                : 'Payment was confirmed and the order is queued for shipping.';
        }

        return match ($paymentMethod) {
            'COP' => 'No advance payment is needed. Pay in cash at the FMRC office when you collect your order.',
            'COD' => 'No advance payment is needed. Pay in cash to the courier when your order is delivered.',
            'GCash' => $hasGcashReference
                ? 'We received your GCash reference number and are matching it against the FMRC GCash account. Your order moves forward as soon as it is confirmed.'
                : 'Send the total to the FMRC GCash account, then enter your reference number under My Orders. Your order moves forward once we confirm the payment.',
            default => 'Payment is pending. We will verify and continue processing your order shortly.',
        };
    }

    /**
     * Reduce a customer-supplied GCash reference to the bare digits GCash
     * itself prints on the receipt.
     *
     * Customers paste it with spaces or dashes, or type the whole "Ref. No.
     * 0123 456 789 012" line. Stripping to digits means staff can search the
     * exact string in their GCash app, and the length check catches an order
     * number or a phone number typed into the wrong box. Returns null when
     * there is nothing usable.
     */
    private function normalizeGcashReference(?string $raw): ?string
    {
        $digits = preg_replace('/\D/', '', (string) $raw);
        $expected = (int) config('payments.gcash.reference_digits', 13);

        return strlen((string) $digits) === $expected ? $digits : null;
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

    /**
     * Drop from a select list any column the database does not actually have.
     *
     * Deploys copy the PHP up first and the migrations are run by hand
     * afterwards, so there is always a window where this code knows about a
     * column the schema does not. Naming a missing column in a select list
     * turns that window into a 500 on the whole screen - MySQL answers
     * "Unknown column 'submitted_at' in 'field list'" - which is what blanked
     * the Orders pages with a bare "Server Error". Leaving the column out
     * instead costs the one feature that reads it until the migration runs,
     * and the rest of the page still loads.
     *
     * @param  array<int, string>  $columns
     * @return array<int, string>
     */
    private function existingColumns(string $table, array $columns): array
    {
        $known = $this->tableColumns($table);

        // Inspection failed (permissions, driver, table gone): behave exactly
        // as before rather than silently narrowing the payload.
        if ($known === []) {
            return $columns;
        }

        $present = array_values(array_filter(
            $columns,
            fn (string $column) => in_array($column, $known, true),
        ));

        if (count($present) !== count($columns)) {
            Log::warning('[ORDERS] Skipped columns missing from the database - run the pending migrations', [
                'table' => $table,
                'missing' => array_values(array_diff($columns, $present)),
            ]);
        }

        return $present;
    }

    /** @return array<int, string> */
    private function tableColumns(string $table): array
    {
        if (! array_key_exists($table, self::$tableColumns)) {
            try {
                self::$tableColumns[$table] = Schema::getColumnListing($table);
            } catch (\Throwable $error) {
                Log::warning('[ORDERS] Unable to inspect table columns', [
                    'table' => $table,
                    'message' => $error->getMessage(),
                ]);

                self::$tableColumns[$table] = [];
            }
        }

        return self::$tableColumns[$table];
    }

    /**
     * The payment columns every orders payload needs. `submitted_at` and
     * `proof_path` arrived with the manual GCash rail and `refunded_at` /
     * `refund_reference` with cancellations, so all four go through the
     * schema guard.
     *
     * @return array<int, string>
     */
    private function paymentSelectColumns(): array
    {
        return $this->existingColumns('payments', [
            'id',
            'order_id',
            'payment_no',
            'method',
            'reference',
            'amount',
            'status',
            'submitted_at',
            'proof_path',
            'paid_at',
            'refunded_at',
            'refund_reference',
        ]);
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
     * Where this order stands on money, for both the customer's "Pay now" panel
     * and the staff verification queue.
     *
     * Three states matter and they are easy to conflate: nothing sent yet, the
     * customer says they sent it, and staff have confirmed it. Only the third is
     * revenue. Cash orders have none of this - there is nothing to wait for when
     * the money changes hands at the counter or at the door.
     */
    private function buildPaymentState(Order $order): array
    {
        $payment = $order->payment;
        $status = $payment?->status ?? 'pending';
        $isGcash = ($payment?->method ?? $order->payment_method) === 'GCash';
        $isConfirmed = $status === 'paid';
        // A cancelled order is as dead as a rejected one as far as collecting
        // money goes, so both close the pay panel.
        $isRejected = in_array($order->lifecycle_status, ['rejected', 'cancelled'], true);
        $hasClaim = (bool) $payment?->hasCustomerClaim();

        // A rejected order must not invite payment, and a confirmed one has
        // nothing left to ask for.
        $awaitingPayment = $isGcash && ! $isConfirmed && ! $isRejected && ! $hasClaim;
        $underReview = $isGcash && ! $isConfirmed && ! $isRejected && $hasClaim;

        $dueAt = $order->payment_due_at;
        $isOverdue = $awaitingPayment && $dueAt !== null && $dueAt->isPast();

        return [
            'payment_due_at' => $this->formatPhilippineIso($dueAt),
            'payment_due_label' => $this->formatPhilippineLabel($dueAt),
            'payment_submitted_at' => $this->formatPhilippineIso($payment?->submitted_at),
            'payment_submitted_label' => $this->formatPhilippineLabel($payment?->submitted_at),
            'payment_confirmed_at' => $this->formatPhilippineIso($payment?->paid_at),
            'payment_confirmed_label' => $this->formatPhilippineLabel($payment?->paid_at),
            'payment_amount_label' => $this->formatMoney((float) ($payment?->amount ?? $order->total)),
            'payment_proof_url' => $payment?->proofUrl(),
            'payment_reference_supplied' => $hasClaim,
            'awaiting_customer_payment' => $awaitingPayment,
            'payment_under_review' => $underReview,
            'payment_is_confirmed' => $isConfirmed,
            'payment_is_overdue' => $isOverdue,
            // Refund side of the same row: set once staff have sent the money
            // back, which is the only thing that closes out a cancelled paid
            // order or an approved return.
            'payment_is_refunded' => $status === 'refunded',
            'payment_refunded_at' => $this->formatPhilippineIso($payment?->refunded_at),
            'payment_refunded_label' => $this->formatPhilippineLabel($payment?->refunded_at),
            'payment_refund_reference' => $payment?->refund_reference,
            'payment_action_label' => match (true) {
                $isConfirmed => 'Payment confirmed',
                $underReview => 'Payment under review',
                $awaitingPayment => 'Pay with GCash',
                default => null,
            },
        ];
    }

    /**
     * Everything the customer's card and the admin modal need to say about a
     * cancellation: whether one can be started, whether one is pending, and - if
     * the order is already dead - why and whether money is owed back.
     */
    private function buildCancellationState(Order $order): array
    {
        $availability = $order->cancellationAvailability();
        $state = (string) ($order->cancel_state ?? 'none');
        $isCancelled = $order->isCancelled();
        $requestedByCustomer = $state !== 'none';

        return [
            'cancel_state' => $state,
            'cancel_state_label' => Order::CANCEL_STATE_LABELS[$state] ?? 'Not requested',
            'is_cancelled' => $isCancelled,
            // Only a customer-driven cancellation says "cancelled by you" in the
            // customer's list; staff rejecting an order is a different message.
            'cancelled_by_customer' => $isCancelled && $requestedByCustomer,
            'can_request_cancel' => $availability['allowed'],
            // False means "we will ask staff first" - the sheet changes its
            // button and its warning accordingly.
            'cancel_is_immediate' => $availability['immediate'],
            'cancel_blocked_reason' => $availability['reason'],
            'cancel_pending' => $order->hasPendingCancellation(),
            'cancel_reason' => $order->cancel_reason,
            'cancel_reason_label' => $order->cancelReasonLabel(),
            'cancel_reason_detail' => $order->cancel_reason_detail,
            'cancel_requested_at' => $this->formatPhilippineIso($order->cancel_requested_at),
            'cancel_requested_label' => $this->formatPhilippineLabel($order->cancel_requested_at),
            'cancelled_at' => $this->formatPhilippineIso($order->cancelled_at),
            'cancelled_at_label' => $this->formatPhilippineLabel($order->cancelled_at),
            'cancel_decided_at' => $this->formatPhilippineIso($order->cancel_decided_at),
            'cancel_decided_label' => $this->formatPhilippineLabel($order->cancel_decided_at),
            'cancel_decision_note' => $order->cancel_decision_note,
            'cancel_refund_due' => (bool) $order->cancel_refund_due,
        ];
    }

    /** The cancel sheet's radio list, in display order. */
    private function cancelReasonOptions(): array
    {
        return array_map(
            fn (string $value) => [
                'value' => $value,
                'label' => Order::CANCEL_REASON_LABELS[$value] ?? $value,
                // Only "Other" forces the customer to type something.
                'requires_detail' => $value === 'other',
            ],
            Order::CANCEL_REASONS,
        );
    }

    /**
     * How this order reaches the customer, as one flat block the customer app,
     * the admin table and the courier label can all read.
     *
     * Older rows predate `fulfillment_type`, so it is inferred from the payment
     * method rather than assumed - Cash-on-Pickup was never shipped.
     */
    /**
     * What "approved" means to the customer, which depends on where the order
     * goes next: a pickup order is being packed for the counter, a delivery
     * order is queued for the courier. Same event, two different next steps.
     */
    private function approvalEventDescription(Order $order): string
    {
        return $order->isPickup()
            ? 'Your order has been confirmed. FMRC is preparing it and will tell you as soon as it is ready to collect at the office.'
            : 'Your order has been confirmed and is now being processed for delivery.';
    }

    /**
     * Stage names as this particular order should say them.
     *
     * Sent with every order so the customer's chip, the admin table and the
     * tracking modal's dropdown all read the same words. The alternative -
     * each of the three re-deciding pickup wording for itself - is how a
     * pickup order ends up labelled "Out for delivery" in one place and
     * "Ready for pickup" in another.
     *
     * @return array<string, string>
     */
    private function stageLabels(Order $order): array
    {
        return $order->isPickup() ? self::PICKUP_STAGE_LABELS : self::STAGE_LABELS;
    }

    /** One stage of this order, named the way this order should say it. */
    private function stageLabel(Order $order, ?string $stage): string
    {
        $labels = $this->stageLabels($order);

        return $labels[(string) $stage] ?? $labels['to_pay'];
    }

    private function buildFulfillmentState(Order $order): array
    {
        $type = in_array($order->fulfillment_type, [Order::FULFILLMENT_PICKUP, Order::FULFILLMENT_DELIVERY], true)
            ? $order->fulfillment_type
            : ($order->payment_method === 'COP' ? Order::FULFILLMENT_PICKUP : Order::FULFILLMENT_DELIVERY);

        $isPickup = $type === Order::FULFILLMENT_PICKUP;

        $address = [
            'recipient_name' => $order->delivery_recipient_name,
            'contact_no' => $order->delivery_contact_no,
            'street' => $order->delivery_street,
            'barangay' => $order->delivery_barangay,
            'city' => $order->delivery_city,
            'province' => $order->delivery_province,
            'postal_code' => $order->delivery_postal_code,
            'landmark' => $order->delivery_landmark,
            'latitude' => $order->delivery_lat !== null ? (float) $order->delivery_lat : null,
            'longitude' => $order->delivery_lng !== null ? (float) $order->delivery_lng : null,
        ];

        // Rows created before the structured columns existed only have the
        // free-text mirror, so fall back to it rather than showing nothing.
        $addressLine = $order->deliveryAddressLine();
        if ($addressLine === '') {
            $addressLine = trim((string) ($order->location_name ?? ''));
        }

        return [
            'fulfillment_type' => $type,
            'fulfillment_label' => self::FULFILLMENT_LABELS[$type] ?? 'Courier Delivery',
            'is_pickup' => $isPickup,
            'delivery_address' => $isPickup ? null : $address,
            'delivery_address_line' => $isPickup ? null : ($addressLine !== '' ? $addressLine : null),
            'destination_label' => $isPickup ? self::PICKUP_LOCATION_NAME : ($addressLine !== '' ? $addressLine : null),
            'destination_latitude' => $isPickup
                ? self::PICKUP_LATITUDE
                : ($order->delivery_lat !== null ? (float) $order->delivery_lat : null),
            'destination_longitude' => $isPickup
                ? self::PICKUP_LONGITUDE
                : ($order->delivery_lng !== null ? (float) $order->delivery_lng : null),
            'pickup_code' => $isPickup ? $order->pickup_code : null,
            'pickup_ready_at' => $this->formatPhilippineIso($order->pickup_ready_at),
            'pickup_ready_at_label' => $this->formatPhilippineLabel($order->pickup_ready_at),
            'picked_up_at' => $this->formatPhilippineIso($order->picked_up_at),
            'picked_up_at_label' => $this->formatPhilippineLabel($order->picked_up_at),
            'courier' => $isPickup ? null : $this->buildCourierState($order),
        ];
    }

    /**
     * Human-readable name of the courier a new delivery order is stamped with
     * when the client does not name one. Reads the registry so changing the
     * centre's default courier is a config edit, not a code hunt.
     */
    private function defaultCourierLabel(): string
    {
        $key = (string) config('couriers.default', 'jnt');

        return (string) config("couriers.options.{$key}.label", 'J&T Express');
    }

    /**
     * The courier registry, for the admin tracking dropdown.
     *
     * Public and unauthenticated on purpose: it is the same list already
     * printed on the customer's order, holds no credentials, and serving it
     * from here means the dropdown cannot drift from what an order is stamped
     * with. No courier API is involved - FMRC has no contract with any of them.
     */
    public function couriers(): JsonResponse
    {
        $options = [];
        foreach ((array) config('couriers.options', []) as $key => $courier) {
            $options[] = [
                'key' => (string) $key,
                'label' => (string) ($courier['label'] ?? $key),
                'tracking_url' => $courier['tracking_url'] ?? null,
                'accepts_tracking_no' => (bool) ($courier['accepts_tracking_no'] ?? true),
            ];
        }

        return response()->json([
            'data' => $options,
            'default' => (string) config('couriers.default', 'jnt'),
            'universal_tracking_url' => config('couriers.universal_tracking_url'),
        ]);
    }

    /**
     * Where the customer can follow the parcel on the courier's own site.
     *
     * FMRC has no courier API contract, so the waybill number is whatever staff
     * typed in and the link is the courier's public tracking page. Couriers
     * whose deep-link format is not documented get their landing page plus the
     * number to paste; a courier that is not in the registry falls back to
     * 17TRACK, which detects the carrier from the number itself.
     */
    private function buildCourierState(Order $order): ?array
    {
        $name = trim((string) ($order->courier_name ?? ''));
        $trackingNo = trim((string) ($order->courier_tracking_no ?? ''));

        if ($name === '' && $trackingNo === '') {
            return null;
        }

        $registry = (array) config('couriers.options', []);
        $matchKey = null;
        foreach ($registry as $key => $courier) {
            $label = (string) ($courier['label'] ?? '');
            if ($label !== '' && strcasecmp($label, $name) === 0) {
                $matchKey = $key;
                break;
            }
        }

        $trackingUrl = $matchKey !== null
            ? ($registry[$matchKey]['tracking_url'] ?? null)
            : null;

        // Only send the customer somewhere when there is a number to look up.
        if ($trackingNo === '') {
            $trackingUrl = null;
        } elseif ($trackingUrl === null) {
            $trackingUrl = config('couriers.universal_tracking_url');
        }

        return [
            'key' => $matchKey,
            'name' => $name !== '' ? $name : null,
            'tracking_no' => $trackingNo !== '' ? $trackingNo : null,
            'tracking_url' => $trackingUrl,
        ];
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
            'customer_stage_label' => $this->stageLabel($order, $order->customer_stage),
            'stage_labels' => $this->stageLabels($order),
            'notes' => $order->notes,
            'courier_name' => $order->courier_name,
            'courier_tracking_no' => $order->courier_tracking_no,
            'location_name' => $order->location_name,
            'latitude' => $order->last_known_lat !== null ? (float) $order->last_known_lat : null,
            'longitude' => $order->last_known_lng !== null ? (float) $order->last_known_lng : null,
            'created_at' => $this->formatPhilippineIso($createdAt),
            'created_at_label' => $this->formatPhilippineLabel($createdAt),
            'latest_event' => $latestEvent ? $this->transformTimelineEvent($latestEvent, $order) : null,
        ];

        // Fulfillment: how the customer receives this order, and - for a
        // delivery - the destination broken into the parts a courier needs.
        $summary = array_merge($summary, $this->buildFulfillmentState($order));

        // Money: sent or not, claimed or not, confirmed or not.
        $summary = array_merge($summary, $this->buildPaymentState($order));

        // Cancellation: whether the customer may still call it off, and what
        // happened if they already did.
        $summary = array_merge($summary, $this->buildCancellationState($order));

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
            ->map(fn (OrderTrackingEvent $event) => $this->transformTimelineEvent($event, $order))
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

    /**
     * One timeline row.
     *
     * `$order` is only needed to name the stage: the event stores the stage key,
     * and whether that key reads "To Receive" or "Ready for Pickup" is a
     * property of the order, not of the row. Older callers may omit it, in which
     * case the delivery wording is used.
     */
    private function transformTimelineEvent(OrderTrackingEvent $event, ?Order $order = null): array
    {
        return [
            'id' => $event->id,
            'stage' => $event->stage,
            'stage_label' => $order !== null
                ? $this->stageLabel($order, $event->stage)
                : (self::STAGE_LABELS[$event->stage] ?? 'To Pay'),
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
            // What the customer claims, kept separate from what staff confirmed:
            // `date_submitted` is when they said they sent it, `date_paid` is when
            // it was matched in the FMRC GCash account.
            'date_submitted' => $this->formatPhilippineIso($payment?->submitted_at),
            'date_submitted_label' => $this->formatPhilippineLabel($payment?->submitted_at) ?? '-',
            'has_customer_claim' => (bool) $payment?->hasCustomerClaim(),
            'proof_url' => $payment?->proofUrl(),
            'date_paid' => $this->formatPhilippineIso($payment?->paid_at),
            'date_paid_label' => $this->formatPhilippineLabel($payment?->paid_at) ?? '-',
            'date_refunded' => $this->formatPhilippineIso($payment?->refunded_at),
            'date_refunded_label' => $this->formatPhilippineLabel($payment?->refunded_at) ?? '-',
            'refund_reference' => $payment?->refund_reference,
            'payment_due_at' => $this->formatPhilippineIso($order->payment_due_at),
            'payment_due_label' => $this->formatPhilippineLabel($order->payment_due_at) ?? '-',
            'lifecycle_status' => $order->lifecycle_status,
            // A cancelled order whose money is still with FMRC: the payments
            // table flags it so the refund does not get forgotten.
            'cancel_refund_due' => (bool) $order->cancel_refund_due,
            'is_cancelled' => $order->isCancelled(),
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
