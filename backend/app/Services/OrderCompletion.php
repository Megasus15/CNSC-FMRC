<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Models\Payment;
use App\Models\ShipmentTracker;
use App\Models\ShipmentTrackingSubscription;
use Illuminate\Support\Facades\DB;

/** Completion records fulfillment only; payment and refund ledgers stay independent. */
final class OrderCompletion
{
    public static function source(Order $order): ?string
    {
        if ($order->customer_stage !== 'completed') {
            return null;
        }
        $event = OrderTrackingEvent::where('order_id', $order->id)->where('stage', 'completed')
            ->where(fn ($query) => $query->where('metadata->completion_source', '17track')->orWhere('metadata->source', 'fmrc_collection'))->latest('id')->first();

        return $event ? (($event->metadata['completion_source'] ?? null) === '17track' ? '17track' : 'fmrc_collection') : null;
    }

    public static function collectionBlocker(Order $order): ?string
    {
        if (! $order->isPickup()) {
            return 'J&T delivery is completed automatically from verified courier updates.';
        }
        if ($order->lifecycle_status === 'completed' && $order->picked_up_at) {
            return 'Pickup collection has already been confirmed by FMRC.';
        }
        if ($order->isCancelled() || $order->hasPendingCancellation()) {
            return 'Resolve the cancellation before collection.';
        }
        if ($order->lifecycle_status !== 'pending' || $order->customer_stage !== 'to_receive' || ! $order->pickup_ready_at) {
            return 'Mark the order ready for pickup before confirming collection.';
        }
        $order->loadMissing('payment');
        if ($order->payment?->status !== 'paid') {
            return 'Confirm the full payment before collection.';
        }
        if (! AppointmentProducts::custom($order) && GatewayPayments::centavos($order->payment->amount) !== GatewayPayments::centavos($order->total)) {
            return 'Confirm the full order total before collection.';
        }
        if (GatewayPayments::managed($order->payment)) {
            $receipt = DB::table('payment_receipts')->where('payment_id', $order->payment->id)->where('provider_payment_id', $order->payment->paymongo_payment_id)->whereNotNull('confirmed_at')->first();
            if (! $receipt || (int) $receipt->amount_centavos !== GatewayPayments::centavos($order->total)) {
                return 'The payment provider must confirm the full order total.';
            }
            if (DB::table('payment_refunds')->where('payment_id', $order->payment->id)->whereNotIn('status', ['failed', 'rejected'])->exists()) {
                return 'Resolve the refund before collection.';
            }
        }
        if (AppointmentProducts::custom($order) && (! AppointmentProducts::paid($order) || $order->appointment_production_status !== 'ready' || $order->collection_hold)) {
            return 'Finish production and payment reconciliation before collection.';
        }

        return null;
    }

    public static function collect(Order $order, string $code, int $actor): array
    {
        return DB::transaction(function () use ($order, $code, $actor) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $payment = Payment::where('order_id', $order->id)->lockForUpdate()->first();
            $order->setRelation('payment', $payment);
            abort_unless($order->isPickup(), 422, 'Courier deliveries complete automatically from 17TRACK.');
            abort_unless(filled($order->pickup_code) && hash_equals((string) $order->pickup_code, strtoupper(trim($code))), 422, 'Check the pickup code shown in the customer’s order.');
            if ($order->lifecycle_status === 'completed' && $order->picked_up_at) {
                return [$order, false];
            }
            abort_if($reason = self::collectionBlocker($order), 422, $reason ?? 'Collection is unavailable.');
            $order->forceFill(['customer_stage' => 'completed', 'lifecycle_status' => 'completed', 'picked_up_at' => now(), 'completed_at' => now()])->save();
            OrderTrackingEvent::create(['order_id' => $order->id, 'created_by_user_id' => $actor, 'stage' => 'completed', 'event_type' => 'admin_update',
                'title' => 'Order collected at FMRC', 'description' => 'FMRC confirmed collection using the customer’s pickup code.', 'occurred_at' => now(), 'metadata' => ['source' => 'fmrc_collection']]);

            return [$order, true];
        }, 3);
    }

    public static function delivered(ShipmentTracker $tracker): bool
    {
        return DB::transaction(function () use ($tracker) {
            $order = Order::whereKey($tracker->order_id)->lockForUpdate()->firstOrFail();
            $order->setRelation('payment', Payment::where('order_id', $order->id)->lockForUpdate()->first());
            $tracker = ShipmentTracker::whereKey($tracker->id)->lockForUpdate()->firstOrFail();
            if ($tracker->status !== 'delivered' || $tracker->demo || $tracker->needs_review || ! $tracker->handed_over_at
                || (int) $tracker->active_order_id !== $order->id || $order->tracking_test_subscription_id
                || $order->shipment_tracking_mode !== 'jnt_dropoff' || $order->courier_tracking_no !== $tracker->tracking_number
                || ShipmentTracking::eligibility($order, true) !== null) {
                return false;
            }
            $sub = ShipmentTrackingSubscription::where('provider', '17track')->where('active_tracker_id', $tracker->id)->where('diagnostic', false)->whereNotNull('registered_at')->first();
            if (ShipmentTrackingSubscription::where('diagnostic', true)->where('tracking_number', $tracker->tracking_number)->where('account_fingerprint', SeventeenTrackClient::fingerprint())->exists()) {
                return false;
            }
            if (! $sub || $sub->tracking_number !== $tracker->tracking_number || (int) $sub->carrier_code !== (int) config('track17.carrier_code')
                || ! hash_equals(SeventeenTrackClient::fingerprint(), (string) $sub->account_fingerprint)) {
                return false;
            }
            $event = OrderTrackingEvent::where('order_id', $order->id)->where('shipment_tracker_id', $tracker->id)->where('event_type', 'courier_update')
                ->where('title', ShipmentTracking::LABELS['delivered'])->orderByDesc('occurred_at')->first();
            if (! $event || ($event->metadata['source'] ?? null) !== '17track') {
                return false;
            }
            $order->forceFill(['customer_stage' => 'completed', 'lifecycle_status' => 'completed', 'completed_at' => now()])->save();
            $event->forceFill(['stage' => 'completed', 'metadata' => array_merge($event->metadata ?? [], ['completion_source' => '17track', 'completion_recorded_at' => now()->toIso8601String()])])->save();
            ShipmentTrackingEvents::touchOrder($tracker);
            ShipmentTracking::notifyLater($tracker, 'delivered');

            return true;
        }, 3);
    }
}
