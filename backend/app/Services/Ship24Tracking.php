<?php

namespace App\Services;

use App\Models\Order;
use App\Models\ShipmentTracker;
use App\Support\OrderNotifier;
use App\Support\Pwa;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

final class Ship24Tracking
{
    public function __construct(private Ship24Client $client) {}

    public function verifyCarrier(string $code): array
    {
        $carrier = collect($this->client->couriers())->firstWhere('courierCode', $code);
        if (! $carrier || ! preg_match('/J\s*&\s*T|\bJT\b/i', $carrier['courierName'] ?? '')
            || ! (($carrier['countryCode'] ?? '') === 'PH' || str_contains(strtolower($carrier['courierName'] ?? ''), 'philippines'))
            || ($carrier['isDeprecated'] ?? false)) {
            ShipmentTracking::fail('Choose the active J&T Philippines entry from the Ship24 courier list.');
        }
        $required = $carrier['requiredFields'] ?? [];
        if (array_diff($required, ['destinationPostCode', 'destinationCountryCode'])) {
            ShipmentTracking::fail('This carrier requires additional account information. Automatic tracking remains disabled until Ship24 confirms access.');
        }
        $settings = ShipmentTracking::settings();
        $changed = $settings->carrier_code !== $code || $settings->account_fingerprint !== Ship24Client::fingerprint();
        DB::table('shipment_tracking_settings')->where('id', 1)->update([
            'carrier_code' => $code, 'carrier_requirements' => json_encode($required), 'account_fingerprint' => Ship24Client::fingerprint(),
            'carrier_verified_at' => now(), 'revision' => DB::raw('revision + 1'), 'updated_at' => now(),
            ...($changed ? ['enabled' => false, 'waybill_verified_at' => null, 'verified_tracker_id' => null, 'last_webhook_at' => null] : []),
        ]);

        return $carrier;
    }

    public function verifyWaybill(ShipmentTracker $tracker): bool
    {
        if ($tracker->demo || ! $tracker->active_order_id) {
            ShipmentTracking::fail('Record a real prepaid J&T handover before verifying tracking.');
        }
        try {
            $this->register($tracker, true);
            $tracker->refresh();
            if (! $tracker->provider_tracker_id) {
                return false;
            }
            $this->synchronize($tracker);
        } catch (Ship24Exception $error) {
            $this->failed($tracker, $error);
            throw $error;
        }
        $this->processInbox(microtime(true) + 10);
        $tracker->refresh();
        if (! $tracker->last_event_at || $tracker->needs_review) {
            return false;
        }
        DB::table('shipment_tracking_settings')->where('id', 1)->where('account_fingerprint', Ship24Client::fingerprint())
            ->update(['waybill_verified_at' => now(), 'verified_tracker_id' => $tracker->id, 'revision' => DB::raw('revision + 1'), 'updated_at' => now()]);

        return true;
    }

