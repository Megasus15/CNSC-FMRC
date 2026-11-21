<?php

namespace App\Mail;

use App\Models\OrderPaymentReceipt;
use App\Services\OrderPaymentReceipts;
use App\Support\Branding;
use App\Support\EmailContacts;
use App\Support\EmailTemplate;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

final class PaymentReceipt extends Mailable
{
    public function __construct(private OrderPaymentReceipt $receipt, private ?string $samplePdf = null) {}

    public function envelope(): Envelope
    {
        $details = $this->receipt->snapshot;
        $order = str_replace(["\r", "\n"], '', $details['order_number']);
        $prefix = $details['test_payment'] ? '[Test] ' : '';

        return new Envelope(
            from: new Address(config('mail.from.address'), Branding::mailFromName()),
            subject: $prefix.'Payment confirmed — '.$order,
        );
    }

    public function headers(): Headers
    {
        return new Headers(messageId: $this->receipt->exists ? strtolower($this->receipt->number()).'@ucn-fabmanlab.com' : null);
    }

    public function content(): Content
    {
        $details = $this->receipt->snapshot;
        $amount = OrderPaymentReceipts::pesos($details['amount_centavos']);
        $frontend = rtrim((string) config('app.frontend_url'), '/');
        $base = EmailContacts::https($frontend) ? $frontend : 'https://ucn-fabmanlab.com';
        $summary = view('receipts.email-summary', [
            'number' => $this->receipt->number(),
            'orderNumber' => $details['order_number'],
            'amount' => $amount,
            'method' => $details['method'],
            'paidOn' => $details['paid_on'],
            'orderUrl' => $this->receipt->exists ? $base.'/home-page/?orders=1&order_id='.$this->receipt->order_id : null,
            'isSample' => $this->samplePdf !== null,
        ])->render();

        return new Content(htmlString: EmailTemplate::render('payment_confirmed', [
            'customer_name' => $details['customer_name'],
            'order_number' => $details['order_number'],
            'amount' => $amount,
            'status' => 'Payment confirmed',
        ], $summary));
    }

    public function attachments(): array
    {
        $attachment = $this->samplePdf === null
            ? Attachment::fromStorageDisk('local', $this->receipt->pdfPath())
            : Attachment::fromData(fn () => $this->samplePdf, $this->receipt->filename());

        return [$attachment->as($this->receipt->filename())->withMime('application/pdf')];
    }
}
