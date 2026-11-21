<?php

namespace App\Console\Commands;

use App\Mail\PaymentReceipt;
use App\Models\Order;
use App\Models\OrderPaymentReceipt;
use App\Models\User;
use App\Services\OrderPaymentReceipts;
use App\Services\PaymentReceiptPdf;
use App\Support\EmailContacts;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

final class ProcessPaymentReceipts extends Command
{
    protected $signature = 'payment-receipts:process {--test-to= : Send a sample receipt to a designated test inbox}';

    protected $description = 'Generate and deliver queued FMRC payment receipt PDFs';

    public function handle(PaymentReceiptPdf $pdf): int
    {
        if (($testEmail = $this->option('test-to')) !== null) {
            return $this->sendTestReceipt($pdf, $testEmail);
        }

        if (! config('order_receipts.enabled') || ! OrderPaymentReceipts::installed()) {
            return self::SUCCESS;
        }

        $lock = Cache::lock('payment-receipts:process', 300);
        if (! $lock->get()) {
            return self::SUCCESS;
        }

        try {
            // A crash after handing the message to SMTP has an unknown outcome.
            // Retain its PDF and leave that send for review rather than repeat it.
            OrderPaymentReceipt::where('delivery_state', 'sending')
                ->where('updated_at', '<', now()->subMinutes(5))
                ->update(['delivery_state' => 'needs_review']);

            $deadline = microtime(true) + 12;
            $pending = OrderPaymentReceipt::whereNull('voided_at')
                ->where('delivery_state', 'pending')
                ->where(fn ($query) => $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))
                ->oldest('id')->limit(10)->get();

            foreach ($pending as $receipt) {
                if (microtime(true) >= $deadline) {
                    break;
                }
                $this->process($receipt, $pdf);
            }
        } finally {
            $lock->release();
        }

        return self::SUCCESS;
    }

    private function process(OrderPaymentReceipt $receipt, PaymentReceiptPdf $pdf): void
    {
        $submitted = false;
        try {
            if ($receipt->snapshot['test_payment'] && app()->isProduction()) {
                $receipt->update(['delivery_state' => 'skipped']);

                return;
            }

            $disk = Storage::disk('local');
            if (! $receipt->pdf_ready_at || ! $disk->exists($receipt->pdfPath())) {
                $contents = $pdf->render($receipt);
                if (! str_starts_with($contents, '%PDF-') || ! $disk->put($receipt->pdfPath(), $contents)) {
                    throw new RuntimeException('The receipt PDF could not be saved.');
                }
                $receipt->update(['pdf_ready_at' => now()]);
            }

            $email = $this->recipient($receipt);
            if (! $email) {
                $receipt->update(['delivery_state' => 'skipped']);

                return;
            }

            $claimed = OrderPaymentReceipt::whereKey($receipt->id)->whereNull('voided_at')
                ->where('delivery_state', 'pending')->update(['delivery_state' => 'sending']);
            if (! $claimed) {
                return;
            }

            $receipt->refresh();
            if ($receipt->voided_at) {
                return;
            }

            $this->send($email, new PaymentReceipt($receipt));
            $submitted = true;
            $receipt->update(['delivery_state' => 'sent', 'sent_at' => now(), 'next_attempt_at' => null]);
        } catch (Throwable $error) {
            if (! $submitted) {
                $attempts = $receipt->attempts + 1;
                $receipt->update([
                    'attempts' => $attempts,
                    'delivery_state' => $attempts >= 5 ? 'failed' : 'pending',
                    'next_attempt_at' => $attempts >= 5 ? null : now()->addMinutes(2 ** $attempts),
                ]);
            }
            Log::warning('Payment receipt processing failed.', [
                'receipt_id' => $receipt->id,
                'error' => $error::class,
                'source' => basename($error->getFile()).':'.$error->getLine(),
            ]);
        }
    }

    private function recipient(OrderPaymentReceipt $receipt): ?string
    {
        if (! Order::whereKey($receipt->order_id)->where('customer_id', $receipt->customer_id)->exists()) {
            return null;
        }

        $email = User::whereKey($receipt->customer_id)->where('role', 'customer')->value('email');

        return filter_var($email, FILTER_VALIDATE_EMAIL) ?: null;
    }

    private function send(string $email, PaymentReceipt $mail): void
    {
        $transport = config('mail.mailers.'.config('mail.default').'.transport');
        if (app()->isProduction() && ! in_array($transport, ['smtp', 'sendmail', 'ses', 'ses-v2', 'postmark', 'resend'], true)) {
            throw new RuntimeException('A delivering mail transport is required for receipts.');
        }

        if (! Mail::to($email)->send($mail)) {
            throw new RuntimeException('The mail transport did not accept the receipt.');
        }
    }

    private function sendTestReceipt(PaymentReceiptPdf $pdf, string $email): int
    {
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Enter a valid address for the designated test inbox.');

            return self::FAILURE;
        }

        $contacts = EmailContacts::resolve();
        $sample = (new OrderPaymentReceipt)->forceFill(['id' => 0, 'snapshot' => [
            'order_number' => 'ORD-TEST-000123',
            'customer_name' => 'FMRC Test Customer',
            'paid_on' => now('Asia/Manila')->format('M j, Y, g:i A').' PHT',
            'method' => 'QR Ph',
            'reference' => 'DEMO-PAYMENT',
            'quote' => null,
            'lines' => [['name' => 'Laser-engraved bamboo tumbler', 'quantity' => 2, 'unit_centavos' => 37500, 'total_centavos' => 75000]],
            'subtotal_centavos' => 75000,
            'shipping_centavos' => 0,
            'amount_centavos' => 75000,
            'website' => $contacts['website_url'],
            'phone' => $contacts['phone'],
            'test_payment' => true,
        ]]);

        try {
            $this->send($email, new PaymentReceipt($sample, $pdf->render($sample)));
            $this->info('The mail transport accepted the sample. Confirm the PDF opens from the test inbox.');

            return self::SUCCESS;
        } catch (Throwable $error) {
            Log::warning('Test payment receipt could not be sent.', [
                'error' => $error::class,
                'source' => basename($error->getFile()).':'.$error->getLine(),
            ]);
            $this->error('The sample receipt could not be sent. Check the protected application log and mail settings.');

            return self::FAILURE;
        }
    }
}
