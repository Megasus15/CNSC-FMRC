<?php

namespace App\Support;

use App\Models\OrderTrackingEvent;
use App\Models\ShipmentTracker;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/** A readable projection of the audit trail; never rewrites courier evidence. */
final class CustomerOrderTimeline
{
    public static function present(Collection $events, ?ShipmentTracker $currentTracker = null): array
    {
        $rows = [];
        foreach ($events as $event) {
            $metadata = $event->metadata ?? [];
            $courier = in_array($metadata['source'] ?? '', ['17track', 'ship24'], true);
            // A corrected number keeps its audit trail, but its scans must not
            // appear to describe the customer's current parcel.
            if ($courier && $currentTracker && (
                ($event->shipment_tracker_id && (int) $event->shipment_tracker_id !== (int) $currentTracker->id)
                || (!empty($metadata['tracking_number']) && strcasecmp(trim($metadata['tracking_number']), trim($currentTracker->tracking_number)) !== 0)
            )) continue;
            $time = $metadata['time'] ?? [];
            $precision = $time['precision'] ?? 'datetime';
            $rawTime = $time['raw'] ?? $event->occurred_at?->toIso8601String();
            $instant = $time['instant'] ?? $rawTime;
            try { $date = $instant ? Carbon::parse($instant)->timezone('Asia/Manila') : null; }
            catch (\Throwable) { $date = null; }
            $description = self::clean((string) $event->description);
            $location = self::clean((string) $event->location_name);
            $identity = ['event', $event->id];
            if ($courier && $date && !in_array($precision, ['missing', 'unknown'], true)) {
                // Snapshot stage/title can change even though this is the same scan.
                $identity = [$event->shipment_tracker_id ?: ($metadata['tracking_number'] ?? 'legacy'),
                    $metadata['carrier_code'] ?? $metadata['carrier'] ?? 'jnt-ph', $precision,
                    $precision === 'date' ? $date->format('Y-m-d') : $date->toISOString(),
                    mb_strtolower($description), mb_strtolower($location)];
            }
            $key = hash('sha256', json_encode($identity, JSON_UNESCAPED_UNICODE));
            if (isset($rows[$key])) continue;
            [$title, $detail, $status] = $courier ? self::scan($description, $event) : [(string) $event->title, $description, 'fmrc'];
            if (strcasecmp(trim($title, '. '), trim($detail, '. ')) === 0) $detail = '';
            $rows[$key] = [
                'id' => $courier ? 'scan-'.$key : 'event-'.$event->id,
                'kind' => $courier ? 'courier' : (($event->event_type === 'admin_update') ? 'note' : 'order'),
                'title' => $title, 'description' => $detail, 'location_name' => $location ?: null,
                'courier_description' => $courier ? $description : null,
                'status' => $status, 'occurred_at' => $rawTime, 'time_precision' => $precision,
                'date_key' => $date?->format('Y-m-d') ?? 'unknown',
                'date_label' => $date?->format('F j, Y') ?? 'Date unavailable',
                'time_label' => $date && $precision !== 'date' ? $date->format('g:i:s A') : ($date ? 'Time not supplied' : 'Time unavailable'),
                'occurred_at_label' => $date?->format($precision === 'date' ? 'M j, Y' : 'M j, Y, g:i:s A') ?? 'Time unavailable',
                '_sort' => $date?->getTimestamp() ?? 0, '_id' => $event->id,
            ];
        }
        $sorted = collect($rows)->sort(fn ($a, $b) => ($b['_sort'] <=> $a['_sort']) ?: ($b['_id'] <=> $a['_id']));
        return $sorted->map(function ($row) { unset($row['_sort'], $row['_id']); return $row; })->values()->all();
    }

    private static function clean(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', $value) ?? $value);
    }

    private static function place(string $value): string
    {
        $value = trim($value, " .,:;");
        return mb_strtoupper($value) === $value ? Str::title(mb_strtolower($value)) : $value;
    }

    private static function scan(string $text, OrderTrackingEvent $event): array
    {
        // Use this scan's wording, never today's order stage or snapshot status.
        if (preg_match('/\b(?:has been delivered|package (?:was |is )?delivered)\b/i', $text)
            || preg_match('/^Delivered(?:[,. ]|$)/i', $text)) {
            $detail = preg_replace('/^(?:Delivered[,. ]*)?(?:Your )?package (?:has been |was |is )?delivered[,. ]*/i', '', $text);
            return ['Delivered', self::clean($detail ?? $text), 'delivered'];
        }
        if (preg_match('/out for delivery/i', $text)) {
            $detail = preg_replace('/^Out for Delivery[,. ]*/i', '', $text);
            $detail = preg_replace('/^(?:Your )?package (?:is )?(?:out for delivery)[,. ]*/i', '', $detail ?? '');
            return ['Out for delivery', self::clean($detail ?? $text), 'out_for_delivery'];
        }
        if (preg_match('/(?:departed|departure).*?from (.+?) to (.+?)(?:[.!]|$)/i', $text, $m, PREG_OFFSET_CAPTURE)) {
            return ['Departed '.self::place($m[1][0]).' for '.self::place($m[2][0]),
                self::clean(substr($text, $m[0][1] + strlen($m[0][0]))), 'in_transit'];
        }
        if (preg_match('/(?:arrived|arrival).*?\bat (.+?)(?:[.!]|$)/i', $text, $m, PREG_OFFSET_CAPTURE)) {
            return ['Arrived at '.self::place($m[1][0]),
                self::clean(substr($text, $m[0][1] + strlen($m[0][0]))), 'in_transit'];
        }
        if (preg_match('/picked up|collected by (?:the )?courier/i', $text)) {
            $detail = preg_replace('/^(?:Picked Up[,. ]*)?(?:Your )?package (?:has been |was |is )?picked up(?: by (?:the )?courier)?[,. ]*/i', '', $text);
            return ['Picked up', self::clean($detail ?? $text), 'picked_up'];
        }
        $title = in_array($event->title, ['Courier update', 'In transit'], true) ? 'Delivery update' : (string) $event->title;
        return [$title ?: 'Delivery update', $text, 'update'];
    }
}