    public function register(ShipmentTracker $tracker, bool $verification = false): void
    {
        $settings = ShipmentTracking::settings();
        if ($tracker->demo || ! $tracker->active_order_id || ! Ship24Client::configured() || ! $settings?->carrier_verified_at
            || $settings->account_fingerprint !== Ship24Client::fingerprint() || (! $verification && ! ShipmentTracking::enabled())) {
            return;
        }
        if ($tracker->account_fingerprint && $tracker->account_fingerprint !== Ship24Client::fingerprint()) {
            throw new Ship24Exception('account_changed');
        }
        $existingPayload = $tracker->registration_payload;
        $external = null;
        if ($existingPayload) {
            try {
                $external = $this->client->find($tracker->client_tracker_id);
            } catch (Ship24Exception $error) {
                if ($error->reason !== 'not_found') {
                    throw $error;
                }
            }
        }
        if (! $external) {
            // Include uncertain requests in the local cap: a lost response may already have used a shipment.
            $monthStart = Carbon::now('Asia/Manila')->startOfMonth()->utc();
            $count = ShipmentTracker::where('registration_requested_at', '>=', $monthStart)->count();
            $reservedThisMonth = $tracker->registration_requested_at?->gte($monthStart);
            if ((! $reservedThisMonth && $count >= max(0, (int) config('ship24.monthly_registration_limit')))
                || ($settings->quota_retry_at && Carbon::parse($settings->quota_retry_at)->isFuture())) {
                throw new Ship24Exception('quota_limit_reached', 86400);
            }
            if (! $existingPayload) {
                $payload = ['trackingNumber' => $tracker->tracking_number, 'clientTrackerId' => $tracker->client_tracker_id,
                    'shipmentReference' => $tracker->client_tracker_id, 'courierCode' => [$settings->carrier_code],
                    'originCountryCode' => 'PH', 'destinationCountryCode' => 'PH', 'destinationPostCode' => $tracker->order->delivery_postal_code,
                    'shippingDate' => $tracker->handed_over_at->toIso8601String(), 'settings' => ['restrictTrackingToCourierCode' => true]];
                $tracker->update(['registration_payload' => $payload, 'carrier_code' => $settings->carrier_code, 'account_fingerprint' => Ship24Client::fingerprint()]);
            }
            if (! $reservedThisMonth) {
                $tracker->update(['registration_requested_at' => now()]);
            }
            // This exact persisted payload is reused after any uncertain response.
            $external = $this->client->create($tracker->registration_payload);
        }
        if (! $this->matches($tracker, $external) || empty($external['trackerId'])) {
            throw new Ship24Exception('response_mismatch');
        }
        DB::transaction(function () use ($tracker, $external) {
            $saved = ShipmentTracker::whereKey($tracker->id)->lockForUpdate()->firstOrFail();
            $saved->update(['provider_tracker_id' => $external['trackerId'], 'registered_at' => $saved->registered_at ?? now(),
                'registration_state' => $saved->active_order_id ? 'active' : 'superseded', 'unsubscribe_pending' => ! $saved->active_order_id,
                'attempts' => 0, 'last_error_code' => null, 'next_attempt_at' => now()]);
            self::touchOrder($saved);
        });
    }

    private function matches(ShipmentTracker $tracker, array $external): bool
    {
        return strtoupper((string) ($external['trackingNumber'] ?? '')) === $tracker->tracking_number
            && (filled($external['clientTrackerId'] ?? null)
                ? $external['clientTrackerId'] === $tracker->client_tracker_id
                : ($tracker->provider_tracker_id && ($external['trackerId'] ?? '') === $tracker->provider_tracker_id))
            && (! $tracker->provider_tracker_id || ($external['trackerId'] ?? '') === $tracker->provider_tracker_id)
            && (! filled($external['shipmentReference'] ?? null) || $external['shipmentReference'] === $tracker->client_tracker_id);
    }

    public function synchronize(ShipmentTracker $tracker): void
    {
        if (! $tracker->provider_tracker_id || $tracker->demo) {
            return;
        }
        if ($tracker->account_fingerprint !== Ship24Client::fingerprint()) {
            throw new Ship24Exception('account_changed');
        }
        $updates = $this->client->results($tracker->provider_tracker_id);
        foreach ($updates as $update) {
            if (! $this->matches($tracker, $update['tracker'] ?? [])) {
                throw new Ship24Exception('response_mismatch');
            }
        }
        $this->receive($updates, false);
        $tracker->update(['last_checked_at' => now(), 'next_attempt_at' => now()->addHours(6), 'attempts' => 0,
            'last_error_code' => null, 'registration_state' => $tracker->active_order_id ? 'active' : 'superseded']);
        self::touchOrder($tracker);
    }

