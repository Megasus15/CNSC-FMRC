<?php

namespace App\Support;

use App\Models\{Order, OrderReturn, Payment};
use App\Services\{GatewayPayments, PayMongoService};
use Illuminate\Support\Facades\DB;

/** One policy for new refunds, their authorization, and replacement attempts. */
final class OrderRefundEligibility
{
    public static function remaining(Payment $payment, string $receipt, ?int $exclude = null): int
    {
        $received = (int) DB::table('payment_receipts')->where('payment_id', $payment->id)->where('provider_payment_id', $receipt)->value('amount_centavos');
        $reserved = DB::table('payment_refunds')->where('payment_id', $payment->id)->where('provider_payment_id', $receipt)
            ->whereNotIn('status', ['failed', 'rejected'])->when($exclude, fn ($q) => $q->where('id', '!=', $exclude))->sum('amount_centavos');
        return max(0, $received - (int) $reserved);
    }

    public static function kind(Order $order, Payment $payment, string $receipt, ?int $returnId): string
    {
        if ($returnId) return 'return';
        if (in_array($order->lifecycle_status, ['cancelled', 'rejected'], true)) return 'closed_order';
        return $payment->paymongo_payment_id && $receipt !== $payment->paymongo_payment_id ? 'extra_payment' : 'order_payment';
    }

    public static function reason(Order $order, Payment $payment, string $receiptId, int $amount, ?int $returnId = null, ?int $exclude = null): ?string
    {
        if ($order->is_archived) return 'Restore the order before requesting or authorizing a refund.';
        if ($order->hasPendingCancellation()) return 'Decide the cancellation before requesting or authorizing a refund.';
        $receipt = DB::table('payment_receipts')->where('payment_id', $payment->id)->where('provider_payment_id', $receiptId)->whereNotNull('confirmed_at')->first();
        $attempt = $receipt ? DB::table('payment_attempts')->find($receipt->attempt_id) : null;
        if (!GatewayPayments::managed($payment) || !$receipt || !$attempt?->confirmed_at || (bool) $attempt->livemode !== app(PayMongoService::class)->isLive()
            || !in_array($payment->status, ['paid', 'refunded'], true)) return 'A verified online payment in the current provider environment is required.';
        if ($amount < 100 || $amount > self::remaining($payment, $receiptId, $exclude)) return 'The refund exceeds the remaining refundable amount.';
        if ($returnId) {
            $return = OrderReturn::whereKey($returnId)->where('order_id', $order->id)->first();
            if (!$return || $return->resolution !== 'refund' || !in_array($return->status, ['item_received', 'refund_processing'], true)
                || $order->customer_stage !== 'completed') return 'Use an approved return with the item received and inspected before refunding a completed order.';
            $reserved = DB::table('payment_refunds')->where('order_return_id', $returnId)->whereNotIn('status', ['failed', 'rejected'])
                ->when($exclude, fn ($q) => $q->where('id', '!=', $exclude))->sum('amount_centavos');
            if ($amount + $reserved > GatewayPayments::centavos($return->approved_amount ?? $return->requested_amount)) return 'This exceeds the approved return amount.';
            return null;
        }
        if (in_array($order->lifecycle_status, ['cancelled', 'rejected'], true)) return null;
        // A second verified receipt is distinct from refunding the valid order payment.
        $primary = $payment->paymongo_payment_id;
        if ($primary && $receiptId !== $primary) {
            $primaryReceipt = DB::table('payment_receipts')->where('payment_id', $payment->id)->where('provider_payment_id', $primary)->whereNotNull('confirmed_at')->first();
            $primaryAttempt = $primaryReceipt ? DB::table('payment_attempts')->find($primaryReceipt->attempt_id) : null;
            $covered = in_array($order->lifecycle_status, ['incoming', 'pending'], true)
                ? self::remaining($payment, $primary) : (int) ($primaryReceipt->amount_centavos ?? 0);
            if ($primaryAttempt?->confirmed_at && (bool) $primaryAttempt->livemode === app(PayMongoService::class)->isLive()
                && $covered >= GatewayPayments::centavos($order->total)) return null;
        }
        return $order->customer_stage === 'completed'
            ? 'Use Returns & Refunds for a completed order. Approve and inspect the return first.'
            : 'Resolve this order through cancellation or rejection before refunding its valid payment.';
    }

    public static function action(Order $order, Payment $payment, string $receipt, int $amount, ?int $returnId, string $role, ?int $exclude = null): array
    {
        $kind = self::kind($order, $payment, $receipt, $returnId);
        $reason = self::reason($order, $payment, $receipt, $amount, $returnId, $exclude);
        if (!$reason && $kind === 'extra_payment' && $role !== 'admin') $reason = 'Only Admin can return a verified extra payment.';
        return ['allowed' => $reason === null, 'reason' => $reason, 'kind' => $kind,
            'label' => $kind === 'extra_payment' ? 'Return extra payment' : ($role === 'admin' ? 'Issue refund' : 'Request refund')];
    }
}
