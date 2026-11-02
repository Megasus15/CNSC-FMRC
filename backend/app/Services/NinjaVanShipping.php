<?php

namespace App\Services;

use App\Models\CourierShipment;
use App\Models\Order;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class NinjaVanShipping
{
    private const TERMINAL = ['delivered', 'cancelled', 'returned'];

    private const LABELS = ['booking' => 'Booking in progress', 'awaiting_pickup' => 'Booking accepted; awaiting courier pickup update',
        'pending_pickup' => 'Pending pickup', 'in_transit' => 'In transit', 'out_for_delivery' => 'Out for delivery', 'delivered' => 'Delivered',
        'returned' => 'Returned to sender', 'exception' => 'Delivery update requires attention', 'update_received' => 'Courier update received',
        'booking_unknown' => 'Booking outcome needs checking', 'booking_failed' => 'Booking was not accepted',
        'tracking_linked' => 'Tracking linked; awaiting courier confirmation', 'cancel_pending' => 'Cancellation in progress',
        'cancel_unknown' => 'Cancellation outcome needs checking', 'cancelled' => 'Shipment cancelled'];

    public static function installed(): bool
    {
        $attributes = request()->attributes;
        if (! $attributes->has('fmrc_courier_schema')) {
            $attributes->set('fmrc_courier_schema', Schema::hasTable('courier_shipments') && Schema::hasTable('shipment_booking_attempts') && Schema::hasTable('courier_webhook_events') && Schema::hasColumn('orders', 'courier_history_version'));
        }

        return (bool) $attributes->get('fmrc_courier_schema');
    }

    public static function relations(): array
    {
        return self::installed() ? ['latestShipment'] : [];
    }

    private static function deny(string $message): never
    {
        throw ValidationException::withMessages(['shipment' => $message]);
    }

    private static function phone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone);
        if (strlen($digits) === 11 && str_starts_with($digits, '0')) {
            $digits = '63'.substr($digits, 1);
        } elseif (strlen($digits) === 10 && str_starts_with($digits, '9')) {
            $digits = '63'.$digits;
        }

        return '+'.$digits;
    }

    public static function eligibility(Order $order): ?string
    {
        if ($order->isPickup()) {
            return 'Pickup orders do not need a courier shipment.';
        }
        if ($order->hasPendingCancellation()) {
            return 'Review the customer cancellation before booking a courier.';
        }
        if ($order->lifecycle_status !== 'pending' || $order->customer_stage !== 'to_ship') {
            return 'Accept the order and prepare it for shipping before booking a courier.';
        }
        $order->loadMissing('payment');
        if ($order->payment_method === 'GCash' && $order->payment?->status !== 'paid') {
            return 'Confirm the online payment before booking a courier.';
        }
        if ($order->payment?->status === 'refunded') {
            return 'A refunded order cannot be booked for delivery.';
        }
        foreach (['delivery_recipient_name', 'delivery_contact_no', 'delivery_street', 'delivery_barangay', 'delivery_city', 'delivery_province', 'delivery_postal_code'] as $field) {
            if (blank($order->$field)) {
                return 'A complete delivery address is needed for courier booking. Existing manual tracking remains available.';
            }
        }

        return null;
    }

    private static function parcel(array $input): array
    {
        return ['weight' => (float) $input['weight'], 'length' => (float) $input['length'], 'width' => (float) $input['width'], 'height' => (float) $input['height'],
            'dispatch_date' => $input['dispatch_date'], 'pickup_required' => (bool) $input['pickup_required']];
    }

    private static function payload(Order $order, CourierShipment $shipment, array $parcel): array
    {
        $from = config('ninjavan.from');
        $from['phone_number'] = self::phone($from['phone_number']);
        $job = ['is_pickup_required' => $parcel['pickup_required'],
            'dimensions' => array_intersect_key($parcel, array_flip(['weight', 'length', 'width', 'height'])),
            'delivery_start_date' => $parcel['dispatch_date'],
            'delivery_timeslot' => ['start_time' => config('ninjavan.delivery_start'), 'end_time' => config('ninjavan.delivery_end'), 'timezone' => 'Asia/Manila'],
            'cash_on_delivery' => $order->payment_method === 'COD' ? (float) $order->total : 0, 'cash_on_delivery_currency' => 'PHP',
            'delivery_instructions' => (string) ($order->delivery_landmark ?? '')];
        if ($parcel['pickup_required']) {
            if (! config('ninjavan.pickup_start') || ! config('ninjavan.pickup_end')) {
                self::deny('Courier collection time slots are not available. Choose drop-off or contact the administrator.');
            }
            $job += ['pickup_service_type' => 'Scheduled', 'pickup_service_level' => 'Standard', 'pickup_date' => $parcel['dispatch_date'],
                'pickup_timeslot' => ['start_time' => config('ninjavan.pickup_start'), 'end_time' => config('ninjavan.pickup_end'), 'timezone' => 'Asia/Manila']];
            $job['delivery_start_date'] = Carbon::parse($parcel['dispatch_date'], 'Asia/Manila')->addDay()->toDateString();
        }

        return ['service_type' => 'Parcel', 'service_level' => 'Standard', 'requested_tracking_number' => $shipment->requested_tracking_number,
            'reference' => ['merchant_order_number' => $shipment->reference], 'from' => $from,
            'to' => ['name' => $order->delivery_recipient_name, 'phone_number' => self::phone($order->delivery_contact_no),
                'address' => ['address1' => $order->delivery_street, 'area' => $order->delivery_barangay, 'city' => $order->delivery_city,
                    'state' => $order->delivery_province, 'postcode' => $order->delivery_postal_code, 'country' => 'PH', 'address_type' => 'home']],
            'parcel_job' => $job];
    }

    private static function localEvent(CourierShipment $shipment, string $status, string $key, ?int $actor = null, string $source = 'api'): void
    {
        $inserted = DB::table('courier_webhook_events')->insertOrIgnore(['event_key' => hash('sha256', $key), 'shipment_id' => $shipment->id,
            'tracking_number' => $shipment->tracking_number ?? '', 'reference' => $shipment->reference, 'status' => $status,
            'return_trip' => false, 'source' => $source, 'created_by' => $actor, 'occurred_at' => now(), 'received_at' => now()]);
        if ($inserted) {
            DB::table('orders')->where('id', $shipment->order_id)->increment('courier_history_version');
        }
    }

    public function book(Order $given, array $input, int $actor): CourierShipment
    {
        abort_unless(self::installed() && NinjaVanClient::ready(), 503, 'Courier booking is not yet available. You can continue using manual tracking.');
        $parcel = self::parcel($input);
        $intent = hash('sha256', json_encode([$parcel, $input['actual_booking_cost'] ?? null]));
        $reserved = DB::transaction(function () use ($given, $input, $actor, $parcel, $intent) {
            $order = Order::whereKey($given->id)->lockForUpdate()->firstOrFail();
            $previous = DB::table('shipment_booking_attempts')->where('request_key', $input['request_key'])->first();
            if ($previous) {
                $shipment = CourierShipment::findOrFail($previous->shipment_id);
                abort_unless($shipment->order_id === $order->id && $previous->action === 'book' && hash_equals($previous->payload_hash, $intent), 409, 'This courier request key has already been used.');

                return ['shipment' => $shipment, 'call' => false];
            }
            if ($reason = self::eligibility($order)) {
                self::deny($reason);
            }
            $shipment = CourierShipment::where('active_order_id', $order->id)->lockForUpdate()->first();
            if (! $shipment && filled($order->courier_tracking_no)) {
                self::deny('Tracking is already recorded. Review the existing courier shipment before creating another one.');
            }
            if ($shipment) {
                if ($shipment->environment !== NinjaVanClient::environment()) {
                    self::deny('Resolve the existing courier booking before changing courier environments.');
                }
                if (! in_array($shipment->status, ['booking_failed', 'booking_unknown', 'booking'], true)) {
                    return ['shipment' => $shipment, 'call' => false];
                }
                if ($shipment->status === 'booking' && $shipment->updated_at->gt(now()->subMinutes(2))) {
                    self::deny('A courier booking is already in progress. Please check its status shortly.');
                }
                if ($shipment->status !== 'booking_failed' && json_encode($shipment->parcel) !== json_encode($parcel)) {
                    self::deny('Keep the original parcel details while checking an uncertain booking. Link the existing tracking number before making changes.');
                }
            } else {
                $shipment = CourierShipment::create(['order_id' => $order->id, 'active_order_id' => $order->id, 'environment' => NinjaVanClient::environment(),
                    'reference' => 'FMRC-'.Str::uuid(), 'requested_tracking_number' => Str::upper(Str::random(9)), 'status' => 'booking',
                    'parcel' => $parcel, 'booking_payload' => [], 'payload_hash' => '', 'created_by' => $actor]);
            }
            $payload = self::payload($order, $shipment, $parcel);
            $shipment->fill(['parcel' => $parcel, 'booking_payload' => $payload, 'payload_hash' => hash('sha256', json_encode($payload)),
                'status' => 'booking', 'actual_booking_cost' => $input['actual_booking_cost'] ?? $shipment->actual_booking_cost, 'last_error_code' => null])->save();
            $attempt = DB::table('shipment_booking_attempts')->insertGetId(['shipment_id' => $shipment->id, 'request_key' => $input['request_key'],
                'action' => 'book', 'actor_id' => $actor, 'status' => 'pending', 'payload_hash' => $intent, 'created_at' => now(), 'updated_at' => now()]);

            return ['shipment' => $shipment, 'attempt' => $attempt, 'call' => true];
        });
        $shipment = $reserved['shipment'];
        if (! $reserved['call']) {
            return $shipment;
        }
        try {
            $response = app(NinjaVanClient::class)->book($shipment->booking_payload);
            $tracking = $response['tracking_number'] ?? $response['data']['tracking_number'] ?? null;
            if (! is_string($tracking) || ! preg_match('/^[a-zA-Z0-9-]{9,100}$/', $tracking)) {
                throw new NinjaVanException(200, 'invalid_tracking_response', true);
            }
            DB::transaction(function () use ($shipment, $reserved, $tracking, $actor) {
                $order = Order::whereKey($shipment->order_id)->lockForUpdate()->firstOrFail();
                $fresh = CourierShipment::whereKey($shipment->id)->lockForUpdate()->firstOrFail();
                if ($fresh->tracking_number && $fresh->tracking_number !== $tracking) {
                    throw new NinjaVanException(200, 'tracking_mismatch', true);
                }
                $fresh->tracking_number = $tracking;
                $fresh->booked_at ??= now();
                $fresh->last_error_code = null;
                if (in_array($fresh->status, ['booking', 'booking_unknown', 'booking_failed'], true)) {
                    $fresh->status = 'awaiting_pickup';
                }
                $fresh->save();
                if ($fresh->status !== 'cancelled') {
                    $order->update(['courier_name' => 'Ninja Van', 'courier_tracking_no' => $tracking]);
                }
                DB::table('shipment_booking_attempts')->where('id', $reserved['attempt'])->update(['status' => 'succeeded', 'http_status' => 200, 'updated_at' => now()]);
                self::localEvent($fresh, 'Booking accepted', 'booking:'.$fresh->reference, $actor);
            });
        } catch (NinjaVanException $error) {
            $this->failed($shipment, $reserved['attempt'], $error, 'book');
        }

        return $shipment->fresh();
    }

    private function failed(CourierShipment $shipment, int $attempt, NinjaVanException $error, string $action): never
    {
        DB::transaction(function () use ($shipment, $attempt, $error, $action) {
            Order::whereKey($shipment->order_id)->lockForUpdate()->firstOrFail();
            $fresh = CourierShipment::whereKey($shipment->id)->lockForUpdate()->firstOrFail();
            if ($action === 'book' && in_array($fresh->status, ['booking', 'booking_unknown', 'booking_failed'], true)) {
                $fresh->status = $error->ambiguous ? 'booking_unknown' : 'booking_failed';
            }
            if ($action === 'cancel' && $fresh->status === 'cancel_pending') {
                $fresh->status = $error->ambiguous ? 'cancel_unknown' : 'pending_pickup';
            }
            $fresh->last_error_code = $error->providerCode;
            $fresh->save();
            DB::table('shipment_booking_attempts')->where('id', $attempt)->update(['status' => $error->ambiguous ? 'unknown' : 'failed',
                'http_status' => $error->httpStatus ?: null, 'provider_code' => $error->providerCode, 'updated_at' => now()]);
        });
        throw new HttpResponseException(response()->json(['code' => $action.'_shipment_unconfirmed',
            'message' => $error->ambiguous ? 'The courier result could not be confirmed. Check the courier dashboard or retry the same booking reference; do not create a separate shipment.'
                : 'The courier did not accept this request. Review the parcel details and courier setup before retrying.'], 409));
    }

    public function cancel(Order $given, string $key, int $actor): CourierShipment
    {
        abort_unless(self::installed(), 503, 'Courier booking is not yet available.');
        $reserved = DB::transaction(function () use ($given, $key, $actor) {
            $order = Order::whereKey($given->id)->lockForUpdate()->firstOrFail();
            $previous = DB::table('shipment_booking_attempts')->where('request_key', $key)->first();
            if ($previous) {
                $shipment = CourierShipment::findOrFail($previous->shipment_id);
                abort_unless($shipment->order_id === $order->id && $previous->action === 'cancel', 409, 'This courier request key has already been used.');

                return ['shipment' => $shipment, 'call' => false];
            }
            $shipment = CourierShipment::where('active_order_id', $order->id)->lockForUpdate()->first();
            if (! $shipment) {
                self::deny('There is no active courier shipment to cancel.');
            }
            if ($shipment->status === 'booking_failed') {
                $shipment->update(['status' => 'cancelled', 'active_order_id' => null]);
                self::localEvent($shipment, 'Failed booking discarded', 'discard:'.$shipment->reference, $actor);

                return ['shipment' => $shipment, 'call' => false];
            }
            abort_unless(NinjaVanClient::ready() && $shipment->environment === NinjaVanClient::environment(), 503, 'Courier cancellation is temporarily unavailable.');
            if (! in_array($shipment->status, ['pending_pickup', 'cancel_unknown'], true) || ! $shipment->tracking_number) {
                self::deny('Only a courier-confirmed pending-pickup shipment can be cancelled here.');
            }
            $shipment->update(['status' => 'cancel_pending']);
            $attempt = DB::table('shipment_booking_attempts')->insertGetId(['shipment_id' => $shipment->id, 'request_key' => $key, 'action' => 'cancel', 'actor_id' => $actor, 'status' => 'pending',
                'payload_hash' => hash('sha256', $shipment->tracking_number), 'created_at' => now(), 'updated_at' => now()]);

            return ['shipment' => $shipment, 'attempt' => $attempt, 'call' => true];
        });
        $shipment = $reserved['shipment'];
        if (! $reserved['call']) {
            return $shipment;
        }
        try {
            app(NinjaVanClient::class)->cancel($shipment->tracking_number);
            DB::transaction(function () use ($shipment, $reserved, $actor) {
                $order = Order::whereKey($shipment->order_id)->lockForUpdate()->firstOrFail();
                $fresh = CourierShipment::whereKey($shipment->id)->lockForUpdate()->firstOrFail();
                // A concurrently delivered/returned parcel needs operator review,
                // even if a late cancellation response arrives afterward.
                if (! in_array($fresh->status, ['delivered', 'returned'], true)) {
                    $fresh->update(['status' => 'cancelled', 'provider_status' => 'Cancelled', 'active_order_id' => null]);
                    if ($order->courier_tracking_no === $fresh->tracking_number) {
                        $order->update(['courier_tracking_no' => null]);
                    }
                    self::localEvent($fresh, 'Shipment cancelled', 'cancel:'.$fresh->reference, $actor);
                }
                DB::table('shipment_booking_attempts')->where('id', $reserved['attempt'])->update(['status' => 'succeeded', 'http_status' => 200, 'updated_at' => now()]);
            });
        } catch (NinjaVanException $error) {
            $this->failed($shipment, $reserved['attempt'], $error, 'cancel');
        }

        return $shipment->fresh();
    }

    public function link(Order $given, string $tracking, int $actor): void
    {
        abort_unless(self::installed(), 503, 'Courier tracking is temporarily unavailable.');
        DB::transaction(function () use ($given, $tracking, $actor) {
            $order = Order::whereKey($given->id)->lockForUpdate()->firstOrFail();
            $shipment = CourierShipment::where('active_order_id', $order->id)->lockForUpdate()->first();
            if (! $shipment || $shipment->status !== 'booking_unknown') {
                self::deny('Only an uncertain booking can be linked to an existing courier tracking number.');
            }
            if ($shipment->environment !== NinjaVanClient::environment()) {
                self::deny('Use the existing shipment environment before linking tracking.');
            }
            if (! str_ends_with(strtoupper($tracking), strtoupper($shipment->requested_tracking_number))) {
                self::deny('Use the tracking number associated with this booking reference in the courier dashboard.');
            }
            $shipment->update(['tracking_number' => $tracking, 'status' => 'tracking_linked']);
            $order->update(['courier_name' => 'Ninja Van', 'courier_tracking_no' => $tracking]);
            self::localEvent($shipment, 'Tracking linked by FMRC; awaiting courier confirmation', 'link:'.$shipment->reference, $actor, 'operator');
        });
    }

    private static function state(string $status, bool $returnTrip): string
    {
        $status = strtolower($status);
        if (str_contains($status, 'cancel')) {
            return 'cancelled';
        }
        if (str_contains($status, 'delivered')) {
            return $returnTrip ? 'returned' : 'delivered';
        }
        if (str_contains($status, 'returned to sender')) {
            return 'returned';
        }
        if (str_contains($status, 'pending pickup')) {
            return 'pending_pickup';
        }
        if (str_contains($status, 'on vehicle') || str_contains($status, 'out for delivery')) {
            return 'out_for_delivery';
        }
        if (str_contains($status, 'fail') || str_contains($status, 'exception') || str_contains($status, 'reschedul')) {
            return 'exception';
        }
        if (str_contains($status, 'picked up') || str_contains($status, 'hub') || str_contains($status, 'transit')) {
            return 'in_transit';
        }

        return 'update_received';
    }

    public function webhook(array $input): void
    {
        $time = Carbon::parse($input['timestamp'])->utc();
        $return = (bool) ($input['is_parcel_on_rts_leg'] ?? false);
        $location = null;
        foreach ($input as $key => $value) {
            if (str_ends_with((string) $key, '_information') && is_array($value)) {
                $parts = array_filter([$value['city'] ?? null, $value['hub'] ?? null], fn ($part) => is_string($part) && strlen($part) <= 100);
                if ($parts) {
                    $location = implode(' · ', $parts);
                    break;
                }
            }
        }
        $key = hash('sha256', json_encode([NinjaVanClient::environment(), $input['tracking_id'], $input['shipper_order_ref_no'] ?? null, $time->toIso8601String(), $input['status'], $return, $location]));
        DB::transaction(function () use ($input, $key, $time, $return, $location) {
            $shipment = CourierShipment::where('environment', NinjaVanClient::environment())->where(function ($query) use ($input) {
                $query->where('tracking_number', $input['tracking_id']);
                if (filled($input['shipper_order_ref_no'] ?? null)) {
                    $query->orWhere('reference', $input['shipper_order_ref_no']);
                }
            })->first();
            if ($shipment && filled($input['shipper_order_ref_no'] ?? null) && $shipment->reference !== $input['shipper_order_ref_no']) {
                $shipment = null;
            }
            if ($shipment && $shipment->tracking_number && $shipment->tracking_number !== $input['tracking_id']) {
                $shipment = null;
            }
            if ($shipment) {
                Order::whereKey($shipment->order_id)->lockForUpdate()->firstOrFail();
                $shipment = CourierShipment::whereKey($shipment->id)->lockForUpdate()->firstOrFail();
            }
            // Recheck after waiting for a concurrent booking response.
            if ($shipment && $shipment->tracking_number && $shipment->tracking_number !== $input['tracking_id']) {
                $shipment = null;
            }
            $inserted = DB::table('courier_webhook_events')->insertOrIgnore(['event_key' => $key, 'shipment_id' => $shipment?->id, 'tracking_number' => $input['tracking_id'],
                'reference' => $input['shipper_order_ref_no'] ?? null, 'status' => $input['status'], 'location' => $location, 'return_trip' => $return, 'occurred_at' => $time, 'received_at' => now()]);
            if (! $inserted || ! $shipment) {
                return;
            }
            DB::table('orders')->where('id', $shipment->order_id)->increment('courier_history_version');
            if ($shipment->tracking_number && $shipment->tracking_number !== $input['tracking_id']) {
                return;
            }
            $next = self::state($input['status'], $return);
            if (($shipment->last_event_at && $time->lt($shipment->last_event_at)) || (in_array($shipment->status, self::TERMINAL, true) && $next !== $shipment->status)) {
                return;
            }
            $shipment->tracking_number = $input['tracking_id'];
            $shipment->provider_status = $input['status'];
            $shipment->status = $next;
            $shipment->last_event_at = $time;
            if ($next === 'cancelled') {
                $shipment->active_order_id = null;
            }
            $shipment->save();
            $order = Order::findOrFail($shipment->order_id);
            if ($next !== 'cancelled') {
                $order->update(['courier_name' => 'Ninja Van', 'courier_tracking_no' => $shipment->tracking_number]);
            } elseif ($order->courier_tracking_no === $shipment->tracking_number) {
                $order->update(['courier_tracking_no' => null]);
            }
        });
    }

    public static function present(Order $order, bool $operator = false, bool $history = false): ?array
    {
        if (! self::installed()) {
            return null;
        }
        $order->loadMissing('latestShipment');
        $shipment = $order->latestShipment;
        if (! $shipment && ! $operator) {
            return null;
        }
        $publicLabels = ['booking' => 'Shipment being arranged', 'awaiting_pickup' => 'Awaiting pickup', 'booking_unknown' => 'Shipment arrangement pending', 'booking_failed' => 'Shipment not yet arranged', 'tracking_linked' => 'Awaiting courier updates', 'cancel_pending' => 'Courier cancellation requested', 'cancel_unknown' => 'Courier cancellation update pending'];
        $data = ['id' => $shipment?->id, 'status' => $shipment?->status, 'status_label' => $shipment?->status ? ($publicLabels[$shipment->status] ?? self::LABELS[$shipment->status] ?? 'Courier update received') : 'No API shipment',
            'provider' => 'Ninja Van', 'provider_status' => $shipment?->provider_status, 'tracking_number' => $shipment?->tracking_number,
            'last_updated_at' => $shipment?->last_event_at?->toIso8601String(), 'history_revision' => (int) ($order->courier_history_version ?? 0)];
        if ($history) {
            $data['events'] = DB::table('courier_webhook_events')->whereIn('shipment_id', CourierShipment::where('order_id', $order->id)->select('id'))
                ->orderBy('occurred_at')->orderBy('id')->get(['status', 'location', 'return_trip', 'occurred_at'])->map(fn ($event) => [
                    'status' => $event->status.($event->return_trip ? ' (return trip)' : ''), 'location' => $event->location,
                    'occurred_at' => Carbon::parse($event->occurred_at, 'UTC')->toIso8601String(),
                    'occurred_at_label' => Carbon::parse($event->occurred_at, 'UTC')->setTimezone('Asia/Manila')->format('M j, Y, g:i A')])->all();
        }
        if ($operator) {
            $sameEnvironment = ! $shipment || $shipment->status === 'cancelled' || $shipment->environment === NinjaVanClient::environment();
            $ready = NinjaVanClient::ready() && $sameEnvironment;
            $reason = self::eligibility($order);
            if ((! $shipment || $shipment->status === 'cancelled') && filled($order->courier_tracking_no)) {
                $reason = 'Tracking is already recorded. Review the existing courier shipment before creating another one.';
            }
            $data += ['operator_note' => $shipment?->status ? (self::LABELS[$shipment->status] ?? null) : null, 'booking_available' => $ready, 'booking_reason' => ! $ready ? 'Courier booking is not yet available. Manual tracking remains available.' : $reason,
                'can_book' => $ready && ! $reason && (! $shipment || $shipment->status === 'cancelled'),
                'can_retry' => $ready && ! $reason && in_array($shipment?->status,['booking_unknown', 'booking_failed'],true),
                'can_cancel' => ($ready && in_array($shipment?->status,['pending_pickup', 'cancel_unknown'],true)) || $shipment?->status === 'booking_failed',
                'can_link' => $sameEnvironment && $shipment?->status === 'booking_unknown', 'environment' => $shipment?->environment ?? NinjaVanClient::environment(), 'reference' => $shipment?->reference, 'parcel' => $shipment?->parcel,
                'actual_booking_cost' => $shipment?->actual_booking_cost, 'booking_date_min' => Carbon::now('Asia/Manila')->toDateString(),
                'pickup_available' => filled(config('ninjavan.pickup_start')) && filled(config('ninjavan.pickup_end'))];
        }

        return $data;
    }
}
