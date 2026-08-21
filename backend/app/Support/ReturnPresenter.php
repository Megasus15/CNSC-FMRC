<?php

namespace App\Support;

use App\Models\OrderReturn;
use App\Models\OrderReturnEvent;
use App\Models\OrderReturnItem;
use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * One presenter for every return/refund payload.
 *
 * OrderReturnController (its own endpoints), OrderController::customerIndex
 * (the customer Returns tab) and OrderController::adminIndex (the admin queue)
 * all render returns, so the shape lives here instead of in three places.
 */
class ReturnPresenter
{
    public const PH_TIME_ZONE = 'Asia/Manila';

    /** One row for the customer Returns tab / admin queue. */
    public static function summary(OrderReturn $orderReturn, bool $forAdmin = false): array
    {
        $order = $orderReturn->relationLoaded('order') ? $orderReturn->order : null;
        $items = $orderReturn->relationLoaded('items') ? $orderReturn->items : collect();
        $latestEvent = $orderReturn->relationLoaded('latestEvent') ? $orderReturn->latestEvent : null;
        $returnNo = $orderReturn->return_no ?: ('RTN-' . $orderReturn->id);
        $orderNo = $order?->order_no ?: ($orderReturn->order_id ? 'ORD-' . $orderReturn->order_id : null);

        $lines = $items
            ->map(fn (OrderReturnItem $item) => [
                'id'               => $item->id,
                'order_item_id'    => $item->order_item_id,
                'product_id'       => $item->product_id,
                'product_name'     => $item->product_name,
                'quantity'         => (int) $item->quantity,
                'unit_price'       => (float) $item->unit_price,
                'unit_price_label' => self::money((float) $item->unit_price),
                'line_total'       => (float) $item->line_total,
                'line_total_label' => self::money((float) $item->line_total),
            ])
            ->values()
            ->all();

        $firstName = $lines[0]['product_name'] ?? 'Returned item';
        $extra = max(0, count($lines) - 1);

        $payload = [
            'id'                => $orderReturn->id,
            'return_no'         => $returnNo,
            'return_no_display' => '#' . $returnNo,
            'order_id'          => $orderReturn->order_id,
            'order_no'          => $orderNo,
            'order_no_display'  => $orderNo ? '#' . $orderNo : null,
            'order_total'       => $order ? (float) $order->total : null,
            'status'            => $orderReturn->status,
            'status_label'      => $orderReturn->statusLabel(),
            'status_group'      => in_array($orderReturn->status, OrderReturn::TERMINAL_STATUSES, true) ? 'closed' : 'open',
            'reason'            => $orderReturn->reason,
            'reason_label'      => $orderReturn->reasonLabel(),
            'reason_detail'     => $orderReturn->reason_detail,
            'resolution'        => $orderReturn->resolution,
            'resolution_label'  => $orderReturn->resolutionLabel(),
            'customer_note'     => $orderReturn->customer_note,
            'decision_note'     => $orderReturn->decision_note,
            'items'             => $lines,
            'items_count'       => count($lines),
            'quantity'          => (int) array_sum(array_column($lines, 'quantity')),
            'product_name'      => $extra > 0 ? "{$firstName} (+{$extra} more)" : $firstName,
            'media'             => self::media($orderReturn->media),
            'media_count'       => count($orderReturn->media ?? []),
            'requested_amount'  => (float) $orderReturn->requested_amount,
            'requested_amount_label' => self::money((float) $orderReturn->requested_amount),
            'approved_amount'   => $orderReturn->approved_amount !== null ? (float) $orderReturn->approved_amount : null,
            'approved_amount_label' => $orderReturn->approved_amount !== null
                ? self::money((float) $orderReturn->approved_amount)
                : null,
            'refunded_amount'   => $orderReturn->refunded_amount !== null ? (float) $orderReturn->refunded_amount : null,
            'refunded_amount_label' => $orderReturn->refunded_amount !== null
                ? self::money((float) $orderReturn->refunded_amount)
                : null,
            'refund_method'     => $orderReturn->refund_method,
            'refund_method_label' => $orderReturn->refundMethodLabel(),
            'refund_reference'  => $orderReturn->refund_reference,
            'return_courier_name' => $orderReturn->return_courier_name,
            'return_tracking_no'  => $orderReturn->return_tracking_no,
            'can_cancel'        => $orderReturn->status === 'requested',
            'can_ship_back'     => $orderReturn->status === 'approved',
            'requested_at'      => self::iso($orderReturn->requested_at ?? $orderReturn->created_at),
            'requested_at_label' => self::label($orderReturn->requested_at ?? $orderReturn->created_at),
            'decided_at'        => self::iso($orderReturn->decided_at),
            'decided_at_label'  => self::label($orderReturn->decided_at),
            'item_received_at'  => self::iso($orderReturn->item_received_at),
            'item_received_at_label' => self::label($orderReturn->item_received_at),
            'refunded_at'       => self::iso($orderReturn->refunded_at),
            'refunded_at_label' => self::label($orderReturn->refunded_at),
            'created_at'        => self::iso($orderReturn->created_at),
            'created_at_label'  => self::label($orderReturn->created_at),
            'is_archived'       => (bool) $orderReturn->is_archived,
            'archived_at'       => self::iso($orderReturn->archived_at),
            'latest_event'      => $latestEvent ? self::event($latestEvent) : null,
        ];

        if ($forAdmin) {
            $customer = $orderReturn->relationLoaded('customer') ? $orderReturn->customer : null;
            $handler = $orderReturn->relationLoaded('handler') ? $orderReturn->handler : null;

            $payload['customer_name'] = $customer?->name ?: ($order?->customer_name ?: 'Guest customer');
            $payload['customer_email'] = $customer?->email;
            $payload['customer_contact'] = $order?->customer_contact;
            $payload['handled_by'] = $handler?->name;
            $payload['handled_by_role'] = $handler?->role;
            $payload['can_decide'] = $orderReturn->status === 'requested';
            $payload['can_receive'] = in_array($orderReturn->status, ['approved', 'item_in_transit'], true);
            $payload['can_refund'] = in_array(
                $orderReturn->status,
                ['approved', 'item_received', 'refund_processing'],
                true,
            );
            $payload['can_archive'] = in_array($orderReturn->status, OrderReturn::TERMINAL_STATUSES, true);
        }

        return $payload;
    }

