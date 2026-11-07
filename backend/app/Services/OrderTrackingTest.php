<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Models\ShipmentTrackingSubscription as Subscription;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class OrderTrackingTest
{
    public static function installed(): bool
    {
        return ShipmentTracking::subscriptionsInstalled() && Schema::hasColumn('orders', 'tracking_test_subscription_id')
            && Schema::hasColumn('shipment_tracking_subscriptions', 'latest_result');
    }

    public static function present(Order $order): ?array
    {
        if (! self::installed()) {
            return null;
        }
        $admin = strtolower((string) auth()->user()?->role) === 'admin';
        $canAttach = $admin && ! $order->tracking_test_subscription_id && ! $order->latestShipmentTracker
            && ShipmentTracking::eligibility($order) === null;
        if (! $order->tracking_test_subscription_id) {
            return $admin ? ['can_attach' => $canAttach, 'linked' => false] : null;
        }
        $sub = Subscription::find($order->tracking_test_subscription_id);
        if (! $sub || ! $sub->diagnostic || $sub->account_fingerprint !== SeventeenTrackClient::fingerprint()) {
            return null;
        }

        return ['linked' => true, 'is_test' => true, 'can_attach' => false, 'can_remove' => $admin,
            'label' => 'Tracking test — external parcel',
            'message' => 'These are real courier updates for an external test parcel. They do not confirm shipment or delivery of this FMRC order.',
            'tracking_number' => $sub->tracking_number, 'provider' => '17TRACK',
            'status_label' => $sub->latest_result['status_label'] ?? 'Waiting for courier updates',
            'last_updated_at_label' => $sub->latest_result['time']['label'] ?? null,
            'location' => $sub->latest_result['location'] ?? null, 'events' => $sub->latest_result['events'] ?? [],
            'stopped' => $sub->registration_state === 'stopped'];
    }

    public function change(Order $order, ?string $number, int $actor): void
    {
        abort_unless(self::installed(), 503, 'Deploy the order tracking test migration first.');
        DB::transaction(function () use ($order, $number, $actor) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($number !== null) {
                if ($reason = ShipmentTracking::eligibility($order)) {
                    ShipmentTracking::fail($reason);
                }
                if ($order->latestShipmentTracker || (NinjaVanShipping::installed() && DB::table('courier_shipments')->where('active_order_id', $order->id)->exists())) {
                    ShipmentTracking::fail('This order already has a recorded courier shipment.');
                }
                $sub = Subscription::where('provider', '17track')->where('diagnostic', true)->where('tracking_number', strtoupper(trim($number)))
                    ->where('account_fingerprint', SeventeenTrackClient::fingerprint())->whereNotNull('registered_at')->whereNotNull('last_webhook_at')->first();
                if (! $sub || ! $sub->latest_result) {
                    ShipmentTracking::fail('Verify this owned diagnostic parcel and its signed webhook first.');
                }
                if ((int) $order->tracking_test_subscription_id === $sub->id) {
                    return;
                }
                if ($order->tracking_test_subscription_id) {
                    ShipmentTracking::fail('Remove the current tracking test before linking another parcel.');
                }
            } elseif (! $order->tracking_test_subscription_id) {
                return;
            }
            $order->tracking_test_subscription_id = $number === null ? null : $sub->id;
            $order->courier_history_version++;
            $order->save();
            OrderTrackingEvent::create(['order_id' => $order->id, 'created_by_user_id' => $actor,
                'stage' => $order->customer_stage, 'event_type' => 'admin_update',
                'title' => $number === null ? 'Tracking test removed' : 'External parcel tracking test linked',
                'description' => 'This system test uses an external parcel. Payment and FMRC order fulfillment are handled separately.',
                'occurred_at' => now(), 'metadata' => ['source' => 'fmrc', 'tracking_test' => true]]);
        }, 3);
    }
}