    public function receive(array $trackings, bool $webhook = true): void
    {
        DB::transaction(function () use ($trackings, $webhook) {
            foreach ($trackings as $tracking) {
                $payload = [
                    'tracker' => array_intersect_key($tracking['tracker'] ?? [], array_flip(['trackerId', 'clientTrackerId', 'trackingNumber', 'shipmentReference'])),
                    'shipment' => array_intersect_key($tracking['shipment'] ?? [], array_flip(['destinationCountryCode'])),
                    'metadata' => array_intersect_key($tracking['metadata'] ?? [], array_flip(['messageId', 'generatedAt', 'topic'])),
                    'events' => array_map(fn ($event) => array_intersect_key($event, array_flip(['eventId', 'trackingNumber', 'eventTrackingNumber',
                        'status', 'occurrenceDatetime', 'order', 'location', 'courierCode', 'statusMilestone', 'statusCode'])), $tracking['events'] ?? []),
                ];
                $key = hash('sha256', Ship24Client::fingerprint().':'.($webhook ? 'webhook:' : 'results:')
                    .($payload['tracker']['trackerId'] ?? '').':'.($payload['metadata']['messageId'] ?? json_encode($payload)));
                DB::table('shipment_webhook_inbox')->insertOrIgnore(['message_key' => $key, 'account_fingerprint' => Ship24Client::fingerprint(),
                    'payload' => json_encode($payload), 'state' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
            }
            if ($webhook) {
                DB::table('shipment_tracking_settings')->where('id', 1)->where('account_fingerprint', Ship24Client::fingerprint())
                    ->update(['last_webhook_at' => now(), 'updated_at' => now()]);
            }
        });
    }

    public function processInbox(float $deadline): void
    {
        $ids = DB::table('shipment_webhook_inbox')->where('state', 'pending')->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))->orderBy('id')->limit(100)->pluck('id');
        foreach ($ids as $id) {
            if (microtime(true) >= $deadline) {
                break;
            }
            try {
                DB::transaction(function () use ($id) {
                    $inbox = DB::table('shipment_webhook_inbox')->where('id', $id)->lockForUpdate()->first();
                    if ($inbox->state !== 'pending') {
                        return;
                    }
                    $payload = json_decode($inbox->payload, true);
                    $external = $payload['tracker'];
                    $tracker = ShipmentTracker::where(filled($external['clientTrackerId'] ?? null) ? 'client_tracker_id' : 'provider_tracker_id',
                        filled($external['clientTrackerId'] ?? null) ? $external['clientTrackerId'] : ($external['trackerId'] ?? ''))
                        ->where('account_fingerprint', $inbox->account_fingerprint)->lockForUpdate()->first();
                    $state = 'processed';
                    if (! $tracker || ! $this->matches($tracker, $external) || ! $tracker->registration_payload) {
                        $state = 'quarantined';
                    } elseif (! $tracker->active_order_id || $tracker->demo) {
                        $state = 'ignored';
                    } elseif (! empty($payload['shipment']['destinationCountryCode']) && $payload['shipment']['destinationCountryCode'] !== 'PH') {
                        $state = 'quarantined';
                    } else {
                        if (! $tracker->provider_tracker_id) {
                            $tracker->update(['provider_tracker_id' => $external['trackerId'], 'registered_at' => $tracker->registered_at ?? now(), 'registration_state' => 'active']);
                        }
                        $events = $payload['events'];
                        usort($events, fn ($a, $b) => [(self::eventTime($a['occurrenceDatetime'] ?? '')['instant'] ?? ''), ($a['order'] ?? 0)]
                            <=> [(self::eventTime($b['occurrenceDatetime'] ?? '')['instant'] ?? ''), ($b['order'] ?? 0)]);
                        foreach ($events as $event) {
                            $this->event($tracker, $event);
                        }
                    }
                    if ($state === 'quarantined' && $tracker) {
                        $tracker->update(['needs_review' => true, 'last_error_code' => 'response_mismatch']);
                        self::touchOrder($tracker);
                    }
                    DB::table('shipment_webhook_inbox')->where('id', $id)->update(['state' => $state, 'processed_at' => now(), 'updated_at' => now()]);
                });
            } catch (\Throwable $error) {
                DB::table('shipment_webhook_inbox')->where('id', $id)->update(['attempts' => DB::raw('attempts + 1'), 'next_attempt_at' => now()->addMinutes(5), 'updated_at' => now()]);
                Log::warning('Shipment update awaits processing', ['inbox_id' => $id]);
            }
        }
    }

