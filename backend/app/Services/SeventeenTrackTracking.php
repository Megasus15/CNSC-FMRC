<?php

namespace App\Services;

use App\Models\ShipmentTracker;
use App\Models\ShipmentTrackingSubscription as Subscription;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

final class SeventeenTrackTracking
{
    public function __construct(private SeventeenTrackClient $client) {}

    public static function savedResultsMinutes(): int
    {
        return max(5, min(360, (int) config('track17.saved_results_minutes', 5)));
    }

    private function due(Subscription $sub): bool
    {
        if (! $sub->next_attempt_at || $sub->next_attempt_at->lte(now())) {
            return true;
        }
        // Apply the shorter recovery interval to registrations created before
        // this release, without overriding provider-error retry/backoff states.
        return $sub->registration_state === 'active' && $sub->registered_at
            && ($sub->last_checked_at ?? $sub->registered_at)->lte(now()->subMinutes(self::savedResultsMinutes()));
    }

    public function verifyCarrier(int $code): array
    {
        $carrier = collect($this->client->couriers())->firstWhere('key', $code);
        if ($code !== (int) config('track17.carrier_code') || ! $carrier
            || ($carrier['_country_iso'] ?? '') !== 'PH' || ! preg_match('/J\s*&\s*T/i', $carrier['_name'] ?? '')) {
            ShipmentTracking::fail('Choose the current J&T Express (PH) entry from the 17TRACK carrier directory.');
        }
        $settings = ShipmentTracking::settings();
        $changed = $settings->account_fingerprint !== SeventeenTrackClient::fingerprint() || (string) $settings->carrier_code !== (string) $code;
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update([
            'carrier_code' => (string) $code, 'carrier_requirements' => json_encode(['destination_country', 'destination_postal_code']),
            'account_fingerprint' => SeventeenTrackClient::fingerprint(), 'carrier_verified_at' => now(),
            'revision' => DB::raw('revision + 1'), 'updated_at' => now(),
            ...($changed ? ['waybill_verified_at' => null, 'verified_tracker_id' => null,
                'last_webhook_at' => null, 'last_test_webhook_at' => null, 'quota_retry_at' => null] : []),
        ]);

        return $carrier;
    }

    public static function eligible(ShipmentTracker $tracker, bool $includeDelivered = false): bool
    {
        if (ShipmentTracking::duplicateAssignment($tracker)) {
            return false;
        }
        // Completion closes dispatch eligibility, not the verified shipment's history.
        if ($includeDelivered && $tracker->status === 'delivered' && $tracker->active_order_id && ! $tracker->demo
            && $tracker->order->lifecycle_status === 'completed' && $tracker->order->customer_stage === 'completed') {
            return true;
        }

        return $tracker->active_order_id && ! $tracker->demo && ($includeDelivered || $tracker->status !== 'delivered')
            && ShipmentTracking::eligibility($tracker->order, true) === null;
    }

    public function subscription(ShipmentTracker $tracker): Subscription
    {
        return DB::transaction(function () use ($tracker) {
            ShipmentTracker::whereKey($tracker->id)->lockForUpdate()->firstOrFail();
            $saved = Subscription::where('tracker_id', $tracker->id)->where('provider', '17track')->first();
            if ($saved?->registered_at) {
                return $saved;
            }

            // Diagnostics and assigned parcels use the same carrier. Reuse an
            // owned diagnostic registration when staff assigns that exact number,
            // instead of spending another credit or excluding it from completion.
            $diagnostic = Subscription::where('provider', '17track')->where('diagnostic', true)
                ->where('tracking_number', $tracker->tracking_number)->where('carrier_code', (string) config('track17.carrier_code'))
                ->where('account_fingerprint', SeventeenTrackClient::fingerprint())->lockForUpdate()->first();
            if ($diagnostic) {
                if (DB::table('orders')->where('tracking_test_subscription_id', $diagnostic->id)->where('id', '!=', $tracker->order_id)->exists()) {
                    throw new SeventeenTrackException('tracking_number_in_use');
                }
                if ($saved) {
                    // Preserve any conservative credit reservation for an older
                    // attempt, but use the already-owned provider identity.
                    $saved->update(['tracker_id' => null, 'active_tracker_id' => null, 'registration_state' => 'superseded', 'stop_pending' => false]);
                }
                $diagnostic->fill(['diagnostic' => false, 'tracker_id' => $tracker->id,
                    'active_tracker_id' => $diagnostic->registered_at ? $tracker->id : null,
                    'registration_state' => $diagnostic->registered_at ? 'active' : 'pending', 'last_error_code' => null,
                    'next_attempt_at' => now(), 'stop_pending' => false])->save();
                ShipmentTrackingEvents::touchOrder($tracker);

                return $diagnostic;
            }
            if ($saved) {
                return $saved;
            }

            return Subscription::create(['tracker_id' => $tracker->id, 'provider' => '17track', 'tag' => (string) Str::uuid(),
                'tracking_number' => $tracker->tracking_number, 'carrier_code' => (string) config('track17.carrier_code'),
                'account_fingerprint' => SeventeenTrackClient::fingerprint(), 'next_attempt_at' => now()]);
        });
    }

