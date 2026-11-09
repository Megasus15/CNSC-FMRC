<?php

namespace App\Support;

use App\Models\Order;
use App\Models\OrderReturn;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Customer visibility only. Never archives or deletes a business record. */
final class CustomerOrderHistory
{
    public const WAIT_DAYS = 7;

    public static function available(): bool
    {
        return Schema::hasColumn('orders', 'customer_hidden_at');
    }

    /** Load policy evidence in batches, including administratively archived returns. */
    public static function prime(Collection $orders): void
    {
        if ($orders->isEmpty()) return;
        $available = self::available();
        foreach ($orders as $order) $order->setRelation('historyStorageAvailable', $available);
        $orders->loadMissing(['payment', 'historyReturns.latestEvent', 'historyClosureEvents']);
        $ids = $orders->pluck('payment.id')->filter()->values();
        foreach (['payment_refunds' => 'historyRefunds', 'payment_attempts' => 'historyAttempts', 'payment_receipts' => 'historyReceipts'] as $table => $relation) {
            $grouped = $ids->isNotEmpty() && Schema::hasTable($table)
                ? DB::table($table)->whereIn('payment_id', $ids)->get()->groupBy('payment_id') : collect();
            foreach ($orders as $order) $order->setRelation($relation, $grouped->get($order->payment?->id, collect()));
        }
    }

    public static function state(Order $order): array
    {
        $result = ['eligible' => false, 'available_at' => null, 'available_at_label' => null, 'reason' => null, 'code' => null];
        $deny = static fn (string $code, string $reason): array => array_replace($result, compact('code', 'reason'));
        $available = $order->relationLoaded('historyStorageAvailable') ? $order->getRelation('historyStorageAvailable') : self::available();
        if (!$available) return $deny('setup_required', 'Order history removal will be available after the site update finishes.');
        if ($order->customer_hidden_at) return $deny('removed', 'Removed from My Orders. FMRC retains the transaction record.');
        $closed = in_array($order->lifecycle_status, ['cancelled', 'rejected'], true)
            || ($order->lifecycle_status === 'completed' && $order->customer_stage === 'completed');
        if (!$closed) return $deny('in_progress', 'Orders can be removed after they are closed.');
        if ($order->hasPendingCancellation()) return $deny('cancellation_open', 'Wait until FMRC finishes reviewing the cancellation.');
        if (!$order->relationLoaded('historyRefunds')) self::prime(new \Illuminate\Database\Eloquent\Collection([$order]));
        $returns = $order->historyReturns;
        if ($returns->contains(fn ($row) => !in_array($row->status, OrderReturn::TERMINAL_STATUSES, true))) {
            return $deny('return_open', 'Wait until your return or refund request is resolved.');
        }
        if ($order->cancel_refund_due) return $deny('refund_due', 'FMRC still needs to confirm your refund.');
        $refunds = $order->getRelation('historyRefunds');
        if ($refunds->isNotEmpty() && OnlineRefundArchive::blockedReason($refunds, $order->cancel_state)) {
            return $deny('refund_unresolved', 'Wait until the payment provider confirms the refund or FMRC resolves the refund issue.');
        }
        $cancelled = in_array($order->lifecycle_status, ['cancelled', 'rejected'], true);
        $payment = $order->payment;
        $receipts = $order->getRelation('historyReceipts');
        if ($cancelled && $receipts->contains(function ($receipt) use ($refunds) {
            return $receipt->confirmed_at && (int) $receipt->amount_centavos > (int) $refunds
                ->where('provider_payment_id', $receipt->provider_payment_id)->where('status', 'succeeded')->sum('amount_centavos');
        })) return $deny('refund_due', 'A confirmed payment for this closed order still needs to be refunded.');
        if ($cancelled && $payment?->status === 'paid' && (float) ($payment->amount ?? $order->total) > 0) {
            return $deny('refund_due', 'FMRC still needs to confirm the refund for this closed order.');
        }
        if (!$cancelled && !in_array($payment?->status, ['paid', 'refunded'], true)) {
            return $deny('payment_unresolved', 'FMRC needs to confirm the payment status before this order can be removed.');
        }
        if ($order->getRelation('historyAttempts')->contains(function ($attempt) use ($payment, $cancelled) {
            if ($attempt->exception && !($payment?->status === 'refunded' && in_array($attempt->exception, ['late_payment_refund_review', 'duplicate_payment_review'], true))) return true;
            return $cancelled && !$attempt->confirmed_at && in_array($attempt->status, ['creating', 'pending', 'unknown'], true);
        })) return $deny('payment_review', 'A payment reconciliation or review is still in progress.');

        $anchor = $cancelled ? ($order->cancelled_at ?? $order->rejected_at ?? $order->cancel_decided_at) : $order->completed_at;
        if (!$anchor && $cancelled) {
            $title = match ($order->lifecycle_status) { 'cancelled' => 'Order cancelled', 'rejected' => 'Order rejected', default => 'Order completed' };
            $anchor = $order->historyClosureEvents->first(fn ($event) => strcasecmp($event->title, $title) === 0)?->occurred_at;
        }
        if (!$anchor) return $deny('closure_date_missing', 'The closure date is unavailable. Contact FMRC before removing this order.');
        if ($payment?->status === 'refunded' && !$payment->refunded_at && $refunds->where('status', 'succeeded')->isEmpty()) {
            return $deny('refund_date_missing', 'FMRC needs to confirm when the refund was completed.');
        }
        $times = collect([$anchor, $payment?->refunded_at]);
        foreach ($returns as $return) $times->push($return->refunded_at ?? $return->decided_at ?? $return->latestEvent?->occurred_at);
        foreach ($refunds->where('status', 'succeeded') as $refund) {
            if (!$refund->confirmed_at) return $deny('refund_date_missing', 'FMRC needs to confirm when the refund was completed.');
            $times->push($refund->confirmed_at);
        }
        $latest = $times->filter()->map(fn ($time) => Carbon::parse($time))->sortByDesc(fn ($time) => $time->getTimestamp())->first();
        $available = $latest->copy()->addDays(self::WAIT_DAYS)->timezone('Asia/Manila');
        $result['available_at'] = $available->toIso8601String();
        $result['available_at_label'] = $available->format('M j, Y, g:i A');
        if (!now()->greaterThan($available)) return array_replace($result, ['code' => 'waiting_period', 'reason' => 'Available after '.$result['available_at_label'].', once the seven-day protection period ends.']);
        $result['eligible'] = true;
        return $result;
    }
}
