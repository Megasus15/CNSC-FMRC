<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\OrderReturnEvent;
use App\Models\OrderReturnItem;
use App\Models\Payment;
use App\Support\OrderNotifier;
use App\Support\ReturnPresenter;
use DateTimeInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Returns & Refunds.
 *
 * Customer files a request against a completed order (with photo/video evidence),
 * admin/staff decide, the item travels back, it is inspected, then the refund is
 * released — every hop writing an order_return_events row so both sides see the
 * same timeline. Amounts are always recomputed server-side from order_items;
 * the client never dictates money.
 *
 * Modeled on ProductRatingController (customer-initiated + media + admin-managed
 * + soft-archived + paginated admin index with summary counters).
 */
class OrderReturnController extends Controller
{
    private const PH_TIME_ZONE = 'Asia/Manila';

    private const MEDIA_FOLDER = 'order-returns';

    /** Legal forward-only transitions. Terminal statuses map to an empty list. */
    private const TRANSITIONS = [
        'requested'         => ['approved', 'rejected', 'cancelled'],
        'approved'          => ['item_in_transit', 'item_received', 'refund_processing', 'refunded'],
        'item_in_transit'   => ['item_received'],
        'item_received'     => ['refund_processing', 'refunded'],
        'refund_processing' => ['refunded'],
        'refunded'          => [],
        'rejected'          => [],
        'cancelled'         => [],
    ];

    // ---------------------------------------------------------------------
    // Customer
    // ---------------------------------------------------------------------

    /** Customer: every return they have filed, newest first (Returns tab). */
    public function customerIndex(Request $request): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        $returns = OrderReturn::query()
            ->where('customer_id', $request->user()->id)
            ->where('is_archived', false)
            ->with([
                'order:id,order_no,total,customer_stage,lifecycle_status,completed_at',
                'items',
                'latestEvent',
            ])
            ->orderByDesc('created_at')
            ->get();