    public function diagnostic(string $number, string $postcode, ?string $shipDate = null): Subscription
    {
        $number = strtoupper(trim($number));
        if (! preg_match('/^[A-Z0-9-]{5,50}$/', $number) || ! preg_match('/^\d{4}$/', $postcode)) {
            ShipmentTracking::fail('Use the complete waybill and its four-digit Philippine destination postcode.');
        }
        $sub = Subscription::where('provider', '17track')->where('tracking_number', $number)
            ->where('account_fingerprint', SeventeenTrackClient::fingerprint())->first();
        if ($sub && ! $sub->diagnostic) {
            ShipmentTracking::fail('This tracking number is assigned to an order. Use the order tracking status instead of creating another diagnostic.');
        }
        if (! $sub) {
            $tag = (string) Str::uuid();
            $payload = ['number' => $number, 'carrier' => (int) config('track17.carrier_code'), 'tag' => $tag,
                'origin_country' => 'PH', 'destination_country' => 'PH', 'destination_postal_code' => $postcode];
            if ($shipDate) {
                $payload['ship_date'] = Carbon::parse($shipDate)->format('Y/m/d');
            }
            $sub = Subscription::create(['provider' => '17track', 'diagnostic' => true, 'tag' => $tag,
                'tracking_number' => $number, 'carrier_code' => (string) config('track17.carrier_code'),
                'account_fingerprint' => SeventeenTrackClient::fingerprint(), 'registration_payload' => $payload]);
        }
        $this->register($sub, true);
        $this->synchronize($sub->fresh());
        $this->processInbox(microtime(true) + 5);

        return $sub->fresh();
    }

    public function verifyWaybill(ShipmentTracker $tracker): bool
    {
        if (! self::eligible($tracker, true)) {
            ShipmentTracking::fail('Verify an active, paid FMRC order with its actual recorded J&T handover.');
        }
        $sub = $this->subscription($tracker);
        // Key rotation never resets the lifetime budget. Rebind only after an explicit matching lookup.
        if ($sub->account_fingerprint !== SeventeenTrackClient::fingerprint()) {
            $external = $this->client->item('gettrackinfo', $this->identity($sub));
            if (! $this->matches($sub, $external, false)) {
                throw new SeventeenTrackException('account_changed');
            }
            $sub->update(['account_fingerprint' => SeventeenTrackClient::fingerprint(), 'last_webhook_at' => null]);
        }
        try {
            $this->register($sub, true);
            $this->synchronize($sub->fresh());
        } catch (SeventeenTrackException $error) {
            $this->failed($sub, $error);
            throw $error;
        }
        $this->processInbox(microtime(true) + 5);
        $sub->refresh();
        if (! $sub->last_event_at || $sub->last_error_code || $tracker->fresh()->needs_review) {
            return false;
        }
        DB::table('shipment_tracking_settings')->where('provider', '17track')
            ->where('account_fingerprint', SeventeenTrackClient::fingerprint())->update([
                'waybill_verified_at' => now(), 'verified_tracker_id' => $tracker->id,
                'revision' => DB::raw('revision + 1'), 'updated_at' => now(),
            ]);

        return true;
    }

    private function identity(Subscription $sub): array
    {
        return ['number' => $sub->tracking_number, 'carrier' => (int) $sub->carrier_code];
    }

