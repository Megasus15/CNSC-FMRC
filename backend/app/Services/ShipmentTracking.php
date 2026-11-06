<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Models\ShipmentTracker;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ShipmentTracking
{
    public const LABELS = [
        'pending' => 'Waiting for courier updates', 'info_received' => 'Shipment information received',
        'in_transit' => 'In transit', 'out_for_delivery' => 'Out for delivery',
        'failed_attempt' => 'Delivery attempt unsuccessful', 'available_for_pickup' => 'Available for collection from J&T',
        'delivered' => 'Delivered', 'exception' => 'Delivery needs attention', 'handover' => 'Handed to J&T',
    ];

    public static function installed(): bool
    {
        return Schema::hasTable('shipment_tracking_settings') && Schema::hasTable('shipment_trackers');
    }

    public static function relations(): array
    {
        return [...NinjaVanShipping::relations(), ...(self::installed() ? ['latestShipmentTracker'] : [])];
    }

    public static function settings(): ?object
    {
        return self::installed() ? DB::table('shipment_tracking_settings')->find(1) : null;
    }

    public static function verified(?object $settings = null): bool
    {
        $settings ??= self::settings();

        return Ship24Client::configured() && $settings && $settings->carrier_verified_at && $settings->waybill_verified_at
            && $settings->last_webhook_at && hash_equals(Ship24Client::fingerprint(), (string) $settings->account_fingerprint);
    }

    public static function enabled(): bool
    {
        $settings = self::settings();

        return config('ship24.enabled') && $settings?->enabled && self::verified($settings);
    }

    public static function eligibility(Order $order, bool $correction = false): ?string
    {
        if ($order->isPickup()) {
            return 'Pickup orders do not need a J&T waybill.';
        }
        if ($order->hasPendingCancellation() || $order->isCancelled()) {
            return 'Resolve the cancellation before recording a handover.';
        }
        if (! $order->approved_at || $order->lifecycle_status !== 'pending' || ! in_array($order->customer_stage, $correction ? ['to_receive'] : ['to_ship'], true)) {
            return $correction ? 'Only an active delivery can have its waybill corrected.' : 'Accept and prepare this order before handing it to J&T.';
        }
        $order->loadMissing('payment');
        if (AppointmentProducts::custom($order)) {
            try { AppointmentProducts::assertProduction($order,true); }
            catch (\Symfony\Component\HttpKernel\Exception\HttpException $error) { return $error->getMessage(); }
        }
        if ((!AppointmentProducts::custom($order) && $order->payment_method !== 'GCash') || $order->payment?->status !== 'paid') {
            return 'Payment must be confirmed before this order can be handed to J&T.';
        }
        if (! GatewayPayments::managed($order->payment) && !(AppointmentProducts::custom($order) && $order->payment_method === 'Cash at FMRC' && AppointmentProducts::paid($order))) {
            return 'A confirmed online payment is required before recording a new J&T handover.';
        }
        if (GatewayPayments::managed($order->payment)) {
            $receipt = DB::table('payment_receipts')->where('payment_id', $order->payment->id)
                ->where('provider_payment_id', $order->payment->paymongo_payment_id)->whereNotNull('confirmed_at')->first();
            if (! $receipt || (int) $receipt->amount_centavos !== GatewayPayments::centavos($order->total)) {
                return 'A confirmed payment for the full order total is required.';
            }
            if (! $receipt->livemode && ! self::demoAllowed()) {
                return 'This order has a test payment and cannot be dispatched as a real shipment.';
            }
            if (DB::table('payment_refunds')->where('payment_id', $order->payment->id)->whereNotIn('status', ['failed', 'rejected'])->exists()) {
                return 'Resolve the refund before recording a handover.';
            }
        }
        foreach (['delivery_recipient_name', 'delivery_contact_no', 'delivery_street', 'delivery_barangay', 'delivery_city', 'delivery_province', 'delivery_postal_code'] as $field) {
            if (blank($order->$field)) {
                return 'Complete the delivery address before recording the J&T handover.';
            }
        }

        return null;
    }

    private static function demoAllowed(): bool
    {
        return ! app()->environment('production') && config('ship24.allow_demo_handover');
    }

    public static function fail(string $message): never
    {
        throw ValidationException::withMessages(['shipment' => $message]);
    }

    public function record(Order $order, array $input, int $actor, bool $correction = false): ShipmentTracker
    {
        abort_unless(self::installed(), 503, 'Shipment recording is not yet available. Please contact FMRC.');
        $number = strtoupper(trim($input['tracking_number']));
        $handover = Carbon::parse($input['handed_over_at'], 'Asia/Manila')->utc();
        $hash = hash('sha256', json_encode([$number, $handover->toIso8601String(),
            isset($input['actual_shipping_cost']) ? GatewayPayments::centavos($input['actual_shipping_cost']) : null,
            $correction, $input['correction_reason'] ?? null, $input['expected_version'] ?? null]));

        try {
            return DB::transaction(function () use ($order, $input, $actor, $correction, $number, $handover, $hash) {
                $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
                $replay = ShipmentTracker::where('request_key', $input['request_key'])->first();
                if ($replay) {
                    abort_unless($replay->order_id === $order->id && hash_equals($replay->request_hash, $hash), 409, 'This request was already used for different shipment details. Refresh the order.');

                    return $replay;
                }
                $active = ShipmentTracker::where('active_order_id', $order->id)->lockForUpdate()->first();
                if (! $correction && $active && hash_equals($active->request_hash, $hash)) {
                    return $active;
                }
                if ($reason = self::eligibility($order, $correction)) {
                    self::fail($reason);
                }
                if ($handover->gt(now()->addMinute()) || $handover->lt($order->created_at)) {
                    self::fail('Use the actual handover time, between the order date and now.');
                }
                if ($correction) {
                    abort_unless($active && (int) $active->version === (int) $input['expected_version'], 409, 'The waybill changed. Refresh the order before correcting it.');
                    if ($active->tracking_number === $number) {
                        self::fail('Enter the corrected waybill number. The existing number is unchanged.');
                    }
                } elseif ($active) {
                    abort(409, 'This order already has a waybill. Refresh to review it.');
                }
                if (NinjaVanShipping::installed() && DB::table('courier_shipments')->where('active_order_id', $order->id)->exists()) {
                    self::fail('Resolve the existing courier shipment before recording a J&T waybill.');
                }
                if (ShipmentTracker::where('active_waybill', 'jnt:'.$number)->exists()) {
                    self::fail('This waybill is already linked to another active order. Check the J&T receipt.');
                }
                if ($active) {
                    $active->update(['active_order_id' => null, 'active_waybill' => null, 'registration_state' => 'superseded',
                        'unsubscribe_pending' => $active->registration_payload !== null, 'version' => $active->version + 1]);
                }
                $demo = GatewayPayments::managed($order->payment) && ! DB::table('payment_receipts')->where('payment_id', $order->payment->id)
                    ->where('provider_payment_id', $order->payment->paymongo_payment_id)->value('livemode');
                $tracker = ShipmentTracker::create([
                    'order_id' => $order->id, 'active_order_id' => $order->id, 'active_waybill' => 'jnt:'.$number,
                    'request_key' => $input['request_key'], 'request_hash' => $hash, 'client_tracker_id' => (string) Str::uuid(),
                    'tracking_number' => $number, 'handed_over_at' => $handover, 'created_by' => $actor,
                    'actual_shipping_cost' => $input['actual_shipping_cost'] ?? null,
                    'correction_reason' => $input['correction_reason'] ?? null, 'demo' => $demo,
                    'version' => $active ? $active->version : 1, 'registration_state' => $demo ? 'demo' : 'pending', 'next_attempt_at' => now(),
                ]);
                // Avoid duplicate generic stage alerts; the shipment outbox owns handover notifications.
                DB::table('orders')->where('id', $order->id)->update(['courier_name' => 'J&T Express', 'courier_tracking_no' => $number,
                    'customer_stage' => 'to_receive', 'shipment_tracking_mode' => 'jnt_dropoff', 'courier_history_version' => DB::raw('courier_history_version + 1'), 'updated_at' => now()]);
                OrderTrackingEvent::create(['order_id' => $order->id, 'created_by_user_id' => $actor, 'stage' => 'to_receive',
                    'event_type' => 'admin_update', 'title' => $correction ? 'J&T waybill corrected' : ($demo ? 'Demonstration handover recorded' : 'Handed to J&T'),
                    'description' => $correction ? 'FMRC corrected the waybill. '.$input['correction_reason'] : 'FMRC recorded the parcel handover and waybill. Courier updates will appear when available.',
                    'occurred_at' => $correction ? now() : $handover, 'metadata' => ['source' => 'fmrc', 'tracking_number' => $number, 'demo' => $demo],
                    'shipment_tracker_id' => $tracker->id]);
                if (! $correction && ! $demo) {
                    self::notifyLater($tracker, 'handover');
                }

                return $tracker;
            }, 3);
        } catch (UniqueConstraintViolationException) {
            abort(409, 'This waybill or request has already been recorded. Refresh the order and check the J&T receipt.');
        }
    }

    public function refresh(Order $order): void
    {
        DB::transaction(function () use ($order) {
            Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $tracker = ShipmentTracker::where('active_order_id', $order->id)->lockForUpdate()->firstOrFail();
            if (! self::enabled() || $tracker->demo) {
                self::fail('Automatic tracking is not active. Your saved waybill and J&T tracking link remain available.');
            }
            if ($tracker->last_refresh_requested_at?->gt(now()->subMinutes(15))) {
                abort(429, 'Tracking was recently requested. Please wait before requesting another update.');
            }
            $tracker->update(['last_refresh_requested_at' => now(), 'next_attempt_at' => now(), 'attempts' => 0,
                'registration_state' => $tracker->provider_tracker_id ? 'active' : 'pending']);
        });
    }

    public static function notifyLater(ShipmentTracker $tracker, string $milestone): void
    {
        DB::table('shipment_notification_outbox')->insertOrIgnore(['tracker_id' => $tracker->id, 'milestone' => $milestone, 'created_at' => now(), 'updated_at' => now()]);
    }

    public static function health(): array
    {
        $settings = self::settings();
        if (! $settings) {
            return ['installed' => false, 'enabled' => false, 'ready' => false, 'message' => 'Shipment tracking setup is not installed yet.'];
        }
        $same = hash_equals(Ship24Client::fingerprint(), (string) $settings->account_fingerprint);

        return ['installed' => true, 'revision' => (int) $settings->revision, 'enabled' => self::enabled(),
            'ready' => self::verified($settings) && (bool) config('ship24.enabled'), 'configured' => Ship24Client::configured(),
            'carrier_verified' => $same && (bool) $settings->carrier_verified_at,
            'waybill_verified' => $same && (bool) $settings->waybill_verified_at,
            'webhook_verified' => $same && (bool) $settings->last_webhook_at,
            'carrier_code' => $settings->carrier_code, 'last_processed_at' => $settings->last_processed_at,
            'processor_healthy' => $settings->last_processed_at && Carbon::parse($settings->last_processed_at)->gt(now()->subMinutes(3)),
            'last_webhook_at' => $settings->last_webhook_at,
            'registrations' => ShipmentTracker::where('registered_at', '>=', Carbon::now('Asia/Manila')->startOfMonth()->utc())->count(),
            'registration_limit' => max(0, (int) config('ship24.monthly_registration_limit')),
            'pending' => ShipmentTracker::whereNotNull('active_order_id')->whereIn('registration_state', ['pending', 'retry', 'limited'])->count(),
            'failed' => ShipmentTracker::whereNotNull('active_order_id')->where(fn ($q) => $q->where('registration_state', 'failed')->orWhere('needs_review', true))->count(),
            'quota_limited' => $settings->quota_retry_at && Carbon::parse($settings->quota_retry_at)->isFuture(),
            'pending_updates' => DB::table('shipment_webhook_inbox')->where('state', 'pending')->count(),
            'quarantined_updates' => DB::table('shipment_webhook_inbox')->where('state', 'quarantined')->count(),
            'pending_notifications' => DB::table('shipment_notification_outbox')->whereNull('sent_at')->count(),
            'message' => self::enabled() ? 'Automatic tracking is active. Updates follow J&T scans and Ship24 availability.'
                : 'Automatic tracking is not active. FMRC can still record waybills and use J&T tracking.',
        ];
    }

    public static function present(Order $order, bool $operator = false, bool $history = false): ?array
    {
        if (! self::installed()) {
            return NinjaVanShipping::present($order, $operator, $history);
        }
        $order->loadMissing('latestShipmentTracker');
        $tracker = $order->latestShipmentTracker;
        if (! $tracker) {
            $legacy = NinjaVanShipping::present($order, $operator, $history);
            if ($legacy && $legacy['id']) {
                return $legacy;
            }
            if ($order->isPickup() || ! $operator) {
                return null;
            }
        }
        $automatic = self::enabled();
        $state = $tracker?->registration_state ?? 'not_recorded';
        $notice = match (true) {
            (bool) $tracker?->demo => 'Demonstration only. This shipment is not connected to a courier.',
            ! $tracker => 'Record the waybill after handing the parcel to J&T. The accepted customer shipping fee stays unchanged.',
            $state === 'limited' => 'Automatic tracking is currently unavailable. Use the saved waybill on J&T tracking.',
            $state === 'failed' => 'Automatic tracking needs attention. Your saved waybill and last updates remain available.',
            ! $automatic => 'Automatic tracking is not active. Use the saved waybill on J&T tracking.',
            $state === 'retry' => 'Tracking updates are temporarily unavailable. Your last recorded updates are shown.',
            $state === 'pending' => 'The waybill is saved. Automatic tracking registration is pending.',
            default => 'Updates appear after J&T records a scan and Ship24 makes it available.',
        };
        $data = ['id' => $tracker?->id, 'provider' => 'Ship24', 'carrier' => 'J&T Express', 'tracking_provider' => 'ship24',
            'status' => $tracker?->status ?? 'pending', 'status_label' => $tracker ? self::LABELS[$tracker->status] ?? self::LABELS['pending'] : 'Waybill not yet recorded',
            'provider_status' => $tracker?->provider_status, 'tracking_number' => $tracker?->tracking_number,
            'registration_state' => $state, 'tracking_available' => $automatic && $state === 'active', 'availability_message' => $notice,
            'tracking_url' => 'https://www.jtexpress.ph', 'tracking_url_is_prefilled' => false, 'demo' => (bool) $tracker?->demo,
            'handed_over_at' => $tracker?->handed_over_at?->toIso8601String(),
            'handed_over_at_label' => $tracker?->handed_over_at?->copy()->tz('Asia/Manila')->format('M j, Y g:i A'),
            'last_updated_at' => $tracker?->last_event_at?->toIso8601String(),
            'last_updated_at_label' => $tracker?->last_event_time['label'] ?? null,
            'last_checked_at' => $tracker?->last_checked_at?->toIso8601String(), 'location' => $tracker?->location,
            'history_revision' => (int) ($order->courier_history_version ?? 0)];
        if ($operator) {
            $role = strtolower((string) auth()->user()?->role);
            $data += ['version' => $tracker?->version, 'can_record' => ! $tracker && self::eligibility($order) === null,
                'record_reason' => ! $tracker ? self::eligibility($order) : null,
                'can_correct' => $role === 'admin' && $tracker && self::eligibility($order, true) === null,
                'can_refresh' => $tracker && ! $tracker->demo && $automatic && (! $tracker->last_refresh_requested_at || $tracker->last_refresh_requested_at->lte(now()->subMinutes(15))),
                'needs_review' => (bool) $tracker?->needs_review, 'actual_shipping_cost' => $tracker?->actual_shipping_cost,
                'last_error_code' => $tracker?->last_error_code];
        }

        return $data;
    }
}
