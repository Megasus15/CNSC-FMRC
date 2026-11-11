<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\AppointmentProductJob;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Support\OnlineRefundArchive;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Team presentation and archive eligibility only; never changes linked work. */
final class AppointmentWorkState
{
    public static function for(Appointment $appointment, ?AppointmentProductJob $job = null, bool $lock = false): array
    {
        $status = $appointment->status === 'Archived'
            ? ($appointment->getAttribute('archived_from_status') ?: 'Completed') : $appointment->status;
        $resolved = in_array($status, ['Completed', 'Cancelled'], true);
        $times = collect([$appointment->consultation_completed_at]);
        $reason = $resolved ? null : 'Confirm the consultation first.';
        if ($appointment->getAttribute('product_job_id') && ! AppointmentProducts::installed()) {
            $reason = 'Custom-product details are unavailable.';
        } else {
            $job ??= AppointmentProducts::jobFor($appointment);
            if ($job) {
                if ($lock) $job = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
                $orders = $job->orders()->when($lock, fn ($query) => $query->lockForUpdate())->get();
                $workClosed = in_array($job->state, ['cancelled', 'declined'], true)
                    || ($orders->contains(fn ($order) => $order->lifecycle_status === 'completed')
                        && ! in_array($job->state, ['draft', 'awaiting_consultation', 'needs_information', 'follow_up', 'ready_for_quote'], true));
                if (! $workClosed || $orders->contains(fn ($order) => ! in_array($order->lifecycle_status, ['completed', 'cancelled', 'rejected'], true))) {
                    $reason ??= 'Finish or close the custom work first.';
                }
                if ($job->quotes()->where(fn ($query) => $query->where('state', 'closing')
                    ->orWhere(fn ($query) => $query->where('state', 'sent')->where('expires_at', '>', now())))->exists()) {
                    $reason ??= 'Resolve the open quotation first.';
                }
                foreach ($orders as $order) {
                    $reason ??= self::financialReason($order, $times, $lock);
                    $times->push($order->completed_at, $order->cancelled_at, $order->rejected_at, $order->cancel_decided_at);
                }
                $closingAction = $job->state === 'declined' ? 'outcome' : 'cancelled';
                if (in_array($job->state, ['cancelled', 'declined'], true)) {
                    $times->push(DB::table('appointment_product_events')->where('job_id', $job->id)->where('action', $closingAction)->max('created_at'));
                }
            } elseif ($status !== 'Completed') {
                $reason ??= 'Confirm the consultation first.';
            }
        }
        $closed = $reason === null;
        $closedAt = $closed ? $times->filter()->map(fn ($time) => Carbon::parse($time))->sortByDesc(fn ($time) => $time->getTimestamp())->first() : null;

        return [
            'list_group' => $closed ? 'closed' : 'active',
            'work_closed_at' => $closedAt?->toIso8601String(),
            'can_archive' => $closed && $appointment->status !== 'Archived',
            'archive_blocked_reason' => $appointment->status === 'Archived' ? 'Already archived.' : $reason,
            'can_confirm_consultation' => ! $job && ! $appointment->getAttribute('product_job_id')
                && ! in_array($appointment->status, ['Completed', 'Cancelled', 'Archived'], true),
        ];
    }

    private static function financialReason(Order $order, $times, bool $lock): ?string
    {
        if ($order->hasPendingCancellation() || $order->collection_hold || $order->appointment_production_status === 'payment_review') {
            return 'Resolve the payment or cancellation first.';
        }
        $returns = $order->historyReturns()->when($lock, fn ($query) => $query->lockForUpdate())->get();
        if ($returns->contains(fn ($return) => ! in_array($return->status, OrderReturn::TERMINAL_STATUSES, true))) {
            return 'Resolve the return or refund first.';
        }
        foreach ($returns as $return) $times->push($return->refunded_at ?? $return->decided_at);
        $payment = $order->payment()->when($lock, fn ($query) => $query->lockForUpdate())->first();
        $order->setRelation('payment', $payment);
        if ($order->cancel_refund_due) return 'Confirm the refund first.';
        if (! $payment) return $order->lifecycle_status === 'completed' ? 'Confirm the payment first.' : null;
        $refunds = DB::table('payment_refunds')->where('payment_id', $payment->id)->when($lock, fn ($query) => $query->lockForUpdate())->get();
        if ($refunds->isNotEmpty() && OnlineRefundArchive::blockedReason($refunds, $order->cancel_state)) {
            return 'Resolve the refund first.';
        }
        $cancelled = in_array($order->lifecycle_status, ['cancelled', 'rejected'], true);
        if ($cancelled && (AppointmentProducts::moneyHeld($order) > 0 || $payment->status === 'paid')) return 'Confirm the refund first.';
        if (! $cancelled && ! in_array($payment->status, ['paid', 'refunded'], true)) return 'Confirm the payment first.';
        $attempts = DB::table('payment_attempts')->where('payment_id', $payment->id)->when($lock, fn ($query) => $query->lockForUpdate())->get();
        if ($attempts->contains(fn ($attempt) =>
            ($attempt->exception && ! ($payment->status === 'refunded' && in_array($attempt->exception, ['late_payment_refund_review', 'duplicate_payment_review'], true)))
            || ($cancelled && ! $attempt->confirmed_at && in_array($attempt->status, ['creating', 'pending', 'unknown'], true)))) {
            return 'Resolve the payment review first.';
        }
        $times->push($payment->refunded_at);
        foreach ($refunds->where('status', 'succeeded') as $refund) $times->push($refund->confirmed_at);
        if ($payment->method === 'Cash at FMRC') {
            $times->push(DB::table('appointment_cash_entries')->where('payment_id', $payment->id)->where('kind', '!=', 'receipt')->max('confirmed_at'));
        }

        return null;
    }
}