    private function matches(Subscription $sub, array $data, bool $account = true): bool
    {
        return (! $account || $sub->account_fingerprint === SeventeenTrackClient::fingerprint())
            && strtoupper((string) ($data['number'] ?? '')) === $sub->tracking_number
            && (int) ($data['carrier'] ?? 0) === (int) $sub->carrier_code
            && hash_equals($sub->tag, (string) ($data['tag'] ?? ''));
    }

    private function bindManualRegistration(Subscription $sub, array $data): array
    {
        if ($this->matches($sub, $data)) {
            return $data;
        }
        $tag = (string) ($data['tag'] ?? '');
        $orderNo = (string) $sub->tracker?->order?->order_no;
        $manualTags = array_filter([$orderNo, ltrim($orderNo, '#'), preg_replace('/\D/', '', $orderNo)]);
        // A number explicitly assigned by staff can already exist in this API
        // account from the console. Bind a blank/order-reference tag once, then
        // keep strict account/carrier/number/tag checks for all future updates.
        if ($sub->account_fingerprint !== SeventeenTrackClient::fingerprint()
            || strtoupper((string) ($data['number'] ?? '')) !== $sub->tracking_number
            || (int) ($data['carrier'] ?? 0) !== (int) $sub->carrier_code
            || ($tag !== '' && ! in_array($tag, $manualTags, true))) {
            throw new SeventeenTrackException('response_mismatch');
        }
        $this->client->item('changeinfo', $this->identity($sub) + ['items' => ['tag' => $sub->tag]]);
        $data = $this->client->item('gettrackinfo', $this->identity($sub));
        if (! $this->matches($sub, $data)) {
            throw new SeventeenTrackException('response_mismatch');
        }

        return $data;
    }

    public function register(Subscription $sub, bool $verification = false): void
    {
        $settings = ShipmentTracking::settings();
        if (! SeventeenTrackClient::configured() || ! $settings?->carrier_verified_at
            || $settings->account_fingerprint !== SeventeenTrackClient::fingerprint()
            || (! $verification && ! ShipmentTracking::enabled())) {
            return;
        }
        if ($sub->account_fingerprint !== SeventeenTrackClient::fingerprint()) {
            throw new SeventeenTrackException('account_changed');
        }
        if (! $sub->diagnostic && ! self::eligible($sub->tracker)) {
            return;
        }
        if (! preg_match('/^[A-Z0-9-]{5,50}$/', $sub->tracking_number)) {
            throw new SeventeenTrackException('details_rejected');
        }
        if ($sub->registered_at) {
            return;
        }
        $external = null;
        // The console may already contain this number. Read it first rather
        // than submitting another registration (and its daily-limit checks).
        try {
            $external = $this->client->item('gettrackinfo', $this->identity($sub));
        } catch (SeventeenTrackException $error) {
            if ($error->reason !== 'not_registered') {
                throw $error;
            }
        }
        DB::transaction(function () use ($sub) {
            $settings = DB::table('shipment_tracking_settings')->where('provider', '17track')->lockForUpdate()->first();
            $reserved = Subscription::where('provider', '17track')->whereNotNull('registration_requested_at')->count();
            if ((! $sub->registration_requested_at && $reserved >= max(0, (int) config('track17.registration_limit')))
                || ($settings->quota_retry_at && Carbon::parse($settings->quota_retry_at)->isFuture())) {
                throw new SeventeenTrackException('quota_limit_reached', 86400);
            }
            if (! $sub->registration_payload) {
                $tracker = $sub->tracker;
                $sub->registration_payload = $this->identity($sub) + ['tag' => $sub->tag, 'origin_country' => 'PH',
                    'destination_country' => 'PH', 'destination_postal_code' => $tracker->order->delivery_postal_code,
                    'ship_date' => $tracker->handed_over_at->copy()->tz('Asia/Manila')->format('Y/m/d')];
            }
            $sub->registration_requested_at ??= now();
            $sub->save();
        });
        if ($external) {
            $external = $this->bindManualRegistration($sub, $external);
        } else {
            try {
                $external = $this->client->item('register', $sub->registration_payload);
            } catch (SeventeenTrackException $error) {
                if ($error->reason !== 'already_registered') {
                    throw $error;
                }
                $external = $this->bindManualRegistration($sub, $this->client->item('gettrackinfo', $this->identity($sub)));
            }
            // Registration can omit tag in its acknowledgement, but may never contradict our persisted tag.
            if (isset($external['tag']) && ! hash_equals($sub->tag, (string) $external['tag'])) {
                throw new SeventeenTrackException('response_mismatch');
            }
        }
        DB::transaction(function () use ($sub) {
            $sub = Subscription::whereKey($sub->id)->lockForUpdate()->firstOrFail();
            if (! $sub->diagnostic) {
                $tracker = ShipmentTracker::whereKey($sub->tracker_id)->lockForUpdate()->firstOrFail();
                if (! self::eligible($tracker)) {
                    $sub->update(['registered_at' => now(), 'registration_state' => 'superseded', 'stop_pending' => true]);

                    return;
                }
                Subscription::where('active_tracker_id', $tracker->id)->where('id', '!=', $sub->id)
                    ->update(['active_tracker_id' => null, 'stop_pending' => true, 'updated_at' => now()]);
                $sub->active_tracker_id = $tracker->id;
                ShipmentTrackingEvents::touchOrder($tracker);
            }
            $sub->fill(['registered_at' => $sub->registered_at ?? now(), 'registration_state' => 'active',
                'attempts' => 0, 'last_error_code' => null, 'next_attempt_at' => now()])->save();
        });
    }

