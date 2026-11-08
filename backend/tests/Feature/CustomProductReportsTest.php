<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\AppointmentProductJob;
use App\Models\AppointmentProductQuote;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Service;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomProductReportsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $customer;
    private Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-20 08:00:00', 'Asia/Manila')->utc());
        config(['appointment_products.enabled' => true]);
        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->service = Service::create(['title' => '3D Printing', 'category' => 'Prototyping', 'accepts_appointment_products' => true]);
        Sanctum::actingAs($this->admin);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function job(string $created = '2026-10-10 01:00:00'): AppointmentProductJob
    {
        $a = Appointment::create(['reference_no' => 'AP-'.Str::random(8), 'first_name' => 'Maria', 'last_name' => 'Santos',
            'purpose' => '3D Printing', 'appointment_date' => '2026-10-10', 'appointment_time' => '9:00 - 10:00 AM',
            'appointment_starts_at' => $created, 'status' => 'Completed', 'created_at' => $created]);
        DB::table('appointments')->where('id', $a->id)->update(['created_at' => $created, 'updated_at' => $created]);
        $job = AppointmentProductJob::create(['customer_id' => $this->customer->id, 'appointment_id' => $a->id,
            'service_id' => $this->service->id, 'service_name' => $this->service->title, 'request_key' => (string) Str::uuid(),
            'state' => 'quoted', 'requirements' => ['name' => 'Desk sign', 'quantity' => 2], 'created_at' => $created]);
        $a->forceFill(['product_job_id' => $job->id])->save();

        return $job;
    }

    private function quote(AppointmentProductJob $job, int $version, string $sent): AppointmentProductQuote
    {
        return AppointmentProductQuote::create(['job_id' => $job->id, 'version' => $version, 'state' => 'sent',
            'request_key' => (string) Str::uuid(), 'agreement' => [], 'total_centavos' => 11000,
            'sent_at' => $sent, 'expires_at' => '2027-01-01 00:00:00', 'created_by' => $this->admin->id]);
    }

    private function order(AppointmentProductJob $job, string $method = 'GCash', array $extra = []): Order
    {
        $order = Order::create($extra + ['appointment_product_job_id' => $job->id, 'order_no' => 'ORD-'.Str::random(10),
            'customer_id' => $this->customer->id, 'customer_name' => 'Maria Santos', 'customer_contact' => '09171234567',
            'quantity' => 2, 'subtotal' => 100, 'shipping_fee' => 10, 'total' => 110, 'payment_method' => $method,
            'fulfillment_type' => 'delivery', 'lifecycle_status' => 'pending', 'customer_stage' => 'to_receive',
            'appointment_production_status' => 'ready', 'created_at' => '2026-10-11 01:00:00']);
        Payment::create(['order_id' => $order->id, 'payment_no' => 'PAY-'.Str::random(10), 'method' => $method,
            'gateway' => $method === 'GCash' ? 'paymongo' : null, 'amount' => 110, 'status' => 'paid']);
        DB::table('orders')->where('id', $order->id)->update(['created_at' => $extra['created_at'] ?? '2026-10-11 01:00:00']);

        return $order;
    }

    private function receipt(Order $order, int $cents, string $at, bool $live = true): void
    {
        $payment = $order->payment;
        $provider = 'pay_'.Str::random(12);
        $attempt = DB::table('payment_attempts')->insertGetId(['payment_id' => $payment->id, 'token' => (string) Str::uuid(),
            'provider_payment_id' => $provider, 'livemode' => $live, 'amount_centavos' => $cents, 'status' => 'paid']);
        DB::table('payment_receipts')->insert(['payment_id' => $payment->id, 'attempt_id' => $attempt,
            'provider_payment_id' => $provider, 'source_type' => 'qrph', 'amount_centavos' => $cents, 'livemode' => $live, 'confirmed_at' => $at]);
    }

    private function refund(Order $order, int $cents, string $at, string $status = 'succeeded'): void
    {
        DB::table('payment_refunds')->insert(['payment_id' => $order->payment->id, 'token' => (string) Str::uuid(),
            'provider_payment_id' => DB::table('payment_receipts')->where('payment_id', $order->payment->id)->value('provider_payment_id') ?? 'pay_fixture', 'requested_by' => $this->admin->id, 'approved_by' => $this->admin->id,
            'provider_refund_id' => 're_'.Str::random(12), 'amount_centavos' => $cents, 'reason' => 'Approved return',
            'livemode' => true, 'status' => $status, 'confirmed_at' => $at]);
    }

    private function report(array $params = []): array
    {
        return $this->getJson('/api/admin/reports?'.http_build_query($params + ['category' => 'custom_products',
            'period' => 'monthly', 'year' => 2026, 'month' => 11]))->assertOk()->json('data');
    }

    public function test_empty_reports_and_generation_use_existing_permissions_and_audit(): void
    {
        foreach (['admin', 'staff'] as $role) {
            Sanctum::actingAs($role === 'admin' ? $this->admin : User::factory()->create(['role' => 'staff']));
            foreach (['monthly', 'quarterly', 'yearly'] as $period) {
                $report = $this->report(['period' => $period, 'quarter' => 4]);
                $this->assertSame([], $report['table']['rows']);
                $this->assertCount(2, $report['additional_tables']);
                $this->assertSame('period_activity', $report['report']['scope']);
            }
        }
        Sanctum::actingAs($this->admin);
        $params = ['category' => 'custom_products', 'period' => 'monthly', 'year' => 2026, 'month' => 11, 'generation_key' => (string) Str::uuid()];
        $first = $this->postJson('/api/admin/reports/generate', $params)->assertOk()->json('data.report.id');
        $this->assertStringStartsWith('CUP-', $first);
        $this->postJson('/api/admin/reports/generate', $params)->assertOk()->assertJsonPath('data.report.id', $first);
        $this->assertDatabaseCount('report_generations', 1);
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/admin/reports?'.http_build_query($params))->assertForbidden();
    }

    public function test_old_requests_quotes_and_current_fulfillment_are_included_without_counting_quoted_or_pending_money(): void
    {
        $job = $this->job();
        $this->quote($job, 1, '2026-10-10 02:00:00');
        $latest = $this->quote($job, 2, '2026-11-02 02:00:00');
        $order = $this->order($job, 'GCash', ['appointment_product_quote_id' => $latest->id, 'approved_at' => '2026-11-03 02:00:00',
            'completed_at' => '2026-11-05 02:00:00', 'customer_stage' => 'completed', 'lifecycle_status' => 'completed']);
        $this->order($job, 'Cash at FMRC', ['fulfillment_type' => 'pickup']);
        $draft = AppointmentProductJob::create(['customer_id' => $this->customer->id, 'service_id' => $this->service->id,
            'service_name' => '3D Printing', 'request_key' => (string) Str::uuid(), 'requirements' => [], 'state' => 'draft']);
        DB::table('appointment_product_events')->insert(['job_id' => $draft->id, 'action' => 'requirements', 'description' => 'Unbooked draft', 'created_at' => '2026-11-04 00:00:00']);
        $report = $this->report();
        $metrics = collect($report['metrics'])->pluck('value', 'key');
        $this->assertCount(1, $report['table']['rows']);
        $this->assertSame('v2 · Sent', $report['table']['rows'][0]['quotation']);
        $this->assertEquals(110, $report['table']['rows'][0]['quotation_total']);
        $this->assertEquals(1, $metrics['quotations_sent']);
        $this->assertEquals(1, $metrics['production_started']);
        $this->assertEquals(1, $metrics['completed_orders']);
        $this->assertEquals(0, $metrics['net_collections']);
        $this->assertCount(2, $report['additional_tables'][0]['rows']);
        $this->assertSame([], $report['additional_tables'][1]['rows']);
        $this->assertSame('completed', $order->fresh()->customer_stage);
        $this->assertSame('paid', $order->payment->fresh()->status);
        $latest->update(['state' => 'accepted']);
        $this->assertSame('v2 · Accepted', $this->report()['table']['rows'][0]['quotation']);
    }

    public function test_confirmed_ledger_entries_use_half_open_philippine_dates_and_exclude_test_pending_and_archived_money(): void
    {
        $job = $this->job();
        $order = $this->order($job);
        $this->receipt($order, 10000, '2026-10-31 15:59:59');
        $this->receipt($order, 11000, '2026-10-31 16:00:00');
        $this->receipt($order, 90000, '2026-11-30 16:00:00');
        $this->receipt($order, 80000, '2026-11-04 00:00:00', false);
        $this->refund($order, 1500, '2026-11-06 00:00:00');
        $this->refund($order, 2000, '2026-11-07 00:00:00', 'processing');
        $archived = $this->order($this->job(), 'GCash', ['is_archived' => true]);
        $this->receipt($archived, 99999, '2026-11-08 00:00:00');
        $report = $this->report();
        $metrics = collect($report['metrics'])->pluck('value', 'key');
        $this->assertCount(1, $report['table']['rows']);
        $this->assertEquals(110, $metrics['online_collections']);
        $this->assertEquals(15, $metrics['refunds']);
        $this->assertEquals(95, $metrics['net_collections']);
        $this->assertCount(2, $report['additional_tables'][1]['rows']);
        $this->assertSame(['QR Ph'], array_values(array_unique(array_column($report['additional_tables'][1]['rows'], 'method'))));
        $this->assertSame('QR Ph · Paid', $report['additional_tables'][0]['rows'][0]['payment']);
        $this->assertEquals(95, array_sum(array_column($report['additional_tables'][1]['rows'], 'amount')));
        $this->assertStringContainsString('2026-11-01T00:00:00+08:00', json_encode($report));
    }

    public function test_cash_reversals_and_refunds_are_distinct_and_never_multiplied_by_quote_versions(): void
    {
        $job = $this->job();
        $this->quote($job, 1, '2026-10-10 02:00:00');
        $this->quote($job, 2, '2026-10-11 02:00:00');
        $order = $this->order($job, 'Cash at FMRC', ['fulfillment_type' => 'pickup', 'lifecycle_status' => 'cancelled', 'customer_stage' => 'cancelled']);
        DB::table('payment_attempts')->insert(['payment_id' => $order->payment->id, 'token' => (string) Str::uuid(),
            'livemode' => true, 'checkout_method' => 'qrph', 'amount_centavos' => 11000, 'status' => 'expired']);
        foreach (['receipt' => 5000, 'reversal' => 1000, 'refund' => 500] as $kind => $amount) {
            DB::table('appointment_cash_entries')->insert(['payment_id' => $order->payment->id, 'kind' => $kind,
                'amount_centavos' => $amount, 'receipt_reference' => 'CASH-'.$kind, 'request_key' => (string) Str::uuid(),
                'actor_id' => $this->admin->id, 'confirmed_at' => '2026-11-10 00:00:00', 'created_at' => '2026-11-10 00:00:00']);
        }
        $report = $this->report();
        $metrics = collect($report['metrics'])->pluck('value', 'key');
        $this->assertCount(1, $report['table']['rows']);
        $this->assertEquals(40, $metrics['cash_collections']);
        $this->assertEquals(5, $metrics['refunds']);
        $this->assertEquals(35, $metrics['net_collections']);
        $this->assertCount(3, $report['additional_tables'][1]['rows']);
        $this->assertSame('Cancelled', $report['additional_tables'][0]['rows'][0]['stage']);
        $this->assertSame('Cash at FMRC · Paid', $report['additional_tables'][0]['rows'][0]['payment']);
    }

    public function test_old_requests_are_selected_by_consultation_or_courier_activity_without_mutating_orders(): void
    {
        $untouched = $this->job();
        $untouched->touch(); // A generic updated_at change is not a workflow event.
        $consultation = $this->job();
        $consultation->appointment->update(['appointment_starts_at' => '2026-11-12 01:00:00']);
        $delivery = $this->job();
        $order = $this->order($delivery);
        \App\Models\OrderTrackingEvent::create(['order_id' => $order->id, 'stage' => 'to_receive', 'event_type' => 'courier_update',
            'title' => 'In transit', 'description' => 'Parcel departed the J&T branch.', 'occurred_at' => '2026-11-14 01:00:00']);
        $report = $this->report();
        $this->assertCount(2, $report['table']['rows']);
        $this->assertStringNotContainsString($untouched->appointment->reference_no, json_encode($report));
        $this->assertStringContainsString($consultation->appointment->reference_no, json_encode($report));
        $this->assertStringContainsString($delivery->appointment->reference_no, json_encode($report));
        $this->assertSame('to_receive', $order->fresh()->customer_stage);
        $this->assertSame('paid', $order->payment->fresh()->status);
        $this->assertEquals(0, collect($report['metrics'])->firstWhere('key', 'net_collections')['value']);
    }
}
