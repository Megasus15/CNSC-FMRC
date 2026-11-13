<?php

namespace App\Support;

use App\Models\{Order, OrderTrackingEvent, Payment, Product, User};
use App\Services\{AppointmentProducts, GatewayPayments};
use Illuminate\Support\Facades\{DB, Schema};
use Illuminate\Validation\ValidationException;

final class RefundedOrderReview
{
    public const LABEL = 'Refunded — FMRC review required';
    public const SOURCE = 'refunded_order_closure';

    public static function required(Order $order): bool
    {
        return !AppointmentProducts::custom($order) && in_array($order->lifecycle_status, ['incoming', 'pending'], true)
            && $order->payment?->status === 'refunded';
    }

    public static function blocker(Order $order): ?string
    {
        if (!self::required($order)) return 'This order is not awaiting refunded-order review.';
        if ($order->is_archived) return 'Restore the order before reviewing it.';
        if ($order->hasPendingCancellation()) return 'Decide the existing cancellation first.';
        if ($order->picked_up_at || $order->completed_at || $order->customer_stage === 'completed'
            || (!$order->isPickup() && $order->customer_stage === 'to_receive')) return 'Shipment or collection evidence prevents this closure. Review fulfillment and any return case.';
        if (Schema::hasTable('shipment_trackers') && DB::table('shipment_trackers')->where(fn ($q) => $q->where('order_id', $order->id)->orWhere('active_order_id', $order->id))
            ->where('demo', false)->whereNotNull('handed_over_at')->exists()) return 'A courier handover is recorded. Review fulfillment and any return case.';
        if (Schema::hasTable('courier_shipments') && DB::table('courier_shipments')->where('order_id', $order->id)->whereNotIn('status', ['cancelled', 'failed', 'draft'])->exists()) return 'A courier booking is recorded. Reconcile the shipment before closing this order.';
        if ((!$order->isPickup() && trim((string) $order->courier_tracking_no)) || $order->trackingEvents()->whereIn('event_type', ['shipped', 'handover', 'in_transit', 'out_for_delivery', 'delivered', 'picked_up'])->exists()) return 'Shipment or collection evidence prevents this closure.';
        if (GatewayPayments::centavos($order->payment->amount) <= 0) return 'A completed refund receipt is required before closure.';
        if (GatewayPayments::managed($order->payment)) {
            $returned = DB::table('payment_refunds')->where('payment_id', $order->payment->id)->where('provider_payment_id', $order->payment->paymongo_payment_id)->where('status', 'succeeded')->sum('amount_centavos');
            if (!$order->payment->paymongo_payment_id || $returned < GatewayPayments::centavos($order->payment->amount)) return 'Reconcile the full refund with the provider before closing this order.';
        } elseif (!$order->payment->refunded_at || !$order->payment->refund_reference) return 'A completed refund receipt is required before closure.';
        return null;
    }

    public static function stockLines(Order $order): array
    {
        $released = (bool) $order->stock_released_at;
        $previous = [];
        foreach ($order->trackingEvents()->get(['metadata']) as $event) {
            foreach ((array) ($event->metadata['restocked'] ?? []) as $line) {
                if (is_array($line) && isset($line['product_id'], $line['quantity'])) $previous[(int) $line['product_id']] = ($previous[(int) $line['product_id']] ?? 0) + max(0, (int) $line['quantity']);
            }
        }
        $deducted = !$order->review_status || $order->stock_reserved_at;
        return $order->items()->get()->groupBy('product_id')->map(function ($items, $id) use ($released, $deducted, $previous) {
            $exists = $id && Product::whereKey($id)->exists();
            return ['product_id' => (int) $id, 'product_name' => $items->first()->product_name, 'quantity' => (int) $items->sum('quantity'),
                'max_restore' => $exists && $deducted && !$released ? max(0, (int) $items->sum('quantity') - ($previous[(int) $id] ?? 0)) : 0];
        })->values()->all();
    }

    public static function state(Order $order, bool $details = false): array
    {
        $required = self::required($order);
        $reason = $required ? self::blocker($order) : null;
        return ['required' => $required, 'label' => self::LABEL, 'can_close' => $required && !$reason && auth()->user()?->role === 'admin',
            'reason' => $reason ?? ($required && auth()->user()?->role !== 'admin' ? 'Admin must review and close this refunded order.' : null),
            ...($details && $required ? ['stock_items' => self::stockLines($order)] : [])];
    }

    public static function close(Order $order, array $input, int $actor): Order
    {
        abort_unless(User::find($actor)?->role === 'admin', 403, 'Only Admin can close a refunded order.');
        return DB::transaction(function () use ($order, $input, $actor) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $order->setRelation('payment', Payment::where('order_id', $order->id)->lockForUpdate()->first());
            $previous = $order->trackingEvents()->where('metadata->source', self::SOURCE)->first();
            if ($previous) {
                abort_unless(($previous->metadata['input'] ?? null) === $input, 409, 'This refunded order was already closed with a different stock decision.');
                return $order;
            }
            $reason = self::blocker($order);
            abort_if($reason !== null, 422, $reason ?? 'Review this order before closure.');
            $lines = collect(self::stockLines($order))->keyBy('product_id');
            $choices = collect($input['stock_items'])->keyBy('product_id');
            if ($choices->count() !== count($input['stock_items']) || $choices->keys()->sort()->values()->all() !== $lines->keys()->sort()->values()->all()) {
                throw ValidationException::withMessages(['stock_items' => 'Choose a usable quantity for every order product, including zero.']);
            }
            $products = Product::whereIn('id', $lines->keys())->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $restored = [];
            foreach ($lines as $id => $line) {
                $quantity = (int) $choices[$id]['quantity'];
                if ($quantity < 0 || $quantity > $line['max_restore'] || ($quantity && !$products->has($id))) throw ValidationException::withMessages(['stock_items' => 'The usable quantity exceeds the stock eligible for restoration. Refresh this order.']);
                if (!$quantity) continue;
                $product = $products[$id];
                $product->stock += $quantity;
                $product->stock_status = $product->stock > 0 ? 'in_stock' : 'out_of_stock';
                $product->save();
                $restored[] = ['product_id' => (int) $id, 'quantity' => $quantity];
            }
            $order->forceFill(['lifecycle_status' => 'cancelled', 'cancelled_at' => now(), 'cancel_refund_due' => false])->save();
            if (Schema::hasColumn('orders', 'stock_released_at')) $order->forceFill(['stock_released_at' => now()])->save();
            OrderTrackingEvent::create(['order_id' => $order->id, 'created_by_user_id' => $actor, 'stage' => $order->customer_stage,
                'event_type' => 'admin_update', 'title' => 'Order closed after confirmed refund', 'description' => $input['reason'], 'occurred_at' => now(),
                'metadata' => ['source' => self::SOURCE, 'input' => $input, 'restocked' => $restored, 'non_fulfillment_confirmed' => true]]);
            DB::afterCommit(fn () => OrderNotifier::emailCustomer($order, 'Refunded order closed — '.$order->order_no,
                OrderNotifier::buildEmailHtml($order, 'Refunded order closed', $input['reason'], statusOverride: 'Cancelled — refund confirmed')));
            return $order;
        }, 3);
    }
}