    public function synchronize(Subscription $sub): void
    {
        if (! $sub->registered_at || $sub->account_fingerprint !== SeventeenTrackClient::fingerprint()) {
            throw new SeventeenTrackException('account_changed');
        }
        $data = $this->client->item('gettrackinfo', $this->identity($sub));
        if (! $this->matches($sub, $data)) {
            throw new SeventeenTrackException('response_mismatch');
        }
        $this->receive(['event' => 'TRACKING_UPDATED', 'data' => $data], false);
        $sub->update(['last_checked_at' => now(), 'next_attempt_at' => now()->addMinutes(self::savedResultsMinutes()), 'attempts' => 0]);
    }

    public function receive(array $message, bool $webhook = true): void
    {
        $data = $message['data'];
        $events = [];
        $info = is_array($data['track_info'] ?? null) ? $data['track_info'] : [];
        $providers = $info['tracking']['providers'] ?? [];
        foreach ($providers as $provider) {
            if ((int) ($provider['provider']['key'] ?? 0) === (int) config('track17.carrier_code')) {
                foreach ($provider['events'] ?? [] as $event) {
                    if (is_array($event)) {
                        $events[] = array_intersect_key($event, array_flip(['time_iso', 'time_utc', 'time_raw', 'description', 'location', 'stage', 'sub_status']));
                    }
                }
            }
        }
        // The provider's newest scan can arrive before its history array is
        // refreshed. Only trust this unscoped scan when its carrier is unambiguous.
        $singleJnt = count($providers) === 1 && (int) ($providers[0]['provider']['key'] ?? 0) === (int) config('track17.carrier_code');
        if ((! $providers || $singleJnt) && is_array($info['latest_event'] ?? null)) {
            $events[] = array_intersect_key($info['latest_event'], array_flip(['time_iso', 'time_utc', 'time_raw', 'description', 'location', 'stage', 'sub_status']));
        }
        $payload = ['event' => $message['event'], 'number' => strtoupper((string) $data['number']), 'carrier' => (int) $data['carrier'],
            'tag' => $data['tag'] ?? '', 'latest_status' => $info['latest_status']['status'] ?? null,
            'latest_status_trusted' => ! $providers || $singleJnt,
            'destination_country' => $data['destination_country'] ?? null, 'events' => $events, 'webhook' => $webhook];
        // Re-normalize the first saved snapshot after deploying diagnostic result storage.
        $binding = Subscription::where('provider', '17track')->where('tag', $payload['tag'])
            ->where('account_fingerprint', SeventeenTrackClient::fingerprint())->value('active_tracker_id');
        $key = hash('sha256', '17track:v4:'.SeventeenTrackClient::fingerprint().':'.($binding ?? 'preview').':'.json_encode($payload));
        DB::table('shipment_webhook_inbox')->insertOrIgnore(['provider' => '17track', 'message_key' => $key,
            'account_fingerprint' => SeventeenTrackClient::fingerprint(), 'payload' => json_encode($payload),
            'state' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
    }

    private static function status(?string $status): ?string
    {
        return match ($status) {
            'InfoReceived' => 'info_received', 'PickedUp', 'Departure', 'Arrival', 'InTransit' => 'in_transit',
            'AvailableForPickup' => 'available_for_pickup', 'OutForDelivery' => 'out_for_delivery',
            'DeliveryFailure' => 'failed_attempt', 'Delivered' => 'delivered', 'Exception', 'Returning', 'Returned' => 'exception',
            default => null,
        };
    }

    private function event(array $event, int $position): ?array
    {
        $raw = $event['time_raw'] ?? [];
        // Preserve date-only precision instead of manufacturing midnight scan times.
        $time = ! empty($raw['date']) && empty($raw['time']) ? $raw['date']
            : ($event['time_utc'] ?? $event['time_iso'] ?? null);
        if (! $time && ! empty($raw['date'])) {
            $time = $raw['date'].'T'.($raw['time'] ?? '00:00:00').($raw['timezone'] ?? '+08:00');
        }
        if (! is_string($time) || ! ShipmentTrackingEvents::eventTime($time)) {
            return null;
        }
        $text = Str::limit(trim((string) ($event['description'] ?? '')), 500, '');
        $location = Str::limit(trim((string) ($event['location'] ?? '')), 160, '');

        return ['eventId' => '17:'.hash('sha256', json_encode([$time, $text, $location, $event['stage'] ?? null, $event['sub_status'] ?? null])),
            'courierCode' => (string) config('track17.carrier_code'), 'occurrenceDatetime' => $time,
            'status' => $text, 'location' => $location, 'statusMilestone' => self::status($event['stage'] ?? null),
            'statusCode' => $event['sub_status'] ?? null, 'order' => $position];
    }

    public function processInbox(float $deadline): void
    {
        $ids = DB::table('shipment_webhook_inbox')->where('provider', '17track')->where('state', 'pending')
            ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))->orderBy('id')->limit(100)->pluck('id');
        foreach ($ids as $id) {
            if (microtime(true) >= $deadline) {
                break;
            }
            try {
                DB::transaction(function () use ($id) {
                    $row = DB::table('shipment_webhook_inbox')->where('id', $id)->lockForUpdate()->first();
                    if ($row->state !== 'pending') {
                        return;
                    }
                    $data = json_decode($row->payload, true);
                    $sub = Subscription::where('provider', '17track')->where('tag', $data['tag'])
                        ->where('account_fingerprint', $row->account_fingerprint)->lockForUpdate()->first();
                    $state = 'processed';
                    if (! $sub || $sub->tracking_number !== $data['number'] || (int) $sub->carrier_code !== $data['carrier']
                        || ! $sub->registration_requested_at || ($data['destination_country'] && $data['destination_country'] !== 'PH')) {
                        $state = 'quarantined';
                    } elseif (! $sub->diagnostic && (! $sub->active_tracker_id || ! self::eligible($sub->tracker, true))) {
                        // A callback can race the registration acknowledgement. Retry only while registration is genuinely in flight.
                        $inFlight = ! $sub->registered_at && self::eligible($sub->tracker);
                        $state = $inFlight ? 'pending' : 'ignored';
                    } else {
                        $events = array_values(array_filter(array_map(fn ($event, $i) => $this->event($event, $i),
                            $data['events'], array_keys($data['events']))));
                        // Several carrier scans can share a minute/date. Apply
                        // Delivered last at that instant instead of letting a
                        // hash decide whether an older nonterminal scan wins.
                        usort($events, fn ($a, $b) => [ShipmentTrackingEvents::eventTime($a['occurrenceDatetime'])['instant'], $a['statusMilestone'] === 'delivered', $a['eventId']]
                            <=> [ShipmentTrackingEvents::eventTime($b['occurrenceDatetime'])['instant'], $b['statusMilestone'] === 'delivered', $b['eventId']]);
                        // The complete, matched subscription history is valid
                        // even when staff records a number after an earlier scan.
                        // Event ordering below prevents older scans from regressing it.
                        // A carrier can classify the unchanged newest scan as
                        // Delivered later. Apply the snapshot status only when
                        // it unambiguously belongs to J&T, never another carrier.
                        $snapshotStatus = self::status($data['latest_status']);
                        if ($events && ($data['latest_status_trusted'] ?? false) && $snapshotStatus
                            && (! end($events)['statusMilestone'] || ($snapshotStatus === 'delivered' && end($events)['statusMilestone'] !== 'delivered'))) {
                            $index = array_key_last($events);
                            $milestone = $snapshotStatus;
                            $events[$index]['statusMilestone'] = $milestone;
                            // A status-only change is meaningful even when the
                            // carrier reuses the scan's text and timestamp.
                            $events[$index]['eventId'] = '17:'.hash('sha256', $events[$index]['eventId'].':'.$milestone);
                        }
                        foreach ($events as $position => $event) {
                            $event['order'] = $position;
                            if (! $sub->diagnostic) {
                                app(ShipmentTrackingEvents::class)->applyEvent($sub->tracker, $event, '17track', (string) $sub->carrier_code);
                            }
                        }
                        $latest = end($events);
                        if ($latest) {
                            $instant = Carbon::parse(ShipmentTrackingEvents::eventTime($latest['occurrenceDatetime'])['instant']);
                            if ($sub->diagnostic && OrderTrackingTest::installed() && (! $sub->last_event_at || $instant->gte($sub->last_event_at))) {
                                $sub->latest_result = [
                                    'status_label' => ShipmentTracking::LABELS[$latest['statusMilestone']] ?? 'Courier update',
                                    'time' => ShipmentTrackingEvents::eventTime($latest['occurrenceDatetime']),
                                    'location' => $latest['location'],
                                    'events' => array_map(fn ($scan) => [
                                        'title' => ShipmentTracking::LABELS[$scan['statusMilestone']] ?? 'Courier update',
                                        'description' => $scan['status'], 'location' => $scan['location'],
                                        'time_label' => ShipmentTrackingEvents::eventTime($scan['occurrenceDatetime'])['label'],
                                    ], array_reverse(array_slice($events, -100))),
                                ];
                            }
                            if (! $sub->last_event_at || $instant->gt($sub->last_event_at)) {
                                $sub->last_event_at = $instant;
                            }
                        }
                        $stopped = $sub->registration_state === 'stopped' || $data['event'] === 'TRACKING_STOPPED' || $data['latest_status'] === 'Expired';
                        $sub->registration_state = $stopped ? 'stopped' : 'active';
                        $sub->last_error_code = $stopped ? 'tracking_stopped' : ($events ? null : 'no_events');
                        if ($data['webhook']) {
                            $sub->last_webhook_at = Carbon::parse($row->created_at);
                            DB::table('shipment_tracking_settings')->where('provider', '17track')
                                ->where('account_fingerprint', $row->account_fingerprint)
                                ->update([$sub->diagnostic ? 'last_test_webhook_at' : 'last_webhook_at' => $sub->last_webhook_at, 'updated_at' => now()]);
                        }
                        $sub->save();
                        if (! $sub->diagnostic) {
                            if ($events && ! $sub->tracker->fresh()->needs_review) {
                                DB::table('shipment_tracking_settings')->where('provider', '17track')
                                    ->where('account_fingerprint', $row->account_fingerprint)->update([
                                        'waybill_verified_at' => now(), 'verified_tracker_id' => $sub->tracker_id, 'updated_at' => now(),
                                    ]);
                            }
                            ShipmentTrackingEvents::touchOrder($sub->tracker);
                        }
                    }
                    DB::table('shipment_webhook_inbox')->where('id', $id)->update(['state' => $state,
                        'next_attempt_at' => $state === 'pending' ? now()->addMinute() : null,
                        'processed_at' => $state === 'pending' ? null : now(), 'updated_at' => now()]);
                });
            } catch (\Throwable) {
                DB::table('shipment_webhook_inbox')->where('id', $id)->update(['attempts' => DB::raw('attempts + 1'),
                    'next_attempt_at' => now()->addMinutes(5), 'updated_at' => now()]);
                Log::warning('17TRACK update awaits processing', ['inbox_id' => $id]);
            }
        }
    }

