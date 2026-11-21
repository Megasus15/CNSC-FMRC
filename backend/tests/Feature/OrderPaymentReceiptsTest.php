<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderPaymentReceipt;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\TestCase;

class OrderPaymentReceiptsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::set('local', Storage::build([
            'driver' => 'local',
            'root' => storage_path('framework/testing/receipts-'.Str::random(12)),
        ]));
        config(['order_receipts.enabled' => true, 'mail.default' => 'array', 'mail.from.address' => 'receipts@example.test']);
    }

    public function test_the_email_and_owner_download_use_the_same_saved_pdf(): void
    {
        $order = $this->order();
        $download = $this->orderUrl($order).'/payment-receipt';
        $this->getJson($download)->assertUnauthorized();

        Sanctum::actingAs($order->customer);
        $this->getJson($this->orderUrl($order))->assertOk()->assertJsonPath('data.payment_receipt', null);
        $this->getJson($download)->assertNotFound();

        $this->asStaff();
        $this->getJson($download)->assertForbidden();
        $this->confirm($order)->assertOk();
        $this->confirm($order)->assertUnprocessable();
        $receipt = OrderPaymentReceipt::sole();
        $this->assertSame(100000, $receipt->snapshot['amount_centavos']);
        $this->assertSame('Cash on pickup', $receipt->snapshot['method']);
        $this->assertSame($order->payment->payment_no, $receipt->snapshot['reference']);
        $transport = Mail::mailer('array')->getSymfonyTransport();
        $this->assertCount(0, $transport->messages());

        Sanctum::actingAs($order->customer);
        $preparing = $this->getJson($this->orderUrl($order))->assertOk()->assertJsonPath('data.payment_receipt.state', 'preparing');
        $this->getJson($download)->assertServiceUnavailable();
        $order->items()->update(['product_name' => 'Renamed after payment', 'unit_price' => 12]);
        $this->artisan('payment-receipts:process')->assertSuccessful();
        $this->artisan('payment-receipts:process')->assertSuccessful();

        $receipt->refresh();
        $this->assertSame('sent', $receipt->delivery_state);
        $this->assertSame('Catalog item', $receipt->snapshot['lines'][0]['name']);
        $this->assertSame(50000, $receipt->snapshot['lines'][0]['unit_centavos']);
        $pdf = Storage::disk('local')->get($receipt->pdfPath());
        $this->assertStringStartsWith('%PDF-', $pdf);
        $this->assertCount(1, $transport->messages());
        $email = $transport->messages()->sole()->getOriginalMessage();
        $this->assertSame('Payment confirmed — '.$order->order_no, $email->getSubject());
        $this->assertSame('UCN-FMRC', $email->getFrom()[0]->getName());
        $this->assertSame($order->customer->email, $email->getTo()[0]->getAddress());
        $this->assertStringContainsString('Amount paid', $email->getHtmlBody());
        $this->assertStringContainsString($receipt->number(), $email->getHtmlBody());
        $this->assertStringContainsString('Official website', $email->getHtmlBody());
        $this->assertCount(1, $email->getAttachments());
        $this->assertSame($receipt->filename(), $email->getAttachments()[0]->getFilename());
        $this->assertSame($pdf, $email->getAttachments()[0]->getBody());

        $this->getJson($this->orderUrl($order), ['If-None-Match' => $preparing->headers->get('ETag')])
            ->assertOk()->assertJsonPath('data.payment_receipt', ['number' => $receipt->number(), 'state' => 'ready']);
        $response = $this->get($download)->assertOk()->assertHeader('Content-Type', 'application/pdf')->assertDownload($receipt->filename());
        $this->assertSame($pdf, $response->streamedContent());
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));

        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->getJson($download)->assertNotFound();
        Sanctum::actingAs($order->customer);
        $order->update(['customer_hidden_at' => now()]);
        $this->getJson($download)->assertGone();
    }

    public function test_a_cash_correction_voids_the_original_and_reconfirmation_gets_a_new_number(): void
    {
        $order = $this->order();
        $this->asStaff();
        $this->confirm($order)->assertOk();
        $oldReceipt = OrderPaymentReceipt::sole();

        $this->patchJson($this->operatorUrl($order), [
            'status' => 'pending', 'correction_reason' => 'The cash entry was recorded on the wrong order.',
        ])->assertOk();
        $this->assertNotNull($oldReceipt->fresh()->voided_at);
        $correction = Mail::mailer('array')->getSymfonyTransport()->messages()->sole()->getOriginalMessage();
        $this->assertStringContainsString('Payment receipt '.$oldReceipt->number().' has been voided.', $correction->getHtmlBody());

        Sanctum::actingAs($order->customer);
        $this->getJson($this->orderUrl($order).'/payment-receipt')->assertNotFound();
        $this->asStaff();
        $this->confirm($order)->assertOk();
        $this->assertDatabaseCount('order_payment_receipts', 2);
        $receipt = OrderPaymentReceipt::whereNull('voided_at')->sole();
        $this->assertNotSame($oldReceipt->number(), $receipt->number());

        $order->update(['lifecycle_status' => 'cancelled']);
        $this->patchJson($this->operatorUrl($order), ['status' => 'refunded', 'refund_reference' => 'REFUND-1'])->assertOk();
        $this->assertSame('refunded', $order->payment()->firstOrFail()->status);
        $this->assertNull($receipt->fresh()->voided_at);
        $this->assertDatabaseCount('order_payment_receipts', 2);
    }

    public function test_mail_failure_leaves_the_pdf_available_and_retry_reuses_it(): void
    {
        $order = $this->order();
        $this->asStaff();
        $this->confirm($order)->assertOk();
        $mailManager = Mail::getFacadeRoot();
        Mail::shouldReceive('to')->once()->andThrow(new RuntimeException('Temporary email failure'));
        $this->artisan('payment-receipts:process')->assertSuccessful();
        $receipt = OrderPaymentReceipt::sole();
        $this->assertNotNull($receipt->pdf_ready_at);
        $this->assertSame(1, $receipt->attempts);
        $this->assertSame('pending', $receipt->delivery_state);

        Sanctum::actingAs($order->customer);
        $this->getJson($this->orderUrl($order))->assertOk()->assertJsonPath('data.payment_receipt.state', 'ready');
        $before = $this->get($this->orderUrl($order).'/payment-receipt')->assertOk()->streamedContent();
        Mail::swap($mailManager);
        $transport = Mail::mailer('array')->getSymfonyTransport();
        $this->artisan('payment-receipts:process')->assertSuccessful();
        $this->assertCount(0, $transport->messages());
        $this->travel(3)->minutes();
        $this->artisan('payment-receipts:process')->assertSuccessful();
        $this->assertCount(1, $transport->messages());
        $this->assertSame('sent', $receipt->fresh()->delivery_state);
        $this->assertSame($before, Storage::disk('local')->get($receipt->pdfPath()));
    }

    public function test_sample_mail_can_check_the_transport_before_issuance_is_enabled(): void
    {
        config(['order_receipts.enabled' => false]);
        $this->artisan('payment-receipts:process', ['--test-to' => 'invalid'])->assertFailed();
        $this->artisan('payment-receipts:process', ['--test-to' => 'designated-test@example.test'])->assertSuccessful();

        $email = Mail::mailer('array')->getSymfonyTransport()->messages()->sole()->getOriginalMessage();
        $this->assertSame('designated-test@example.test', $email->getTo()[0]->getAddress());
        $this->assertStringStartsWith('[Test] Payment confirmed', $email->getSubject());
        $this->assertStringNotContainsString('Open My Orders', $email->getHtmlBody());
        $this->assertStringStartsWith('%PDF-', $email->getAttachments()[0]->getBody());
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('order_payment_receipts', 0);
    }

    public function test_disabled_issuance_does_not_backfill_already_confirmed_orders(): void
    {
        config(['order_receipts.enabled' => false]);
        $order = $this->order();
        $this->asStaff();
        $this->confirm($order)->assertOk();
        $this->assertCount(1, Mail::mailer('array')->getSymfonyTransport()->messages());
        config(['order_receipts.enabled' => true]);
        $this->confirm($order)->assertUnprocessable();
        $this->artisan('payment-receipts:process')->assertSuccessful();
        $this->assertDatabaseCount('order_payment_receipts', 0);
    }

    private function order(): Order
    {
        $customer = User::factory()->create(['role' => 'customer', 'name' => 'Mara Santos', 'email' => 'customer@example.test']);
        $order = Order::create([
            'order_no' => 'ORD-000123', 'customer_id' => $customer->id, 'customer_name' => $customer->name,
            'customer_contact' => 'checkout@example.test', 'quantity' => 2, 'subtotal' => 1000, 'total' => 1000,
            'payment_method' => 'COP', 'payment_reference' => 'Cash on pickup', 'fulfillment_type' => 'pickup',
            'lifecycle_status' => 'incoming', 'customer_stage' => 'to_pay',
        ]);
        $order->items()->create(['product_name' => 'Catalog item', 'quantity' => 2, 'unit_price' => 500, 'line_total' => 1000]);
        $order->payment()->create(['payment_no' => 'PAY-000123', 'method' => 'COP', 'reference' => 'Cash on pickup', 'amount' => 1000, 'status' => 'pending']);

        return $order->fresh();
    }

    private function asStaff(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
    }

    private function confirm(Order $order)
    {
        return $this->patchJson($this->operatorUrl($order), ['status' => 'paid', 'confirmed_received' => true]);
    }

    private function operatorUrl(Order $order): string
    {
        return "/api/admin/orders/{$order->id}/payment-status";
    }

    private function orderUrl(Order $order): string
    {
        return "/api/customer/orders/{$order->id}";
    }
}