    public static function eventTime(string $raw): ?array
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/', $raw)) {
            return null;
        }
        try {
            $date = Carbon::parse($raw, 'Asia/Manila');
            if ($date->format('Y-m-d') !== substr($raw, 0, 10) || $date->gt(now()->addDay())) {
                return null;
            }
            $dateOnly = strlen($raw) === 10;

            return ['instant' => $date->copy()->utc()->toISOString(), 'raw' => $raw, 'precision' => $dateOnly ? 'date' : 'datetime',
                'label' => $dateOnly ? $date->format('M j, Y') : $date->copy()->tz('Asia/Manila')->format('M j, Y g:i A')];
        } catch (\Throwable) {
            return null;
        }
    }

    private function event(ShipmentTracker $tracker, array $event): void
    {
        $time = self::eventTime((string) ($event['occurrenceDatetime'] ?? ''));
        if (! $time || empty($event['eventId']) || ($event['courierCode'] ?? '') !== $tracker->carrier_code) {
            return;
        }
        $instant = Carbon::parse($time['instant']);
        if ($instant->lt($tracker->handed_over_at->copy()->subDays(10))) {
            return;
        }
        $status = array_key_exists($event['statusMilestone'] ?? '', ShipmentTracking::LABELS) ? $event['statusMilestone'] : null;
        $text = Str::limit(trim((string) ($event['status'] ?? '')), 500, '');
        $location = Str::limit(trim((string) ($event['location'] ?? '')), 160, '');
        $order = Order::findOrFail($tracker->order_id);
        $inserted = DB::table('order_tracking_events')->insertOrIgnore(['order_id' => $tracker->order_id, 'shipment_tracker_id' => $tracker->id,
            'provider_event_id' => Str::limit($event['eventId'], 100, ''), 'stage' => $order->customer_stage, 'event_type' => 'courier_update',
            'title' => $status ? ShipmentTracking::LABELS[$status] : 'Courier update', 'description' => $text, 'location_name' => $location ?: null,
            'occurred_at' => $instant, 'metadata' => json_encode(['source' => 'ship24', 'tracking_number' => $tracker->tracking_number,
                'event_order' => (int) ($event['order'] ?? 0), 'time' => $time, 'status_code' => $event['statusCode'] ?? null]),
            'created_at' => now(), 'updated_at' => now()]);
        if (! $inserted) {
            return;
        }
        self::touchOrder($tracker);
        $previous = isset($tracker->last_event_time['instant']) ? Carbon::parse($tracker->last_event_time['instant']) : $tracker->last_event_at;
        $older = $previous && ($instant->lt($previous)
            || ($instant->eq($previous) && (int) ($event['order'] ?? 0) <= $tracker->last_event_order));
        if ($older || ! $status) {
            return;
        }
        if ($tracker->status === 'delivered' && $status !== 'delivered') {
            $tracker->update(['needs_review' => true, 'last_error_code' => 'conflicting_terminal_update']);

            return;
        }
        $tracker->update(['status' => $status, 'provider_status' => $text, 'location' => $location ?: null,
            'last_event_at' => $instant, 'last_event_order' => (int) ($event['order'] ?? 0), 'last_event_time' => $time]);
        if (in_array($status, ['out_for_delivery', 'delivered', 'failed_attempt', 'exception'], true)) {
            ShipmentTracking::notifyLater($tracker, $status);
        }
    }

    private static function touchOrder(ShipmentTracker $tracker): void
    {
        DB::table('orders')->where('id', $tracker->order_id)->increment('courier_history_version');
    }

    private function failed(ShipmentTracker $tracker, Ship24Exception $error): void
    {
        $seconds = max($error->retryAfter, min(21600, 60 * (2 ** min(8, $tracker->attempts))));
        $state = match ($error->reason) {
            'quota_limit_reached' => 'limited',
            'details_rejected', 'response_mismatch', 'account_changed' => 'failed',
            default => 'retry',
        };
        $tracker->refresh();
        $tracker->update(['registration_state' => $tracker->active_order_id ? $state : 'superseded', 'last_error_code' => $error->reason,
            'attempts' => $tracker->attempts + 1, 'next_attempt_at' => now()->addSeconds($seconds)]);
        if ($error->reason === 'quota_limit_reached') {
            DB::table('shipment_tracking_settings')->where('id', 1)->update(['quota_retry_at' => now()->addDay()]);
        }
        self::touchOrder($tracker);
    }

    public function process(float $deadline): void
    {
        $this->processInbox($deadline);
        if (Ship24Client::configured()) {
            foreach (ShipmentTracker::where('unsubscribe_pending', true)->where('account_fingerprint', Ship24Client::fingerprint())
                ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))->limit(5)->get() as $tracker) {
                if (microtime(true) >= $deadline) {
                    break;
                }
                try {
                    $id = $tracker->provider_tracker_id;
                    if (! $id) {
                        $id = $this->client->find($tracker->client_tracker_id)['trackerId'] ?? null;
                    }
                    if ($id) {
                        $this->client->unsubscribe($id);
                    }
                    $tracker->update(['unsubscribe_pending' => false]);
                } catch (Ship24Exception $error) {
                    if ($error->reason === 'not_found') {
                        $tracker->update(['unsubscribe_pending' => false]);
                    } else {
                        $this->failed($tracker, $error);
                    }
                }
            }
        }
        if (ShipmentTracking::enabled()) {
            foreach (ShipmentTracker::whereNotNull('active_order_id')->where('demo', false)->where('registration_state', '!=', 'failed')
                ->where(fn ($q) => $q->where('status', '!=', 'delivered')->orWhereNull('last_checked_at')->orWhereColumn('last_refresh_requested_at', '>', 'last_checked_at'))
                ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))->orderBy('next_attempt_at')->limit(10)->get() as $tracker) {
                if (microtime(true) >= $deadline) {
                    break;
                }
                try {
                    if (! $tracker->provider_tracker_id) {
                        $this->register($tracker);
                    }
                    $tracker->refresh();
                    if ($tracker->active_order_id && $tracker->provider_tracker_id && microtime(true) < $deadline) {
                        $this->synchronize($tracker);
                    }
                } catch (Ship24Exception $error) {
                    $this->failed($tracker, $error);
                }
            }
        }
        $this->processInbox($deadline);
        $this->notifications($deadline);
        DB::table('shipment_tracking_settings')->where('id', 1)->update(['last_processed_at' => now()]);
    }

    private function notifications(float $deadline): void
    {
        foreach (DB::table('shipment_notification_outbox')->whereNull('sent_at')
            ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))->orderBy('id')->limit(10)->get() as $notification) {
            if (microtime(true) >= $deadline) {
                break;
            }
            try {
                DB::transaction(function () use ($notification) {
                    $row = DB::table('shipment_notification_outbox')->where('id', $notification->id)->lockForUpdate()->first();
                    if ($row->sent_at) {
                        return;
                    }
                    $tracker = ShipmentTracker::findOrFail($row->tracker_id);
                    $order = $tracker->order;
                    if ($tracker->active_order_id && ! $tracker->demo) {
                        $title = ShipmentTracking::LABELS[$row->milestone];
                        $message = 'Order '.$order->order_no.': '.$title.'. Open My Orders for the latest details.';
                        if (! $row->in_app_sent_at && Pwa::installed()) {
                            app(PwaNotifications::class)->publish((int) $order->customer_id, 'order', $title, $message,
                                '/home-page/?orders=1&order_id='.$order->id, 'shipment:'.$tracker->id.':'.$row->milestone);
                        }
                        if (! $row->in_app_sent_at && in_array($row->milestone, ['failed_attempt', 'exception'], true)) {
                            OrderNotifier::notifyAdmins('warning', $title, $message, ['order_id' => $order->id]);
                        }
                    }
                    DB::table('shipment_notification_outbox')->where('id', $row->id)->update(['in_app_sent_at' => now(), 'updated_at' => now()]);
                });
                $tracker = ShipmentTracker::findOrFail($notification->tracker_id);
                if ($tracker->active_order_id && ! $tracker->demo) {
                    $title = ShipmentTracking::LABELS[$notification->milestone];
                    $message = 'Order '.$tracker->order->order_no.': '.$title.'. Open My Orders for the latest details.';
                    OrderNotifier::emailCustomerNow($tracker->order, 'Delivery update – '.$tracker->order->order_no,
                        OrderNotifier::buildEmailHtml($tracker->order, $title, $message, statusOverride: $title, templateKey: 'order_tracking_update',
                            tokens: ['stage' => $title, 'update_title' => $title, 'details' => 'Waybill: '.$tracker->tracking_number]));
                }
                DB::table('shipment_notification_outbox')->where('id', $notification->id)->update(['sent_at' => now(), 'updated_at' => now()]);
            } catch (\Throwable $error) {
                DB::table('shipment_notification_outbox')->where('id', $notification->id)->update(['attempts' => $notification->attempts + 1,
                    'next_attempt_at' => now()->addSeconds(min(21600, 60 * 2 ** min(8, $notification->attempts))), 'updated_at' => now()]);
                Log::warning('Shipment notification awaits delivery', ['notification_id' => $notification->id]);
            }
        }
    }
}