    /** Summary + newest-first timeline + the order snapshot the modals show. */
    public static function detail(OrderReturn $orderReturn, bool $forAdmin = false): array
    {
        $orderReturn->loadMissing(['order', 'items', 'events']);

        $timeline = $orderReturn->events
            ->sortByDesc(fn (OrderReturnEvent $event) => [
                $event->occurred_at?->getTimestamp() ?? 0,
                (int) $event->id,
            ])
            ->values()
            ->map(fn (OrderReturnEvent $event) => self::event($event))
            ->all();

        $order = $orderReturn->order;

        return array_merge(self::summary($orderReturn, $forAdmin), [
            'timeline'    => $timeline,
            'window_days' => OrderReturn::WINDOW_DAYS,
            'order'       => $order ? [
                'id'                 => $order->id,
                'order_no'           => $order->order_no,
                'customer_name'      => $order->customer_name,
                'customer_contact'   => $order->customer_contact,
                'total'              => (float) $order->total,
                'total_label'        => self::money((float) $order->total),
                'payment_method'     => $order->payment_method,
                'payment_status'     => $order->relationLoaded('payment') ? ($order->payment?->status ?? 'pending') : null,
                'customer_stage'     => $order->customer_stage,
                'lifecycle_status'   => $order->lifecycle_status,
                'completed_at'       => self::iso($order->completed_at),
                'completed_at_label' => self::label($order->completed_at),
            ] : null,
        ]);
    }

    public static function event(OrderReturnEvent $event): array
    {
        return [
            'id'                => $event->id,
            'status'            => $event->status,
            'status_label'      => OrderReturn::STATUS_LABELS[$event->status] ?? 'Return update',
            'actor_role'        => $event->actor_role,
            'title'             => $event->title,
            'description'       => $event->description,
            'metadata'          => $event->metadata,
            'occurred_at'       => self::iso($event->occurred_at),
            'occurred_at_label' => self::label($event->occurred_at),
        ];
    }

    /** @return array<int, array{value: string, label: string}> */
    public static function vocabulary(array $values, array $labels): array
    {
        return collect($values)
            ->map(fn (string $value) => ['value' => $value, 'label' => $labels[$value] ?? $value])
            ->values()
            ->all();
    }

    public static function media(?array $media): array
    {
        return collect($media ?? [])
            ->map(fn ($item) => [
                'url'  => self::mediaUrl($item),
                'type' => $item['type'] ?? 'image',
                'mime' => $item['mime'] ?? null,
                'name' => $item['name'] ?? null,
                'size' => $item['size'] ?? null,
            ])
            ->filter(fn ($item) => !empty($item['url']))
            ->values()
            ->all();
    }

    /**
     * Evidence uploads store an absolute URL baked from APP_URL, so a return
     * filed while APP_URL pointed elsewhere would hand the browser a dead link.
     * Rebuild from the stored relative path against the incoming request host
     * whenever the path is available.
     *
     * @param  array<string, mixed>  $item
     */
    private static function mediaUrl(array $item): ?string
    {
        $path = trim((string) ($item['path'] ?? ''), '/');
        if ($path !== '') {
            return url('/storage/'.$path);
        }

        return $item['url'] ?? null;
    }

    public static function iso(?DateTimeInterface $dateTime): ?string
    {
        return $dateTime
            ? Carbon::instance($dateTime)->timezone(self::PH_TIME_ZONE)->toIso8601String()
            : null;
    }

    public static function label(?DateTimeInterface $dateTime): ?string
    {
        return $dateTime
            ? Carbon::instance($dateTime)->timezone(self::PH_TIME_ZONE)->format('M d, Y h:i A')
            : null;
    }

    public static function money(float $amount): string
    {
        return '₱ ' . number_format($amount, 2, '.', ',');
    }
}