        return response()->json([
            'data' => $returns
                ->map(fn (OrderReturn $return) => $this->transformReturnSummary($return))
                ->values()
                ->all(),
            'counts' => [
                'all'    => $returns->count(),
                'open'   => $returns->whereIn('status', OrderReturn::OPEN_STATUSES)->count(),
                'closed' => $returns->whereIn('status', OrderReturn::TERMINAL_STATUSES)->count(),
            ],
        ]);
    }

    /**
     * Customer: can this order still be returned, and what may be returned?
     *
     * Powers the Return / Refund button: it disables itself with a readable
     * reason instead of letting the customer discover a 422 the hard way.
     */
    public function eligibility(Request $request, Order $order): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        if ((int) $order->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'This order belongs to another account.'], 403);
        }

        $order->load(['items', 'activeReturn', 'latestReturn']);
        $verdict = $this->evaluateEligibility($order);

        return response()->json([
            'eligible'        => $verdict['eligible'],
            'reason'          => $verdict['reason'],
            'window_days'     => OrderReturn::WINDOW_DAYS,
            'deadline'        => $this->formatPhilippineIso($verdict['deadline']),
            'deadline_label'  => $this->formatPhilippineLabel($verdict['deadline']),
            'days_remaining'  => $verdict['days_remaining'],
            'active_return'   => $order->activeReturn
                ? $this->transformReturnSummary($order->activeReturn->loadMissing(['items', 'latestEvent']))
                : null,
            'reasons'         => $this->vocabulary(OrderReturn::REASONS, OrderReturn::REASON_LABELS),
            'resolutions'     => $this->vocabulary(OrderReturn::RESOLUTIONS, OrderReturn::RESOLUTION_LABELS),
            'items'           => $order->items
                ->map(fn (OrderItem $item) => [
                    'order_item_id' => $item->id,
                    'product_id'    => $item->product_id,
                    'product_name'  => $item->product_name,
                    'unit_price'    => (float) $item->unit_price,
                    'quantity'      => (int) $item->quantity,
                    'line_total'    => (float) $item->line_total,
                    'returned_quantity' => $this->alreadyReturnedQuantity($item),
                ])
                ->values()
                ->all(),
        ]);
    }

    /** Customer: file a return request (multipart — evidence media allowed). */
    public function store(Request $request, Order $order): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        $user = $request->user();

        if ((int) $order->customer_id !== (int) $user->id) {
            return response()->json(['message' => 'This order belongs to another account.'], 403);
        }

        $order->load(['items', 'activeReturn']);
        $verdict = $this->evaluateEligibility($order);

        if (!$verdict['eligible']) {
            return response()->json(['message' => $verdict['reason']], 422);
        }

        $validated = $request->validate([
            'reason'          => ['required', Rule::in(OrderReturn::REASONS)],
            'reason_detail'   => ['nullable', 'string', 'max:600'],
            'resolution'      => ['required', Rule::in(OrderReturn::RESOLUTIONS)],
            'customer_note'   => ['nullable', 'string', 'max:1000'],
            'items'           => ['required', 'array', 'min:1'],
            'items.*.order_item_id' => ['required', 'integer', 'min:1'],
            'items.*.quantity'      => ['required', 'integer', 'min:1'],
            'media'           => ['nullable', 'array', 'max:6'],
            'media.*'         => ['file', 'mimes:jpg,jpeg,png,webp,gif,mp4,mov,webm', 'max:20480'],
        ]);

        if ($validated['reason'] === 'other' && trim((string) ($validated['reason_detail'] ?? '')) === '') {
            return response()->json([
                'message' => 'Please describe the reason for your return.',
                'errors'  => ['reason_detail' => ['Please describe the reason for your return.']],
            ], 422);
        }

        // Resolve the selected lines against the order itself — quantities are
        // capped at what was actually bought (minus anything already returned).
        $itemsById = $order->items->keyBy(fn (OrderItem $item) => (int) $item->id);
        $lines = [];

        foreach ($validated['items'] as $row) {
            $orderItemId = (int) $row['order_item_id'];
            $lineItem = $itemsById->get($orderItemId);

            if (!$lineItem) {
                return response()->json([
                    'message' => 'One of the selected products is not part of this order.',
                ], 422);
            }

            $available = max(0, (int) $lineItem->quantity - $this->alreadyReturnedQuantity($lineItem));
            $quantity = min((int) $row['quantity'], $available);

            if ($quantity < 1) {
                return response()->json([
                    'message' => "\"{$lineItem->product_name}\" has already been fully returned.",
                ], 422);
            }

            $unitPrice = (float) $lineItem->unit_price;
            $lines[$orderItemId] = [
                'order_item_id' => $orderItemId,
                'product_id'    => $lineItem->product_id,
                'product_name'  => $lineItem->product_name,
                'quantity'      => $quantity,
                'unit_price'    => $unitPrice,
                'line_total'    => round($unitPrice * $quantity, 2),
            ];
        }

        if (!$lines) {
            return response()->json(['message' => 'Select at least one product to return.'], 422);
        }

        $requestedAmount = round(array_sum(array_column($lines, 'line_total')), 2);
        $media = $this->storeUploadedMedia($request->file('media'));

        try {
            $return = DB::transaction(function () use ($order, $user, $validated, $lines, $requestedAmount, $media): OrderReturn {
                // Re-check inside the transaction so two taps cannot both open one.
                $alreadyOpen = OrderReturn::query()
                    ->where('order_id', $order->id)
                    ->whereIn('status', OrderReturn::OPEN_STATUSES)
                    ->lockForUpdate()
                    ->exists();

                if ($alreadyOpen) {
                    throw new \DomainException('A return request for this order is already being processed.');
                }

                $return = OrderReturn::create([
                    'order_id'         => $order->id,
                    'customer_id'      => $user->id,
                    'status'           => 'requested',
                    'reason'           => $validated['reason'],
                    'reason_detail'    => $this->cleanText($validated['reason_detail'] ?? null),
                    'resolution'       => $validated['resolution'],
                    'customer_note'    => $this->cleanText($validated['customer_note'] ?? null),
                    'media'            => $media,
                    'requested_amount' => $requestedAmount,
                    'requested_at'     => now(),
                ]);

                $return->update(['return_no' => $this->generateReturnNo($return->id)]);

                foreach ($lines as $line) {
                    OrderReturnItem::create(array_merge($line, ['order_return_id' => $return->id]));
                }

                $this->recordEvent($return, [
                    'status'      => 'requested',
                    'actor_role'  => 'customer',
                    'title'       => 'Return requested',
                    'description' => $return->reasonLabel() . ' · Preferred resolution: ' . $return->resolutionLabel(),
                    'created_by_user_id' => $user->id,
                    'metadata'    => [
                        'requested_amount' => $requestedAmount,
                        'items'            => array_values($lines),
                    ],
                ]);

                return $return;
            });
        } catch (\DomainException $error) {
            $this->deleteStoredMedia($media);

            return response()->json(['message' => $error->getMessage()], 422);
        } catch (\Throwable $error) {
            $this->deleteStoredMedia($media);
            Log::error('[RETURN] Could not create return request: ' . $error->getMessage());

            return response()->json(['message' => 'Could not submit your return request. Please try again.'], 500);
        }

        $return->load(['order', 'items', 'events', 'customer']);

        OrderNotifier::notifyAdmins(
            'order_return',
            'New return request',
            ($order->customer_name ?: 'A customer') . ' requested a return for order '
                . ($order->order_no ?: "ORD-{$order->id}") . ' (' . $return->reasonLabel() . ').',
            [
                'order_id'   => $order->id,
                'return_id'  => $return->id,
                'return_no'  => $return->return_no,
                'amount'     => $requestedAmount,
            ],
        );

        OrderNotifier::emailCustomer(
            $order,
            'Return request received — ' . ($return->return_no ?: "RTN-{$return->id}"),
            OrderNotifier::buildEmailHtml(
                $order,
                'We received your return request',
                "Your return request {$return->return_no} for order "
                    . ($order->order_no ?: "ORD-{$order->id}")
                    . " has been submitted and is now under review.\n\nReason: "
                    . $return->reasonLabel()
                    . "\nPreferred resolution: " . $return->resolutionLabel()
                    . "\n\nWe will notify you as soon as it has been reviewed.",
                '#8f1111',
                $return->statusLabel(),
                $this->formatMoney($requestedAmount),
            ),
        );

        return response()->json([
            'message' => 'Return request submitted. We will review it shortly.',
            'data'    => $this->transformReturnDetail($return),
        ], 201);
    }

    /** Customer: full detail + timeline for one of their returns. */
    public function customerShow(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        if ((int) $orderReturn->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'This return belongs to another account.'], 403);
        }

        $orderReturn->load(['order', 'items', 'events', 'handler:id,name,role']);

        return response()->json(['data' => $this->transformReturnDetail($orderReturn)]);
    }

    /** Customer: withdraw a request that has not been decided yet. */
    public function cancel(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        if ((int) $orderReturn->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'This return belongs to another account.'], 403);
        }

        if ($orderReturn->status !== 'requested') {
            return response()->json([
                'message' => 'This request can no longer be cancelled — it is already ' . strtolower($orderReturn->statusLabel()) . '.',
            ], 422);
        }

        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:400'],
        ]);

        $orderReturn->update([
            'status'      => 'cancelled',
            'decided_at'  => now(),
        ]);

        $this->recordEvent($orderReturn, [
            'status'      => 'cancelled',
            'actor_role'  => 'customer',
            'title'       => 'Request cancelled',
            'description' => $this->cleanText($validated['note'] ?? null) ?? 'The customer withdrew this return request.',
            'created_by_user_id' => $request->user()->id,
        ]);

        $order = $orderReturn->order;

        if ($order) {
            OrderNotifier::notifyAdmins(
                'order_return',
                'Return request cancelled',
                ($order->customer_name ?: 'A customer') . ' cancelled return ' . ($orderReturn->return_no ?: "RTN-{$orderReturn->id}") . '.',
                ['order_id' => $order->id, 'return_id' => $orderReturn->id],
            );
        }

        $orderReturn->load(['order', 'items', 'events', 'handler:id,name,role']);

        return response()->json([
            'message' => 'Return request cancelled.',
            'data'    => $this->transformReturnDetail($orderReturn),
        ]);
    }

    /** Customer: mark the item as sent back (return courier + tracking no.). */
    public function shipped(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        if ((int) $orderReturn->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'This return belongs to another account.'], 403);
        }

        if ($orderReturn->status !== 'approved') {
            return response()->json([
                'message' => $orderReturn->status === 'item_in_transit'
                    ? 'This item is already marked as on its way back.'
                    : 'You can only send the item back once the request has been approved.',
            ], 422);
        }

        $validated = $request->validate([
            'return_courier_name' => ['required', 'string', 'max:120'],
            'return_tracking_no'  => ['nullable', 'string', 'max:140'],
            'note'                => ['nullable', 'string', 'max:400'],
        ]);

        $orderReturn->update([
            'status'              => 'item_in_transit',
            'return_courier_name' => trim($validated['return_courier_name']),
            'return_tracking_no'  => $this->cleanText($validated['return_tracking_no'] ?? null),
        ]);

        $trackingLabel = $orderReturn->return_tracking_no
            ? " · Tracking no. {$orderReturn->return_tracking_no}"
            : '';

        $this->recordEvent($orderReturn, [
            'status'      => 'item_in_transit',
            'actor_role'  => 'customer',
            'title'       => 'Item sent back',
            'description' => 'Sent via ' . $orderReturn->return_courier_name . $trackingLabel
                . ($this->cleanText($validated['note'] ?? null) ? "\n" . $this->cleanText($validated['note']) : ''),
            'created_by_user_id' => $request->user()->id,
            'metadata'    => [
                'courier'  => $orderReturn->return_courier_name,
                'tracking' => $orderReturn->return_tracking_no,
            ],
        ]);

        $order = $orderReturn->order;

        if ($order) {
            OrderNotifier::notifyAdmins(
                'order_return',
                'Returned item in transit',
                ($order->customer_name ?: 'A customer') . ' sent back the item for return '
                    . ($orderReturn->return_no ?: "RTN-{$orderReturn->id}") . ' via '
                    . $orderReturn->return_courier_name . '.',
                [
                    'order_id'  => $order->id,
                    'return_id' => $orderReturn->id,
                    'courier'   => $orderReturn->return_courier_name,
                    'tracking'  => $orderReturn->return_tracking_no,
                ],
            );
        }

        $orderReturn->load(['order', 'items', 'events', 'handler:id,name,role']);

        return response()->json([
            'message' => 'Thanks! We will let you know once the item arrives.',
            'data'    => $this->transformReturnDetail($orderReturn),
        ]);
    }

    // ---------------------------------------------------------------------
    // Admin & staff
    // ---------------------------------------------------------------------

    /** Admin/Staff: paginated Returns & Refunds queue + summary counters. */
    public function adminIndex(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $query = OrderReturn::query()
            ->where('is_archived', false)
            ->with(['order:id,order_no,customer_name,total', 'items', 'customer:id,name,email', 'latestEvent'])
            ->orderByDesc('created_at');

        $this->applyAdminFilters($query, $request);

        $returns = $query->paginate(10);
        $summaryQuery = OrderReturn::query()->where('is_archived', false);

        return response()->json([
            'data' => collect($returns->items())
                ->map(fn (OrderReturn $return) => $this->transformReturnSummary($return, true))
                ->values(),
            'meta' => [
                'current_page' => $returns->currentPage(),
                'last_page'    => $returns->lastPage(),
                'total'        => $returns->total(),
            ],
            'summary' => $this->adminSummary($summaryQuery),
        ]);
    }

    /** Admin/Staff: one return with items, evidence and the full timeline. */
    public function adminShow(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $orderReturn->load([
            'order.items',
            'order.payment',
            'items',
            'events',
            'customer:id,name,email',
            'handler:id,name,role',
        ]);

        return response()->json(['data' => $this->transformReturnDetail($orderReturn, true)]);
    }

    /** Admin/Staff: approve or reject a pending request. */
    public function decision(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'decision'        => ['required', Rule::in(['approve', 'reject'])],
            'decision_note'   => ['nullable', 'string', 'max:800'],
            'approved_amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $approving = $validated['decision'] === 'approve';
        $target = $approving ? 'approved' : 'rejected';

        if ($blocked = $this->guardTransition($orderReturn, $target)) {
            return $blocked;
        }

        $note = $this->cleanText($validated['decision_note'] ?? null);

        if (!$approving && !$note) {
            return response()->json([
                'message' => 'A reason is required when rejecting a return request.',
                'errors'  => ['decision_note' => ['Tell the customer why the request was rejected.']],
            ], 422);
        }

        $requested = (float) $orderReturn->requested_amount;

        // Approving for nothing is only meaningful on a zero-priced return
        // (replacement or rework on an order whose items carry no amount).
        // Anywhere else it would silently wipe out the customer's refund.
        if ($approving
            && array_key_exists('approved_amount', $validated)
            && $validated['approved_amount'] !== null
            && round((float) $validated['approved_amount'], 2) <= 0
            && $requested > 0
        ) {
            return response()->json([
                'message' => 'The approved amount must be greater than zero.',
                'errors'  => ['approved_amount' => ['Approved amount must be greater than zero.']],
            ], 422);
        }

        $approvedAmount = $approving
            ? round(min((float) ($validated['approved_amount'] ?? $requested), $requested), 2)
            : null;

        $orderReturn->update([
            'status'             => $target,
            'handled_by_user_id' => $request->user()->id,
            'decided_at'         => now(),
            'decision_note'      => $note,
            'approved_amount'    => $approvedAmount,
        ]);

        $this->recordEvent($orderReturn, [
            'status'      => $target,
            'actor_role'  => $request->user()->role ?? 'admin',
            'title'       => $approving ? 'Return approved' : 'Return rejected',
            'description' => $approving
                ? 'Approved for ' . $this->formatMoney((float) $approvedAmount)
                    . ($note ? "\n" . $note : "\nPlease send the item back using any trusted courier.")
                : $note,
            'created_by_user_id' => $request->user()->id,
            'metadata'    => ['approved_amount' => $approvedAmount],
        ]);

        $this->emailStatusUpdate(
            $orderReturn,
            $approving ? 'Your return request was approved' : 'Your return request was declined',
            $approving
                ? "Good news — return {$orderReturn->return_no} has been approved for "
                    . $this->formatMoney((float) $approvedAmount) . ".\n\n"
                    . ($note ?: 'Please send the item back using any trusted courier, then mark it as shipped in My Orders → Returns so we can track it.')
                : "Return {$orderReturn->return_no} was not approved.\n\nReason: {$note}\n\n"
                    . 'If you believe this was a mistake you may file a new request while the return window is still open.',
            $approving ? '#8f1111' : '#b71c1c',
            $approving ? $this->formatMoney((float) $approvedAmount) : null,
        );

        $orderReturn->load(['order.items', 'items', 'events', 'customer:id,name,email', 'handler:id,name,role']);

        return response()->json([
            'message' => $approving ? 'Return request approved.' : 'Return request rejected.',
            'data'    => $this->transformReturnDetail($orderReturn, true),
        ]);
    }

    /** Admin/Staff: confirm the returned item arrived and passed inspection. */
    public function received(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        if ($blocked = $this->guardTransition($orderReturn, 'item_received')) {
            return $blocked;
        }

        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:800'],
        ]);

        $note = $this->cleanText($validated['note'] ?? null);

        $orderReturn->update([
            'status'             => 'item_received',
            'handled_by_user_id' => $request->user()->id,
            'item_received_at'   => now(),
        ]);

        $this->recordEvent($orderReturn, [
            'status'      => 'item_received',
            'actor_role'  => $request->user()->role ?? 'admin',
            'title'       => 'Item received & inspected',
            'description' => $note ?: 'The returned item arrived at UCN-FMRC and passed inspection.',
            'created_by_user_id' => $request->user()->id,
        ]);

        $this->emailStatusUpdate(
            $orderReturn,
            'We received your returned item',
            "The item for return {$orderReturn->return_no} has arrived and passed inspection.\n\n"
                . ($note ?: 'Your refund is next — we will notify you the moment it is released.'),
        );

        $orderReturn->load(['order.items', 'items', 'events', 'customer:id,name,email', 'handler:id,name,role']);

        return response()->json([
            'message' => 'Returned item marked as received.',
            'data'    => $this->transformReturnDetail($orderReturn, true),
        ]);
    }

    /**
     * Admin/Staff: move the money.
     *
     * `stage=processing` parks the return at `refund_processing` (refund filed
     * with the payment provider); the default `released` completes it and flips
     * the order's payment row to `refunded`.
     */
    public function refund(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'stage'            => ['nullable', Rule::in(['processing', 'released'])],
            'refund_method'    => ['required', Rule::in(OrderReturn::REFUND_METHODS)],
            'amount'           => ['nullable', 'numeric', 'min:0'],
            'refund_reference' => ['nullable', 'string', 'max:180'],
            'note'             => ['nullable', 'string', 'max:800'],
        ]);

        $releasing = ($validated['stage'] ?? 'released') === 'released';
        $target = $releasing ? 'refunded' : 'refund_processing';

        if ($blocked = $this->guardTransition($orderReturn, $target)) {
            return $blocked;
        }

        $ceiling = (float) ($orderReturn->approved_amount ?? $orderReturn->requested_amount);
        $amount = round(min((float) ($validated['amount'] ?? $ceiling), (float) $orderReturn->requested_amount), 2);

        // Closing a return for ₱ 0.00 is only valid when there was never any
        // money to give back; otherwise it would mark the payment refunded
        // while the customer receives nothing.
        if ($amount <= 0 && $ceiling > 0) {
            return response()->json([
                'message' => 'The refund amount must be greater than zero.',
                'errors'  => ['amount' => ['Refund amount must be greater than zero.']],
            ], 422);
        }

        $note = $this->cleanText($validated['note'] ?? null);
        $reference = $this->cleanText($validated['refund_reference'] ?? null);
        $actor = $request->user();

        DB::transaction(function () use ($orderReturn, $target, $releasing, $amount, $validated, $reference, $actor): void {
            $orderReturn->update(array_filter([
                'status'             => $target,
                'handled_by_user_id' => $actor->id,
                'refund_method'      => $validated['refund_method'],
                'refund_reference'   => $reference,
                'approved_amount'    => $orderReturn->approved_amount ?? $amount,
                'refunded_amount'    => $releasing ? $amount : null,
                'refunded_at'        => $releasing ? now() : null,
            ], fn ($value) => $value !== null));

            if ($releasing) {
                // payments.status already accepts 'refunded' — drive the existing
                // payment state instead of inventing a parallel one.
                Payment::query()
                    ->where('order_id', $orderReturn->order_id)
                    ->update(['status' => 'refunded', 'updated_at' => now()]);
            }
        });

        $methodLabel = OrderReturn::REFUND_METHOD_LABELS[$validated['refund_method']] ?? $validated['refund_method'];

        $this->recordEvent($orderReturn, [
            'status'      => $target,
            'actor_role'  => $actor->role ?? 'admin',
            'title'       => $releasing ? 'Refund released' : 'Refund processing',
            'description' => ($releasing
                ? $this->formatMoney($amount) . ' refunded via ' . $methodLabel
                : 'Refund of ' . $this->formatMoney($amount) . ' is being released via ' . $methodLabel)
                . ($reference ? " · Ref. {$reference}" : '')
                . ($note ? "\n" . $note : ''),
            'created_by_user_id' => $actor->id,
            'metadata'    => [
                'amount'    => $amount,
                'method'    => $validated['refund_method'],
                'reference' => $reference,
            ],
        ]);

        $orderReturn->refresh();

        $this->emailStatusUpdate(
            $orderReturn,
            $releasing ? 'Your refund has been released' : 'Your refund is being processed',
            $releasing
                ? "Your refund for return {$orderReturn->return_no} has been released via {$methodLabel}."
                    . ($reference ? "\nReference: {$reference}" : '')
                    . ($note ? "\n\n{$note}" : "\n\nPlease allow a short while for it to reflect on your side.")
                : "We are releasing your refund for return {$orderReturn->return_no} via {$methodLabel}."
                    . ($note ? "\n\n{$note}" : "\n\nYou will get another update once the money is out."),
            $releasing ? '#2e7d32' : '#8f1111',
            $this->formatMoney($amount),
        );

        $orderReturn->load(['order.items', 'order.payment', 'items', 'events', 'customer:id,name,email', 'handler:id,name,role']);

        return response()->json([
            'message' => $releasing
                ? 'Refund released. The order payment is now marked as refunded.'
                : 'Return marked as refund processing.',
            'data'    => $this->transformReturnDetail($orderReturn, true),
        ]);
    }

    /** Admin/Staff: every non-archived return ID matching the current filters. */
    public function adminAllIds(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $query = OrderReturn::query()
            ->where('is_archived', false)
            ->orderByDesc('created_at');

        $this->applyAdminFilters($query, $request);

        return response()->json([
            'ids' => $query->pluck('id')->map(fn ($id) => (int) $id)->values()->all(),
        ]);
    }

    /** Admin/Staff: soft-archive closed returns into the unified Archives page. */
    public function archiveBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids'   => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $archivedIds = DB::transaction(function () use ($ids): array {
            // Only closed returns may be archived — an open request must stay in
            // the queue where someone can still act on it.
            $query = OrderReturn::query()
                ->whereIn('id', $ids)
                ->where('is_archived', false)
                ->whereIn('status', OrderReturn::TERMINAL_STATUSES);

            $eligibleIds = $query->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if (!$eligibleIds) {
                return [];
            }

            OrderReturn::query()->whereIn('id', $eligibleIds)->update([
                'is_archived' => true,
                'archived_at' => now(),
                'updated_at'  => now(),
            ]);

            return $eligibleIds;
        });

        if (!$archivedIds) {
            return response()->json([
                'message' => 'No closed returns were found to archive. Only refunded, rejected or cancelled returns can be archived.',
            ], 404);
        }

        return response()->json([
            'action'          => 'archive',
            'scope'           => 'return',
            'processed_ids'   => $archivedIds,
            'processed_count' => count($archivedIds),
            'skipped_ids'     => array_values(array_diff($ids, $archivedIds)),
            'message'         => count($archivedIds) . ' return(s) archived successfully.',
        ]);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /** Shared status/search filtering for the admin index and its all-ids twin. */
    private function applyAdminFilters(\Illuminate\Database\Eloquent\Builder $query, Request $request): void
    {
        $status = trim((string) $request->query('status'));

        if ($status !== '' && $status !== 'all') {
            if ($status === 'open') {
                $query->whereIn('status', OrderReturn::OPEN_STATUSES);
            } elseif ($status === 'closed') {
                $query->whereIn('status', OrderReturn::TERMINAL_STATUSES);
            } elseif (in_array($status, OrderReturn::STATUSES, true)) {
                $query->where('status', $status);
            }
        }

        if ($reason = trim((string) $request->query('reason'))) {
            if (in_array($reason, OrderReturn::REASONS, true)) {
                $query->where('reason', $reason);
            }
        }

        if ($search = trim((string) $request->query('search'))) {
            $query->where(function ($outer) use ($search) {
                $outer->where('return_no', 'like', "%{$search}%")
                    ->orWhere('refund_reference', 'like', "%{$search}%")
                    ->orWhere('return_tracking_no', 'like', "%{$search}%")
                    ->orWhereHas('order', fn ($order) => $order
                        ->where('order_no', 'like', "%{$search}%")
                        ->orWhere('customer_name', 'like', "%{$search}%"))
                    ->orWhereHas('customer', fn ($user) => $user
                        ->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%"))
                    ->orWhereHas('items', fn ($item) => $item->where('product_name', 'like', "%{$search}%"));
            });
        }
    }

    /** @return array<string, int|float> */
    private function adminSummary(\Illuminate\Database\Eloquent\Builder $summaryQuery): array
    {
        return [
            'total'       => (int) (clone $summaryQuery)->count(),
            'requested'   => (int) (clone $summaryQuery)->where('status', 'requested')->count(),
            'in_progress' => (int) (clone $summaryQuery)
                ->whereIn('status', ['approved', 'item_in_transit', 'item_received', 'refund_processing'])
                ->count(),
            'refunded'    => (int) (clone $summaryQuery)->where('status', 'refunded')->count(),
            'rejected'    => (int) (clone $summaryQuery)->where('status', 'rejected')->count(),
            'cancelled'   => (int) (clone $summaryQuery)->where('status', 'cancelled')->count(),
            'open'        => (int) (clone $summaryQuery)->whereIn('status', OrderReturn::OPEN_STATUSES)->count(),
            'refunded_amount' => round((float) ((clone $summaryQuery)->sum('refunded_amount') ?? 0), 2),
        ];
    }

    /**
     * Is this order returnable, and if not, why not?
     *
     * @return array{eligible: bool, reason: ?string, deadline: ?Carbon, days_remaining: ?int}
     */
    private function evaluateEligibility(Order $order): array
    {
        $anchor = $order->completed_at ?? $order->updated_at ?? $order->created_at;
        $deadline = $anchor
            ? Carbon::instance($anchor)->timezone(self::PH_TIME_ZONE)->addDays(OrderReturn::WINDOW_DAYS)
            : null;
        $daysRemaining = $deadline ? (int) ceil(now()->diffInDays($deadline, false)) : null;

        $verdict = fn (bool $eligible, ?string $reason) => [
            'eligible'       => $eligible,
            'reason'         => $reason,
            'deadline'       => $deadline,
            'days_remaining' => $daysRemaining !== null ? max(0, $daysRemaining) : null,
        ];

        if ($order->lifecycle_status === 'rejected') {
            return $verdict(false, 'This order was rejected, so there is nothing to return.');
        }

        if ($order->customer_stage !== 'completed') {
            return $verdict(false, 'Only completed orders can be returned. Confirm you received the order first.');
        }

        $activeReturn = $order->relationLoaded('activeReturn')
            ? $order->activeReturn
            : $order->activeReturn()->first();

        if ($activeReturn) {
            return $verdict(false, 'A return request for this order is already being processed.');
        }

        $items = $order->relationLoaded('items') ? $order->items : $order->items()->get();
        $hasReturnableItem = $items->contains(
            fn (OrderItem $item) => ((int) $item->quantity - $this->alreadyReturnedQuantity($item)) > 0
        );

        if (!$hasReturnableItem) {
            return $verdict(false, 'Every item in this order has already been returned.');
        }

        if ($deadline && now()->greaterThan($deadline)) {
            return $verdict(
                false,
                'The ' . OrderReturn::WINDOW_DAYS . '-day return window for this order closed on '
                    . $this->formatPhilippineLabel($deadline) . '.',
            );
        }

        return $verdict(true, null);
    }

    /** Quantity of an order line already tied up in a live or completed return. */
    private function alreadyReturnedQuantity(OrderItem $lineItem): int
    {
        return (int) OrderReturnItem::query()
            ->where('order_item_id', $lineItem->id)
            ->whereHas(
                'orderReturn',
                fn ($query) => $query->whereNotIn('status', ['cancelled', 'rejected'])
            )
            ->sum('quantity');
    }

    private function generateReturnNo(int $returnId): string
    {
        return 'RTN-' . now()->format('ymd') . '-' . str_pad((string) $returnId, 5, '0', STR_PAD_LEFT);
    }

    /** Append one row to the return's audit timeline. */
    private function recordEvent(OrderReturn $orderReturn, array $payload): void
    {
        try {
            OrderReturnEvent::create([
                'order_return_id'    => $orderReturn->id,
                'created_by_user_id' => $payload['created_by_user_id'] ?? null,
                'status'             => $payload['status'] ?? $orderReturn->status,
                'actor_role'         => $payload['actor_role'] ?? 'system',
                'title'              => $payload['title'] ?? 'Return update',
                'description'        => $payload['description'] ?? null,
                'metadata'           => $payload['metadata'] ?? null,
                'occurred_at'        => $payload['occurred_at'] ?? now(),
            ]);
        } catch (\Throwable $error) {
            Log::warning('[RETURN] Could not record timeline event: ' . $error->getMessage());
        }
    }

    /** Forward-only transition guard. */
    private function guardTransition(OrderReturn $orderReturn, string $target): ?JsonResponse
    {
        if (in_array($target, self::TRANSITIONS[$orderReturn->status] ?? [], true)) {
            return null;
        }

        return response()->json([
            'message' => 'This return is already marked as "' . $orderReturn->statusLabel()
                . '" — that action is no longer available.',
        ], 422);
    }

    /**
     * One row for the customer Returns tab / admin queue.
     *
     * The shape lives in ReturnPresenter because OrderController renders the very
     * same rows inside /customer/orders and /admin/orders.
     */
    private function transformReturnSummary(OrderReturn $orderReturn, bool $forAdmin = false): array
    {
        return ReturnPresenter::summary($orderReturn, $forAdmin);
    }

    /** Summary + newest-first timeline + the order snapshot the modals show. */
    private function transformReturnDetail(OrderReturn $orderReturn, bool $forAdmin = false): array
    {
        return ReturnPresenter::detail($orderReturn, $forAdmin);
    }

    private function transformReturnEvent(OrderReturnEvent $event): array
    {
        return ReturnPresenter::event($event);
    }

    /** Email the customer a return status update using the shared order template. */
    private function emailStatusUpdate(
        OrderReturn $orderReturn,
        string $headline,
        string $body,
        string $color = '#8f1111',
        ?string $amountOverride = null,
    ): void {
        $order = $orderReturn->order ?? $orderReturn->order()->first();

        if (!$order) {
            return;
        }

        OrderNotifier::emailCustomer(
            $order,
            $headline . ' — ' . ($orderReturn->return_no ?: "RTN-{$orderReturn->id}"),
            OrderNotifier::buildEmailHtml(
                $order,
                $headline,
                $body,
                $color,
                $orderReturn->statusLabel(),
                $amountOverride,
            ),
        );
    }

    /** @return array<int, array{value: string, label: string}> */
    private function vocabulary(array $values, array $labels): array
    {
        return collect($values)
            ->map(fn (string $value) => ['value' => $value, 'label' => $labels[$value] ?? $value])
            ->values()
            ->all();
    }

    private function ensureCustomer(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || ($user->role ?? null) !== 'customer') {
            return response()->json(['message' => 'Customer access is required.'], 403);
        }

        return null;
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role ?? '', ['admin', 'staff'], true)) {
            return response()->json(['message' => 'Forbidden. Admin or staff access is required.'], 403);
        }

        return null;
    }

    /** @return array<int, array<string, mixed>>|null */
    private function storeUploadedMedia(array|UploadedFile|null $files): ?array
    {
        $files = is_array($files) ? $files : ($files ? [$files] : []);
        if (!$files) {
            return null;
        }

        return collect($files)
            ->filter(fn ($file) => $file instanceof UploadedFile && $file->isValid())
            ->map(function (UploadedFile $file): array {
                $path = $file->store(self::MEDIA_FOLDER, 'public');

                return [
                    'path' => $path,
                    // Root-relative on purpose. An absolute URL here would bake
                    // whatever APP_URL happened to be at upload time into the
                    // row, so evidence filed from one host would hand the
                    // browser a dead link on another. Read paths rebuild from
                    // `path` (ReturnPresenter::mediaUrl); this keeps the stored
                    // fallback usable too.
                    'url'  => '/storage/'.ltrim($path, '/'),
                    'type' => str_starts_with((string) $file->getMimeType(), 'video/') ? 'video' : 'image',
                    'mime' => $file->getMimeType(),
                    'name' => $file->getClientOriginalName(),
                    'size' => $file->getSize(),
                ];
            })
            ->values()
            ->all();
    }

    private function deleteStoredMedia(?array $media): void
    {
        foreach ($media ?? [] as $item) {
            if (!empty($item['path'])) {
                Storage::disk('public')->delete($item['path']);
            }
        }
    }

    private function cleanText(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function formatPhilippineIso(?DateTimeInterface $dateTime): ?string
    {
        return ReturnPresenter::iso($dateTime);
    }

    private function formatPhilippineLabel(?DateTimeInterface $dateTime): ?string
    {
        return ReturnPresenter::label($dateTime);
    }

    private function formatMoney(float $amount): string
    {
        return ReturnPresenter::money($amount);
    }
}