    public function failed(Subscription $sub, SeventeenTrackException $error): void
    {
        $state = match ($error->reason) {
            'quota_limit_reached' => 'limited', 'details_rejected', 'response_mismatch', 'account_changed', 'tracking_number_in_use' => 'failed',
            default => 'retry',
        };
        $retry = in_array($error->reason, ['rate_limited', 'request_deferred'], true) ? $error->retryAfter
            : max($error->retryAfter, min(21600, 60 * 2 ** min(8, $sub->attempts)));
        $sub->update(['registration_state' => $state, 'last_error_code' => $error->reason, 'attempts' => $sub->attempts + 1,
            'next_attempt_at' => now()->addSeconds($retry)]);
        Log::notice('17TRACK operation deferred', ['subscription_id' => $sub->id, 'reason' => $error->reason,
            'http_status' => $error->httpStatus, 'provider_code' => $error->providerCode, 'endpoint' => $error->endpoint,
            'next_attempt_at' => $sub->next_attempt_at?->toIso8601String()]);
        if ($error->reason === 'quota_limit_reached') {
            DB::table('shipment_tracking_settings')->where('provider', '17track')->update(['quota_retry_at' => now()->addDay()]);
        }
        if ($sub->tracker) {
            ShipmentTrackingEvents::touchOrder($sub->tracker);
        }
    }

