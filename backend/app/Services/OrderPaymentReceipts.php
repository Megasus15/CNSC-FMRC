<?php

namespace App\Services;

use App\Models\AppointmentProductQuote;
use App\Models\Order;
use App\Models\OrderPaymentReceipt;
use App\Models\Payment;
use App\Support\EmailContacts;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class OrderPaymentReceipts
{
    public static function installed(): bool
    {
        return Schema::hasTable('order_payment_receipts');
    }

    /**
     * Called inside the transaction that records the confirmed payment. The
     * receipt write uses a savepoint so a document error cannot undo a payment.
     */
    public function record(
        Order $order,
        Payment $payment,
        string $confirmationKey,
        int $receivedCentavos,
        ?string $method = null,
        ?string $reference = null,
        ?CarbonInterface $paidAt = null,
        bool $testPayment = false,
    ): ?OrderPaymentReceipt {
        if (! config('order_receipts.enabled') || ! $order->customer_id
            || $payment->status !== 'paid' || ! $payment->paid_at
            || $receivedCentavos <= 0 || ($testPayment && app()->isProduction())) {
            return null;
        }

        try {
            if (! self::installed()) {
                return null;
            }

            return DB::transaction(function () use ($order, $payment, $confirmationKey, $receivedCentavos, $method, $reference, $paidAt, $testPayment) {
                $snapshot = $this->snapshot($order, $payment, $receivedCentavos, $method, $reference, $paidAt, $testPayment);
                if ($snapshot === null) {
                    Log::warning('Payment receipt requires a matching order breakdown.', ['order_id' => $order->id]);

                    return null;
                }

                return OrderPaymentReceipt::firstOrCreate(['confirmation_key' => $confirmationKey], [
                    'order_id' => $order->id,
                    'customer_id' => $order->customer_id,
                    'payment_id' => $payment->id,
                    'snapshot' => $snapshot,
                ]);
            });
        } catch (Throwable $error) {
            Log::warning('Payment recorded but its receipt could not be queued.', [
                'order_id' => $order->id,
                'error' => $error::class,
            ]);

            return null;
        }
    }

    private function snapshot(
        Order $order,
        Payment $payment,
        int $receivedCentavos,
        ?string $method,
        ?string $reference,
        ?CarbonInterface $paidAt,
        bool $testPayment,
    ): ?array {
        $lines = $order->items()
            ->orderBy('id')
            ->get(['product_name', 'quantity', 'unit_price', 'line_total'])
            ->map(fn ($item) => [
                'name' => $item->product_name,
                'quantity' => (int) $item->quantity,
                'unit_centavos' => GatewayPayments::centavos($item->unit_price),
                'total_centavos' => GatewayPayments::centavos($item->line_total),
            ])->all();
        $subtotal = array_sum(array_column($lines, 'total_centavos'));
        $shipping = GatewayPayments::centavos($order->shipping_fee ?? 0);
        if ($lines === [] || $receivedCentavos !== GatewayPayments::centavos($order->total)
            || $receivedCentavos !== GatewayPayments::centavos($payment->amount)
            || $subtotal + $shipping !== $receivedCentavos) {
            return null;
        }

        $quoteLabel = null;
        if ($order->appointment_product_quote_id) {
            $quote = AppointmentProductQuote::with('job.appointment')->find($order->appointment_product_quote_id);
            if ($quote?->state !== 'accepted' || $quote->total_centavos !== $receivedCentavos) {
                return null;
            }
            $appointment = $quote->job?->appointment?->reference_no;
            $quoteLabel = $appointment ? "$appointment / Version $quote->version" : "Version $quote->version";
        }

        $method ??= match ($payment->method) {
            'COP' => 'Cash on pickup',
            'COD' => 'Cash on delivery',
            'Cash at FMRC' => 'Advance cash at FMRC',
            default => (string) $payment->method,
        };
        $reference ??= $payment->method === 'GCash' && ctype_digit((string) $payment->reference)
            ? $payment->reference
            : $payment->payment_no;
        $contacts = EmailContacts::resolve();

        return [
            'order_number' => $order->order_no ?: 'ORD-'.$order->id,
            'customer_name' => $order->customer_name ?: 'Customer',
            'paid_on' => ($paidAt ?? $payment->paid_at)->copy()->setTimezone('Asia/Manila')->format('M j, Y, g:i A').' PHT',
            'method' => $method,
            'reference' => $reference,
            'quote' => $quoteLabel,
            'lines' => $lines,
            'subtotal_centavos' => $subtotal,
            'delivery' => $order->fulfillment_type === 'delivery',
            'shipping_centavos' => $shipping,
            'amount_centavos' => $receivedCentavos,
            'website' => $contacts['website_url'],
            'phone' => $contacts['phone'],
            'test_payment' => $testPayment,
        ];
    }

    /** Called under the payment lock, before sending its existing correction email. */
    public function void(Payment $payment): ?string
    {
        if (! self::installed()) {
            return null;
        }

        $receipt = OrderPaymentReceipt::where('payment_id', $payment->id)
            ->whereNull('voided_at')->latest('id')->lockForUpdate()->first();
        $receipt?->update(['voided_at' => now()]);

        return $receipt?->number();
    }

    public function forOrder(Order $order): ?OrderPaymentReceipt
    {
        if (! $order->customer_id || ! self::installed()) {
            return null;
        }

        return OrderPaymentReceipt::where('order_id', $order->id)
            ->where('customer_id', $order->customer_id)
            ->whereNull('voided_at')->latest('id')->first();
    }

    public function availability(Order $order): ?array
    {
        $receipt = $this->forOrder($order);
        if (! $receipt) {
            return null;
        }

        $ready = $receipt->pdf_ready_at && Storage::disk('local')->exists($receipt->pdfPath());

        return [
            'number' => $receipt->number(),
            'state' => $ready ? 'ready' : ($receipt->delivery_state === 'failed' || $receipt->pdf_ready_at ? 'unavailable' : 'preparing'),
        ];
    }

    public static function pesos(int $centavos): string
    {
        return '₱'.number_format($centavos / 100, 2, '.', ',');
    }
}
