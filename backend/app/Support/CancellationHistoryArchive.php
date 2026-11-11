<?php

namespace App\Support;

use App\Models\{Order, OrderCancellationArchive, OrderReturn};
use App\Services\AppointmentProducts;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\{DB, Schema};

/** Team history visibility only. Never archives an order or changes its money. */
final class CancellationHistoryArchive
{
    public static function available(): bool
    {
        return Schema::hasTable('order_cancellation_archives');
    }

    public static function key(Order $order): ?string
    {
        if (! $order->cancel_requested_at || ! in_array($order->cancel_state, ['requested', 'approved', 'declined'], true)) return null;
        return hash('sha256', implode('|', [$order->id, $order->cancel_requested_at->format('Y-m-d H:i:s.u'), $order->latestCancellationRequest?->id ?? 'legacy']));
    }

    public static function prime(Collection $orders): void
    {
        $orders = $orders->filter(fn ($order) => in_array($order->cancel_state, ['requested', 'approved', 'declined'], true));
        if ($orders->isEmpty()) return;
        $available = self::available();
        $orders->loadMissing('latestCancellationRequest');
        CustomerOrderHistory::prime($orders);
        $records = $available ? OrderCancellationArchive::whereIn('order_id', $orders->pluck('id'))->get()->keyBy('request_key') : collect();
        foreach ($orders as $order) {
            $order->setRelation('cancellationArchiveStorageAvailable', $available);
            $order->setRelation('cancellationArchiveRecord', $records->get(self::key($order)));
        }
    }

    public static function state(Order $order): array
    {
        if (! $order->relationLoaded('cancellationArchiveRecord')) self::prime(new \Illuminate\Database\Eloquent\Collection([$order]));
        $key = self::key($order);
        $record = $order->relationLoaded('cancellationArchiveRecord') ? $order->getRelation('cancellationArchiveRecord') : null;
        $archived = $record && ! $record->restored_at;
        $result = ['request_key' => $key, 'archived' => (bool) $archived, 'allowed' => false, 'reason' => null];
        $reason = match (true) {
            ! in_array($order->cancel_state, ['requested', 'approved', 'declined'], true) => 'No customer cancellation is recorded.',
            ! ($order->getRelation('cancellationArchiveStorageAvailable') ?? false) => 'Cancellation archiving needs the site migration.',
            ! $key => 'The cancellation request date is unavailable.',
            (bool) $order->is_archived => 'Restore the order before archiving its cancellation.',
            (bool) $archived => 'This cancellation is already archived.',
            $order->cancel_state === 'requested' => 'Review the cancellation first.',
            default => self::financialBlock($order),
        };
        return array_replace($result, ['allowed' => $reason === null, 'reason' => $reason]);
    }

    private static function financialBlock(Order $order): ?string
    {
        $refunds = $order->getRelation('historyRefunds');
        $attempts = $order->getRelation('historyAttempts');
        $closed = in_array($order->lifecycle_status, ['cancelled', 'rejected'], true);
        if ($order->cancel_refund_due) return 'Confirm the refund before archiving.';
        if ($refunds->isNotEmpty() && OnlineRefundArchive::blockedReason($refunds, $order->cancel_state)) return 'Resolve the refund before archiving.';
        if ($order->historyReturns->contains(fn ($row) => ! in_array($row->status, OrderReturn::TERMINAL_STATUSES, true))) return 'Resolve the return or refund first.';
        $payment = $order->payment;
        if ($payment?->status === 'pending' && $payment->hasCustomerClaim()) return 'Verify the payment claim first.';
        if ($attempts->contains(fn ($attempt) => ($attempt->exception && ! ($payment?->status === 'refunded' && in_array($attempt->exception, ['late_payment_refund_review', 'duplicate_payment_review'], true)))
            || ($closed && ! $attempt->confirmed_at && in_array($attempt->status, ['creating', 'pending', 'unknown'], true)))) return 'Finish the payment review first.';
        if ($closed && (($payment?->status === 'paid' && (float) $payment->amount > 0) || AppointmentProducts::moneyHeld($order) > 0)) return 'Confirm the remaining refund first.';
        return null;
    }

    public static function snapshot(Order $order): array
    {
        return [
            'order_no' => $order->order_no, 'customer_name' => $order->customer_name,
            'status' => $order->cancel_state, 'reason' => $order->cancelReasonLabel(),
            'reason_detail' => $order->cancel_reason_detail, 'decision_note' => $order->cancel_decision_note,
            'requested_at' => $order->cancel_requested_at?->toIso8601String(),
            'decided_at' => $order->cancel_decided_at?->toIso8601String(),
            'payment_method' => $order->payment?->method ?? $order->payment_method,
            'payment_status' => $order->payment?->status, 'amount' => (float) $order->total,
        ];
    }

    public static function restoreBlock(OrderCancellationArchive $record): ?string
    {
        if (! $record->order) return 'The linked order is no longer available.';
        if ($record->order->is_archived) return 'Restore the linked order first.';
        if (self::key($record->order) !== $record->request_key) return 'A newer cancellation request exists. This record remains available to view.';
        return null;
    }

    public static function present(OrderCancellationArchive $record): array
    {
        $reason = self::restoreBlock($record);
        return array_merge($record->snapshot, [
            'id' => 'cancellation-'.$record->id, 'source_id' => $record->id, 'module' => 'cancellation',
            'order_id' => $record->order_id, 'archived_at' => $record->archived_at->toIso8601String(),
            'archived_by' => $record->archiver?->name ?? 'FMRC team',
            'can_restore' => ! $record->restored_at && $reason === null, 'restore_reason' => $reason,
        ]);
    }

    public static function restoreIds(array $ids, int $actor): array
    {
        $processed = [];
        foreach ($ids as $id) {
            $saved = DB::transaction(function () use ($id, $actor) {
                $existing = OrderCancellationArchive::find($id);
                if (! $existing) return false;
                $order = $existing->order_id ? Order::whereKey($existing->order_id)->lockForUpdate()->first() : null;
                $record = OrderCancellationArchive::whereKey($id)->lockForUpdate()->first();
                $record->setRelation('order', $order);
                if (self::restoreBlock($record)) return false;
                if (! $record->restored_at) $record->forceFill(['restored_at' => now(), 'restored_by' => $actor])->save();
                return true;
            });
            if ($saved) $processed[] = (int) $id;
        }
        return $processed;
    }
}
