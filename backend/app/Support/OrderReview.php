<?php

namespace App\Support;

use App\Models\{Order, OrderTrackingEvent, Payment, Product};
use App\Services\{AppointmentProducts, GatewayPayments};
use Illuminate\Support\Facades\{DB, Schema};
use Illuminate\Validation\ValidationException;

/** The request decision is separate from fulfillment approval and payment evidence. */
final class OrderReview
{
    public static function requireStorage(): void
    {
        abort_unless(Schema::hasColumns('orders', ['review_status', 'reviewed_by_user_id', 'reviewed_at', 'review_reason', 'stock_reserved_at', 'stock_released_at']),
            503, 'Order requests are temporarily unavailable while the site update finishes. Please try again shortly.');
    }

    public static function required(Order $order): bool
    {
        return $order->review_status !== null && ! AppointmentProducts::custom($order);
    }

    public static function blockedReason(Order $order): ?string
    {
        if (! self::required($order) || $order->review_status === 'approved') return null;
        if ($order->lifecycle_status === 'cancelled') return 'This order request was cancelled. Payment is unavailable.';
        return $order->review_status === 'rejected' ? 'FMRC declined this order request. Payment is unavailable.'
            : 'Your order is awaiting FMRC review. Payment becomes available once approved.';
    }

    public static function assertApproved(Order $order): void
    {
        $reason = self::blockedReason($order);
        abort_if($reason !== null, 422, $reason);
    }

    public static function pending(Order $order): bool
    {
        return self::required($order) && $order->review_status === 'pending' && $order->lifecycle_status === 'incoming';
    }

    public static function present(Order $order): array
    {
        $custom = AppointmentProducts::custom($order);
        $status = $custom ? 'quotation' : ($order->review_status ?? 'legacy');
        if ($status === 'pending' && $order->lifecycle_status === 'cancelled') $status = 'cancelled';
        return ['status' => $status, 'required' => self::required($order), 'awaiting_review' => self::pending($order),
            'label' => match ($status) { 'pending' => 'Awaiting FMRC review', 'approved' => 'Approved by FMRC', 'rejected' => 'Request declined', 'cancelled' => 'Cancelled before review', 'quotation' => 'FMRC quotation', default => 'Existing order' },
            'reviewed_at' => $order->reviewed_at?->toIso8601String(), 'reason' => $order->review_reason,
            'can_review' => self::pending($order) && ! $order->is_archived && ! $order->hasPendingCancellation()];
    }

    public static function decide(Order $order, string $decision, ?string $reason, int $actor): Order
    {
        self::requireStorage();
        return DB::transaction(function () use ($order, $decision, $reason, $actor) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $order->setRelation('payment', Payment::where('order_id', $order->id)->lockForUpdate()->first());
            $target = $decision === 'approve' ? 'approved' : 'rejected';
            abort_unless(self::required($order), 422, 'This order uses the existing fulfillment workflow.');
            // An identical retry is a readback, not another decision, email, or reservation.
            if ($order->review_status === $target && ($target === 'approved' ? $order->lifecycle_status === 'incoming' : $order->review_reason === $reason)) return $order;
            abort_unless(self::present($order)['can_review'], 409, 'This request changed. Refresh its details before continuing.');
            if ($target === 'approved') {
                $lines = $order->items()->get()->groupBy('product_id');
                $products = Product::whereIn('id', $lines->keys())->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                foreach ($lines as $id => $items) {
                    $product = $products->get($id);
                    $quantity = (int) $items->sum('quantity');
                    if (! $product || $product->is_blocked || $product->stock_status === 'out_of_stock' || (int) $product->stock < $quantity) {
                        throw ValidationException::withMessages(['stock' => 'Cannot approve '.$items->first()->product_name.'. Check availability and stock before trying again.']);
                    }
                }
                foreach ($lines as $id => $items) {
                    $product = $products[$id];
                    $product->stock -= (int) $items->sum('quantity');
                    $product->stock_status = $product->stock > 0 ? 'in_stock' : 'out_of_stock';
                    $product->save();
                }
                $order->stock_reserved_at = now();
            } else {
                $order->lifecycle_status = 'rejected';
                $order->rejected_at = now();
                $order->notes = trim(($order->notes ? $order->notes."\n\n" : '').'Rejection reason: '.$reason);
            }
            $order->forceFill(['review_status' => $target, 'reviewed_by_user_id' => $actor, 'reviewed_at' => now(), 'review_reason' => $reason])->save();
            if ($target === 'rejected') app(GatewayPayments::class)->queueClosedOrderRefunds($order, $actor);
            $title = $target === 'approved' ? 'Order request approved' : 'Order request declined';
            $message = match (true) {
                $target === 'rejected' => $reason,
                $order->payment?->status === 'paid' => 'FMRC approved your request. Payment is already recorded; do not pay again. Follow preparation in My Orders.',
                $order->payment_method === 'COP' => 'FMRC approved your request. Follow preparation in My Orders and pay in cash at pickup.',
                default => 'FMRC approved your request. Open My Orders to pay securely before preparation.',
            };
            OrderTrackingEvent::create(['order_id' => $order->id, 'created_by_user_id' => $actor, 'stage' => $order->customer_stage,
                'event_type' => 'admin_update', 'title' => $title, 'description' => $message, 'occurred_at' => now(),
                'metadata' => ['source' => 'order_review', 'review_status' => $target]]);
            DB::afterCommit(function () use ($order, $title, $message) {
                OrderNotifier::notifyAdmins('order', $title.': '.$order->order_no, $message, ['order_id' => $order->id]);
                OrderNotifier::emailCustomer($order, $title.' — '.$order->order_no,
                    OrderNotifier::buildEmailHtml($order, $title, $message, statusOverride: $title));
            });
            return $order;
        }, 3);
    }
}
