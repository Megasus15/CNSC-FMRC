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

final class ShipmentTrackingEvents
{
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

    public function applyEvent(ShipmentTracker $tracker, array $event, string $source = '17track', ?string $carrier = null): void
    {
        $time = self::eventTime((string) ($event['occurrenceDatetime'] ?? ''));
        if (! $time || empty($event['eventId']) || ($event['courierCode'] ?? '') !== ($carrier ?? $tracker->carrier_code)) {
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
            'occurred_at' => $instant, 'metadata' => json_encode(['source' => $source, 'tracking_number' => $tracker->tracking_number,
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

    public static function touchOrder(ShipmentTracker $tracker): void
    {
        DB::table('orders')->where('id', $tracker->order_id)->increment('courier_history_version');
    }

    public function notifications(float $deadline): void
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