    public function process(float $deadline): void
    {
        $this->processInbox($deadline);
        if (SeventeenTrackClient::configured()) {
            foreach (Subscription::where('provider', '17track')->where('stop_pending', true)
                ->where('account_fingerprint', SeventeenTrackClient::fingerprint())
                ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))->limit(5)->get() as $sub) {
                if (microtime(true) >= $deadline) {
                    break;
                }
                try {
                    if ($sub->registration_requested_at) {
                        // Never stop another application's subscription after a rejected/ambiguous registration.
                        $external = $this->client->item('gettrackinfo', $this->identity($sub));
                        if (! $this->matches($sub, $external)) {
                            $sub->update(['stop_pending' => false, 'registration_state' => 'superseded', 'last_error_code' => 'response_mismatch']);

                            continue;
                        }
                        $this->client->item('stoptrack', $this->identity($sub));
                    }
                    $sub->update(['stop_pending' => false, 'registration_state' => 'superseded']);
                } catch (SeventeenTrackException $error) {
                    if (in_array($error->reason, ['not_registered', 'already_stopped'], true)) {
                        $sub->update(['stop_pending' => false, 'registration_state' => 'superseded']);
                    } else {
                        $this->failed($sub, $error);
                    }
                }
            }
        }
        if (ShipmentTracking::enabled()) {
            foreach (ShipmentTracker::whereNotNull('active_order_id')->where('demo', false)->where('status', '!=', 'delivered')->orderBy('id')->get() as $tracker) {
                if (microtime(true) >= $deadline) {
                    break;
                }
                if (! self::eligible($tracker)) {
                    continue;
                }
                $sub = $this->subscription($tracker);
                if (in_array($sub->registration_state, ['failed', 'stopped', 'superseded'], true)) {
                    continue;
                }
                if (! $this->due($sub)) {
                    continue;
                }
                try {
                    $this->register($sub);
                    $sub->refresh();
                    if ($sub->registered_at && microtime(true) < $deadline) {
                        $this->synchronize($sub);
                    }
                } catch (SeventeenTrackException $error) {
                    $this->failed($sub, $error);
                }
            }
        }
        // An explicitly linked external-parcel test reads saved results without activating real shipments.
        if (OrderTrackingTest::installed() && SeventeenTrackClient::configured()) {
            $ids = DB::table('orders')->whereNotNull('tracking_test_subscription_id')->where('lifecycle_status', 'pending')
                ->where('customer_stage', 'to_ship')->pluck('tracking_test_subscription_id');
            $checked = 0;
            foreach (Subscription::whereIn('id', $ids)->where('diagnostic', true)->whereNotNull('registered_at')
                ->where('account_fingerprint', SeventeenTrackClient::fingerprint())->where('registration_state', '!=', 'stopped')
                ->get() as $sub) {
                if (microtime(true) >= $deadline || $checked >= 5) {
                    break;
                }
                if (! $this->due($sub)) {
                    continue;
                }
                $checked++;
                try {
                    $this->synchronize($sub);
                } catch (SeventeenTrackException $error) {
                    $this->failed($sub, $error);
                }
            }
        }
        $this->processInbox($deadline);
        foreach (ShipmentTracker::whereNotNull('active_order_id')->where('demo', false)->where('status', 'delivered')
            ->whereHas('order', fn ($query) => $query->where('lifecycle_status', 'pending')->where('customer_stage', 'to_receive'))->lazyById(50) as $tracker) {
            if (microtime(true) >= $deadline) {
                break;
            }
            OrderCompletion::delivered($tracker);
        }
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update(['last_processed_at' => now()]);
    }
}
