<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\AppointmentProductJob;
use App\Models\AppointmentProductQuote;
use App\Models\Order;
use App\Models\Product;
use App\Models\Service;
use App\Models\User;
use App\Services\CommercePolicy;
use App\Services\GatewayPayments;
use App\Support\AppointmentProductMetrics;
use App\Support\FinancialMetrics;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OptionalAppointmentProductsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private User $staff;

    private User $admin;

    private Service $service;

    private array $policy;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-06 08:00:00', 'Asia/Manila')->utc());
        Mail::fake();
        Storage::fake('local');
        config(['appointment_products.enabled' => true, 'services.turnstile.enabled' => false]);
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->staff = User::factory()->create(['role' => 'staff']);
        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->service = Service::create(['title' => '3D Printing', 'category' => 'Prototyping', 'accepts_appointment_products' => true]);
        Sanctum::actingAs($this->admin);
        $rev = DB::table('commerce_policy_settings')->value('revision');
        $this->putJson('/api/admin/commerce-policy/draft', CommercePolicy::draft() + ['expected_revision' => $rev])->assertOk();
        $this->policy = $this->postJson('/api/admin/commerce-policy/publish', ['expected_revision' => $rev + 1, 'approved' => true])->assertOk()->json('data.published');
        Sanctum::actingAs($this->customer);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function brief(): array
    {
        return ['service_id' => $this->service->id, 'name' => 'Desk sign', 'description' => 'One agreed desk sign design', 'quantity' => 5, 'dimensions' => '20 x 8 cm', 'material' => 'PLA', 'colors' => 'Maroon', 'finish' => 'Matte'];
    }

    private function booking(array $extra = []): array
    {
        return $extra + ['first_name' => 'Maria', 'last_name' => 'Santos', 'contact_number' => '09171234567', 'email' => 'maria@gmail.com', 'country' => 'Philippines', 'full_address' => 'Daet', 'client_type' => 'Student', 'purpose' => '3D Printing', 'appointment_date' => '2026-11-09', 'appointment_time' => '9:00 - 10:00 AM', 'appointment_method' => 'face_to_face', 'product_requested' => true, 'product_data' => $this->brief(), 'request_key' => (string) Str::uuid()];
    }

    private function booked(): AppointmentProductJob
    {
        Sanctum::actingAs($this->customer);
        $result = $this->postJson('/api/appointments', $this->booking())->assertCreated();

        return AppointmentProductJob::findOrFail($result->json('data.custom_product.id'));
    }

    private function quote(AppointmentProductJob $job, array $extra = []): AppointmentProductQuote
    {
        Carbon::setTestNow(Carbon::parse('2026-11-09 12:00:00', 'Asia/Manila')->utc());
        Sanctum::actingAs($this->staff);
        $this->patchJson('/api/appointments/'.$job->appointment_id.'/complete')->assertOk();
        $this->postJson('/api/admin/appointment-products/'.$job->id.'/outcome', ['outcome' => 'ready_for_quote', 'note' => 'Specifications discussed and confirmed.', 'discussion_confirmed' => true, 'expected_revision' => $job->revision])->assertOk();
        $job->refresh();
        $this->postJson('/api/admin/appointment-products/'.$job->id.'/quotations', $extra + ['request_key' => (string) Str::uuid(), 'expected_revision' => $job->revision,
            'specifications' => $this->brief(), 'unit_price' => 200, 'shipping_fee' => 0, 'fulfillment_type' => 'pickup', 'lead_time' => 'Five working days after full payment', 'design_notes' => 'Approved desk sign layout.'])->assertOk();

        return $job->quotes()->firstOrFail();
    }

    private function accept(AppointmentProductJob $job, AppointmentProductQuote $quote, string $method = 'cash'): Order
    {
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/appointment-products/'.$job->id.'/quotations/'.$quote->id.'/accept',
            ['expected_revision' => $job->fresh()->revision, 'specifications_accepted' => true, 'payment_method' => $method, 'policy_accepted' => true, 'policy_version' => $this->policy['version']])->assertOk();

        return $quote->order()->firstOrFail();
    }

    private function act(Order $order, string $action, array $extra = [])
    {
        Sanctum::actingAs($this->staff);

        return $this->postJson('/api/admin/orders/'.$order->id.'/custom-product', $extra + ['action' => $action, 'expected_revision' => $order->fresh()->production_revision, 'request_key' => (string) Str::uuid()]);
    }

    public function test_optional_booking_preserves_the_meeting_and_persists_numeric_revision_and_idempotency(): void
    {
        $data = $this->booking();
        $first = $this->postJson('/api/appointments', $data)->assertCreated()->assertJsonPath('data.status', 'Scheduled')->assertJsonPath('data.custom_product.revision', 0);
        $this->postJson('/api/appointments', $data)->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertDatabaseCount('appointments', 1);
        $this->assertDatabaseCount('appointment_product_jobs', 1);
        $this->getJson('/api/appointments/'.$first->json('data.reference_no').'/verify')->assertOk()->assertJsonMissingPath('data.custom_product');
    }

    public function test_draft_create_save_and_book_uses_returned_zero_revision_and_does_not_reserve_a_slot(): void
    {
        $body = ['requirements' => $this->brief(), 'booking' => ['aptFName' => 'Maria'], 'request_key' => (string) Str::uuid()];
        $draft = $this->postJson('/api/customer/appointment-products/drafts', $body)->assertOk()->assertJsonPath('data.revision', 0)->assertJsonPath('data.state', 'draft')->json('data');
        $this->postJson('/api/customer/appointment-products/drafts', $body)->assertOk()->assertJsonPath('data.id', $draft['id']);
        $this->assertDatabaseCount('appointments', 0);
        $saved = $this->postJson('/api/customer/appointment-products/drafts', $body + ['draft_id' => $draft['id'], 'expected_revision' => $draft['revision']])->assertOk()->json('data');
        $this->postJson('/api/appointments', $this->booking(['product_draft_id' => $draft['id'], 'product_revision' => $saved['revision'], 'request_key' => $body['request_key']]))->assertCreated();
        $this->assertDatabaseCount('appointment_product_jobs', 1);
        $this->assertDatabaseCount('appointments', 1);
    }

    public function test_later_opt_in_and_private_messages_do_not_duplicate_or_expose_the_appointment(): void
    {
        $a = $this->postJson('/api/appointments', $this->booking(['product_requested' => false]))->assertCreated()->json('data');
        $path = '/api/customer/appointments/'.$a['id'].'/product';
        $body = ['requirements' => $this->brief(), 'request_key' => (string) Str::uuid()];
        $job = $this->postJson($path, $body)->assertOk()->json('data');
        $this->postJson($path, $body)->assertOk()->assertJsonPath('data.id', $job['id']);
        $msg = '/api/customer/appointment-products/'.$job['id'].'/messages';
        $key = (string) Str::uuid();
        $this->post($msg, ['body' => 'Please review my private design.', 'request_key' => $key, 'attachments' => [UploadedFile::fake()->create('desk.step', 2, 'application/octet-stream')]], ['Accept' => 'application/json'])->assertOk();
        $this->postJson($msg, ['body' => 'Please review my private design.', 'request_key' => $key])->assertOk();
        $this->assertDatabaseCount('appointment_product_messages', 1);
        $file = DB::table('appointment_product_files')->first();
        Storage::disk('local')->assertExists($file->path);
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->getJson('/api/customer/appointment-products/'.$job['id'])->assertNotFound();
        $this->getJson('/api/customer/appointment-products/'.$job['id'].'/files/'.$file->id)->assertNotFound();
        Sanctum::actingAs($this->staff);
        $this->get('/api/admin/appointment-products/'.$job['id'].'/files/'.$file->id)->assertOk();
    }

    public function test_quotation_requires_a_completed_discussion_and_rejects_stale_edits(): void
    {
        $j = $this->booked();
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/appointment-products/'.$j->id.'/outcome', ['outcome' => 'ready_for_quote', 'note' => 'Discussed', 'discussion_confirmed' => true, 'expected_revision' => 0])->assertUnprocessable();
        $this->quote($j);
        $j->refresh();
        Sanctum::actingAs($this->customer);
        $this->putJson('/api/customer/appointment-products/'.$j->id.'/requirements', ['requirements' => $this->brief(), 'expected_revision' => 0])->assertConflict();
        $this->assertSame('sent', $j->quotes()->first()->state);
    }

    public function test_both_operators_save_and_read_back_the_ready_outcome_in_the_appointment_feed(): void
    {
        foreach ([$this->admin, $this->staff] as $i => $operator) {
            Sanctum::actingAs($this->customer);
            $created = $this->postJson('/api/appointments', $this->booking(['appointment_time' => $i ? '10:00 - 11:00 AM' : '9:00 - 10:00 AM']))->assertCreated();
            $j = AppointmentProductJob::findOrFail($created->json('data.custom_product.id'));
            Carbon::setTestNow(Carbon::parse('2026-11-09 12:00:00', 'Asia/Manila')->utc());
            Sanctum::actingAs($operator);
            $this->patchJson('/api/appointments/'.$j->appointment_id.'/complete')->assertOk();
            $saved = $this->postJson('/api/admin/appointment-products/'.$j->id.'/outcome', ['outcome' => 'ready_for_quote', 'note' => 'Final specifications discussed.', 'discussion_confirmed' => true, 'discussed_appointment_id' => $j->appointment_id, 'expected_revision' => 0])
                ->assertOk()->assertJsonPath('data.state', 'ready_for_quote')->assertJsonPath('data.stage', 'Preparing quotation')->assertJsonPath('data.revision', 1)->json('data');
            $this->assertNotNull($saved['discussed_at']);
            $this->getJson('/api/admin/appointment-products/'.$j->id)->assertOk()->assertJsonPath('data.state', 'ready_for_quote')->assertJsonPath('data.revision', 1);
            $feed = $this->getJson('/api/appointments')->assertOk();
            $this->assertStringContainsString('no-store', $feed->headers->get('Cache-Control'));
            $row = collect($feed->json('data'))->firstWhere('id', $j->appointment_id);
            $this->assertSame('Completed', $row['status']);
            $this->assertSame($saved, $row['custom_product']);
            Carbon::setTestNow(Carbon::parse('2026-11-06 08:00:00', 'Asia/Manila')->utc());
        }
    }

    public function test_an_attended_meeting_completed_early_can_proceed_to_quotation_for_both_operator_roles(): void
    {
        foreach ([$this->admin, $this->staff] as $i => $operator) {
            Sanctum::actingAs($this->customer);
            $created = $this->postJson('/api/appointments', $this->booking(['appointment_time' => $i ? '10:00 - 11:00 AM' : '9:00 - 10:00 AM']))->assertCreated();
            $j = AppointmentProductJob::findOrFail($created->json('data.custom_product.id'));
            $originalSchedule = $j->appointment->appointment_starts_at;
            $this->assertTrue($originalSchedule->isFuture());
            Sanctum::actingAs($operator);
            $outcome = ['outcome' => 'ready_for_quote', 'note' => 'Consultation held early; final specifications agreed.', 'discussion_confirmed' => true, 'expected_revision' => 0];
            $path = '/api/admin/appointment-products/'.$j->id;
            $this->postJson($path.'/outcome', $outcome)->assertUnprocessable();
            $this->patchJson('/api/appointments/'.$j->appointment_id.'/complete')->assertOk();
            $this->postJson($path.'/outcome', array_replace($outcome, ['discussion_confirmed' => false]))->assertUnprocessable();
            $saved = $this->postJson($path.'/outcome', $outcome)->assertOk()->assertJsonPath('data.state', 'ready_for_quote')->assertJsonPath('data.stage', 'Preparing quotation')->json('data');
            $this->assertNotNull($saved['discussed_at']);
            $this->postJson($path.'/quotations', ['request_key' => (string) Str::uuid(), 'expected_revision' => $saved['revision'], 'specifications' => $this->brief(), 'unit_price' => 200, 'shipping_fee' => 0, 'fulfillment_type' => 'pickup', 'lead_time' => 'Five working days', 'design_notes' => 'Approved final design.'])
                ->assertOk()->assertJsonPath('data.state', 'quoted');
            $this->assertTrue($originalSchedule->equalTo($j->appointment->fresh()->appointment_starts_at));
        }
    }

    public function test_customer_deleting_a_completed_meeting_preserves_the_linked_agreement_and_order(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q);
        Sanctum::actingAs($this->customer);
        $this->deleteJson('/api/customer/appointments/'.$j->appointment_id)->assertOk();
        $this->getJson('/api/customer/appointments')->assertJsonCount(0, 'data');
        $this->getJson('/api/customer/appointments/'.$j->appointment_id)->assertOk()->assertJsonPath('data.deleted_from_list', true)->assertJsonPath('data.custom_product.id', $j->id);
        $this->assertSame('Completed', $j->appointment->fresh()->status);
        $this->assertSame('accepted', $q->fresh()->state);
        $this->assertSame($q->id, $o->fresh()->appointment_product_quote_id);
        $this->assertDatabaseCount('appointment_product_jobs', 1);
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_eligible_service_changes_keep_the_meeting_and_require_a_new_product_review(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $original = $j->appointment->toArray();
        $other = Service::create(['title' => 'Heatpress', 'category' => 'Manufacturing', 'accepts_appointment_products' => true]);
        $updated = $this->putJson('/api/admin/appointment-products/'.$j->id.'/requirements', ['requirements' => array_replace($this->brief(), ['service_id' => $other->id]), 'expected_revision' => $j->fresh()->revision])
            ->assertOk()->assertJsonPath('data.service_id', $other->id)->assertJsonPath('data.service_name', 'Heatpress')->assertJsonPath('data.discussed_at', null)->assertJsonPath('data.state', 'awaiting_consultation');
        $this->assertSame($original, $j->appointment->fresh()->toArray());
        $this->assertSame('superseded', $q->fresh()->state);
        $this->assertSame('3D Printing', $q->agreement['service']);
        $this->assertDatabaseCount('appointments', 1);
        $this->assertDatabaseCount('appointment_product_jobs', 1);
        $this->assertGreaterThan(0, $updated->json('data.revision'));
    }

    public function test_disabled_and_paid_service_changes_are_rejected_without_rewriting_history(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $other = Service::create(['title' => 'Heatpress', 'category' => 'Manufacturing', 'accepts_appointment_products' => false]);
        $payload = ['requirements' => array_replace($this->brief(), ['service_id' => $other->id]), 'expected_revision' => $j->fresh()->revision];
        $this->putJson('/api/admin/appointment-products/'.$j->id.'/requirements', $payload)->assertUnprocessable();
        $this->assertSame('sent', $q->fresh()->state);
        $o = $this->accept($j, $q);
        $this->act($o, 'cash_receipt', ['amount' => 1000, 'receipt_reference' => 'UNCHANGED-1', 'confirmed_received' => true])->assertOk();
        $other->update(['accepts_appointment_products' => true]);
        $payload['expected_revision'] = $j->fresh()->revision;
        $this->putJson('/api/admin/appointment-products/'.$j->id.'/requirements', $payload)->assertUnprocessable();
        $this->assertSame($this->service->id, $j->fresh()->service_id);
        $this->assertSame('accepted', $q->fresh()->state);
        $this->assertEquals(1000, $o->fresh()->total);
    }

    public function test_saving_unchanged_optional_fields_does_not_undo_the_outcome_or_sent_quotation(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $revision = $j->fresh()->revision;
        $this->putJson('/api/admin/appointment-products/'.$j->id.'/requirements', ['requirements' => $this->brief() + ['needs_advice' => false, 'personalization' => '', 'instructions' => '', 'intended_use' => ''], 'expected_revision' => $revision])
            ->assertOk()->assertJsonPath('data.state', 'quoted')->assertJsonPath('data.revision', $revision);
        $this->assertSame('sent', $q->fresh()->state);
        $this->assertNotNull($j->fresh()->discussed_at);
    }

    public function test_cash_payment_production_pickup_and_revenue_are_one_order_without_catalog_stock_changes(): void
    {
        $product = Product::create(['name' => 'Catalog item', 'code' => 'NOCHANGE', 'category' => 'Regular', 'price' => 20, 'stock' => 25]);
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q);
        $this->assertEquals(0, FinancialMetrics::collected(null, null)['collected']);
        $this->act($o, 'start')->assertUnprocessable();
        $this->act($o, 'cash_receipt', ['amount' => 999, 'receipt_reference' => 'CASH-1', 'confirmed_received' => true])->assertUnprocessable();
        $this->act($o, 'cash_receipt', ['amount' => 1000, 'receipt_reference' => 'CASH-1', 'confirmed_received' => true])->assertOk();
        $this->assertEquals(1000, FinancialMetrics::collected(null, null)['collected']);
        $this->act($o, 'start')->assertOk();
        $this->assertSame('Completed', $j->appointment->fresh()->status);
        $this->act($o, 'collect', ['pickup_code' => $o->pickup_code])->assertUnprocessable();
        $this->act($o, 'ready')->assertOk();
        $this->act($o, 'collect', ['pickup_code' => $o->pickup_code])->assertOk();
        $this->assertSame('completed', $o->fresh()->lifecycle_status);
        $this->assertEquals(1000, FinancialMetrics::collected(null, null)['collected']);
        $this->assertEquals(25, $product->fresh()->stock);
        $this->assertDatabaseCount('walk_in_orders', 0);
    }

    public function test_expiry_and_feature_gate_do_not_change_ordinary_bookings(): void
    {
        config(['appointment_products.enabled' => false]);
        $this->getJson('/api/appointment-products/availability')->assertJsonPath('data.enabled', false);
        $this->postJson('/api/appointments', $this->booking())->assertStatus(503);
        $a = $this->postJson('/api/appointments', $this->booking(['product_requested' => false]))->assertCreated()->json('data');
        $this->assertNull($a['custom_product']);
        config(['appointment_products.enabled' => true]);
        $j = $this->postJson('/api/customer/appointments/'.$a['id'].'/product', ['requirements' => $this->brief(), 'request_key' => (string) Str::uuid()])->assertOk()->json('data');
        $job = AppointmentProductJob::find($j['id']);
        $q = $this->quote($job);
        Carbon::setTestNow(now()->addDays(8));
        $this->artisan('appointments:expire-quotes')->assertSuccessful();
        $this->assertSame('expired', $q->fresh()->state);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/appointment-products/'.$job->id.'/quotations/'.$q->id.'/accept',
            ['expected_revision' => $job->fresh()->revision, 'specifications_accepted' => true, 'payment_method' => 'cash', 'policy_accepted' => true, 'policy_version' => $this->policy['version']])->assertConflict();
    }

    private function destination(): array
    {
        return ['delivery_recipient_name' => 'Maria Santos', 'delivery_contact_no' => '09171234567', 'delivery_street' => '1 Main St', 'delivery_barangay' => 'Barangay 1', 'delivery_city' => 'Daet', 'delivery_province' => 'Camarines Norte', 'delivery_postal_code' => '4600'];
    }

    private function paymentAttempt(Order $o, bool $live = true): object
    {
        config(['payments.gateway' => 'paymongo', 'payments.paymongo.enabled' => true, 'payments.paymongo.webhook_secret' => 'fixture-hook', 'payments.paymongo.secret_key' => $live ? 'sk_live_fixture' : 'sk_test_fixture']);
        $o->payment->forceFill(['gateway' => 'paymongo', 'method' => 'GCash'])->save();
        $o->forceFill(['payment_method' => 'GCash'])->save();
        $id = DB::table('payment_attempts')->insertGetId(['payment_id' => $o->payment->id, 'token' => (string) Str::uuid(), 'checkout_id' => 'cs_fixture'.$o->id,
            'checkout_url' => 'https://checkout.paymongo.com/fixture', 'checkout_method' => 'gcash', 'api_version' => 'v2', 'livemode' => $live, 'amount_centavos' => (int) round($o->total * 100),
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);

        return DB::table('payment_attempts')->find($id);
    }

    private function providerFixture(object $a, Order $o, bool $paid = false, string $state = 'active'): array
    {
        return ['id' => $a->checkout_id, 'attributes' => ['livemode' => (bool) $a->livemode, 'status' => $state,
            'metadata' => ['attempt_token' => $a->token, 'payment_id' => (string) $a->payment_id, 'order_id' => (string) $o->id],
            'payments' => $paid ? [['id' => 'pay_fixture'.$o->id, 'attributes' => ['status' => 'paid', 'amount' => (int) $a->amount_centavos, 'currency' => 'PHP', 'livemode' => (bool) $a->livemode, 'source' => ['type' => 'gcash'], 'paid_at' => now()->timestamp]]] : []]];
    }

    public function test_cash_delivery_uses_same_order_and_ready_guard_then_customer_receipt(): void
    {
        $j = $this->booked();
        $q = $this->quote($j, ['fulfillment_type' => 'delivery', 'shipping_fee' => 100, 'delivery_eligible' => true, 'delivery' => $this->destination() + ['customer_id' => 999, 'total' => 1]]);
        $o = $this->accept($j, $q);
        $this->assertEquals(1100, $o->total);
        $this->assertSame($this->customer->id, $o->customer_id);
        $this->act($o, 'cash_receipt', ['amount' => 1100, 'receipt_reference' => 'ADVANCE-JT', 'confirmed_received' => true])->assertOk();
        $this->act($o, 'start')->assertOk();
        $endpoint = '/api/admin/orders/'.$o->id.'/shipment/tracking';
        $handover = ['request_key' => (string) Str::uuid(), 'tracking_number' => '001234567890', 'handed_over_at' => now()->toIso8601String(), 'handover_confirmed' => true, 'actual_shipping_cost' => 150];
        $this->postJson($endpoint, $handover)->assertUnprocessable();
        $this->act($o, 'ready')->assertOk();
        $this->postJson($endpoint, $handover)->assertOk();
        $this->postJson($endpoint, $handover)->assertOk();
        $this->assertEquals(100, $o->fresh()->shipping_fee);
        $this->assertDatabaseCount('shipment_trackers', 1);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/received')->assertOk();
        $this->assertSame('completed', $o->fresh()->lifecycle_status);
        $this->assertEquals(1100, FinancialMetrics::collected(null, null)['collected']);
        $sales = AppointmentProductMetrics::sales();
        $this->assertEquals(1000, $sales[0]['total_revenue']);
        $this->assertEquals(5, $sales[0]['total_sold']);
    }

    public function test_live_receipt_refund_fixture_and_analytics_do_not_double_count_shipping_or_completion(): void
    {
        $j = $this->booked();
        $q = $this->quote($j, ['fulfillment_type' => 'delivery', 'shipping_fee' => 100, 'delivery_eligible' => true, 'delivery' => $this->destination()]);
        $o = $this->accept($j, $q);
        $a = $this->paymentAttempt($o);
        $this->assertEquals(0, FinancialMetrics::collected(null, null)['collected']);
        $g = app(GatewayPayments::class);
        $g->applySession($a->id, $this->providerFixture($a, $o, true));
        $g->applySession($a->id, $this->providerFixture($a, $o, true));
        $this->assertEquals(1100, FinancialMetrics::collected(null, null)['collected']);
        $this->assertDatabaseCount('payment_receipts', 1);
        $o->forceFill(['lifecycle_status' => 'completed', 'customer_stage' => 'completed', 'appointment_production_status' => 'ready', 'completed_at' => now()])->save();
        $this->assertEquals(1100, FinancialMetrics::collected(null, null)['collected']);
        DB::table('payment_refunds')->insert(['payment_id' => $o->payment->id, 'provider_payment_id' => 'pay_fixture'.$o->id, 'reason' => 'requested_by_customer', 'amount_centavos' => 20000, 'status' => 'succeeded', 'token' => (string) Str::uuid(), 'livemode' => true, 'requested_by' => $this->admin->id, 'confirmed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $this->assertEquals(900, FinancialMetrics::collected(null, null)['collected']);
        Sanctum::actingAs($this->admin);
        $this->getJson('/api/admin/dashboard/summary')->assertOk()->assertJsonPath('data.counts.total_revenue', 900);
        $rows = $this->getJson('/api/admin/product-analytics/sales-by-category?period=all')->assertOk()->json('data');
        $this->assertSame('Custom Products · 3D Printing', $rows[0]['category']);
        $this->assertEquals(1000, $rows[0]['total_revenue']);
        $report = $this->getJson('/api/admin/reports?category=sales&period=monthly&year=2026&month=11')->assertOk()->json('data');
        $this->assertStringContainsString('Custom Products', json_encode($report));
        $this->assertStringContainsString($j->appointment->reference_no, json_encode($report));
    }

    public function test_pending_provider_payment_blocks_cash_switch_until_explicit_expiry(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q);
        $a = $this->paymentAttempt($o, false);
        $session = $this->providerFixture($a, $o);
        $expired = false;
        Http::preventStrayRequests();
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*' => function ($r) use (&$expired, $session) {
            $s = $session;
            if ($expired) {
                $s['attributes']['status'] = 'expired';
            }if ($r->method() === 'POST' && ! $expired) {
                return Http::response(['error' => 'processing'], 422);
            }

return Http::response(['data' => $s]);
        }]);
        Sanctum::actingAs($this->customer);
        $path = '/api/customer/orders/'.$o->id.'/custom-payment-method';
        $body = ['payment_method' => 'cash', 'expected_revision' => 0];
        $this->postJson($path, $body)->assertUnprocessable();
        $this->assertSame('GCash', $o->fresh()->payment_method);
        $this->assertSame('switch:cash', $o->fresh()->collection_hold);
        $this->act($o, 'cash_receipt', ['amount' => 1000, 'receipt_reference' => 'NO-DUP', 'confirmed_received' => true])->assertUnprocessable();
        $expired = true;
        Sanctum::actingAs($this->customer);
        $this->postJson($path, $body)->assertOk();
        $this->assertNull($o->fresh()->collection_hold);
        $this->assertSame('Cash at FMRC', $o->fresh()->payment_method);
        $this->assertDatabaseHas('payment_attempts', ['id' => $a->id, 'status' => 'expired']);
    }

    public function test_late_payment_is_recorded_but_does_not_revive_expired_specifications(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q);
        $a = $this->paymentAttempt($o, false);
        $session = $this->providerFixture($a, $o, false, 'expired');
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*' => Http::response(['data' => $session])]);
        Carbon::setTestNow(now()->addDays(8));
        $this->artisan('appointments:expire-quotes')->assertSuccessful();
        $this->assertSame('expired', $q->fresh()->state);
        $this->assertSame('cancelled', $o->fresh()->lifecycle_status);
        app(GatewayPayments::class)->applySession($a->id, $this->providerFixture($a, $o, true));
        $this->assertSame('payment_review', $o->fresh()->appointment_production_status);
        $this->act($o, 'start')->assertUnprocessable();
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_draft_files_failed_save_and_duplicate_cash_actions_preserve_data(): void
    {
        $key = (string) Str::uuid();
        $input = ['requirements' => json_encode($this->brief()), 'request_key' => $key, 'attachments' => [UploadedFile::fake()->create('design.step', 2, 'application/octet-stream')]];
        $j = $this->post('/api/customer/appointment-products/drafts', $input, ['Accept' => 'application/json'])->assertOk()->json('data');
        $this->assertCount(1, $j['files']);
        $this->postJson('/api/customer/appointment-products/drafts', ['draft_id' => $j['id'], 'expected_revision' => 5, 'requirements' => $this->brief(), 'request_key' => $key])->assertConflict();
        $this->assertDatabaseCount('appointment_product_files', 1);
        $this->postJson('/api/appointments', $this->booking(['product_draft_id' => $j['id'], 'product_revision' => 0, 'request_key' => $key]))->assertCreated();
        $job = AppointmentProductJob::find($j['id']);
        $q = $this->quote($job);
        $o = $this->accept($job, $q);
        $actionKey = (string) Str::uuid();
        for ($i = 0; $i < 2; $i++) {
            $this->act($o, 'cash_receipt', ['amount' => 1000, 'receipt_reference' => 'IDEMPOTENT', 'confirmed_received' => true, 'request_key' => $actionKey, 'expected_revision' => 0])->assertOk();
        }
        $this->assertDatabaseCount('appointment_cash_entries', 1);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$o->id.'/custom-product', ['action' => 'cash_reverse', 'request_key' => (string) Str::uuid(), 'expected_revision' => 1, 'receipt_reference' => 'REV', 'note' => 'Wrong entry'])->assertForbidden();
        $o->forceFill(['lifecycle_status' => 'cancelled'])->save();
        Sanctum::actingAs($this->admin);
        $this->postJson('/api/admin/orders/'.$o->id.'/custom-product', ['action' => 'cash_refund', 'request_key' => (string) Str::uuid(), 'expected_revision' => 1, 'receipt_reference' => 'REF', 'note' => 'Released refund', 'amount' => 200, 'refund_released' => true])->assertOk();
        $this->assertEquals(800, FinancialMetrics::collected(null, null)['collected']);
    }

    public function test_archiving_retains_agreements_restore_and_bulk_cleanup(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q);
        Sanctum::actingAs($this->admin);
        $this->patchJson('/api/admin/orders/'.$o->id.'/archive')->assertUnprocessable();
        $this->postJson('/api/admin/appointment-products/'.$j->id.'/cancel', ['expected_revision' => $j->fresh()->revision, 'note' => 'Cancelled test'])->assertOk();
        $this->patchJson('/api/admin/orders/'.$o->id.'/archive')->assertOk();
        $this->deleteJson('/api/admin/archives/delete-bulk', ['module' => 'order', 'ids' => [$o->id]])->assertNotFound();
        $this->assertDatabaseHas('orders', ['id' => $o->id]);
        $this->patchJson('/api/admin/archives/restore-bulk', ['module' => 'order', 'ids' => [$o->id]])->assertOk();
        $this->assertFalse($o->fresh()->is_archived);
    }

    public function test_disabled_service_and_partially_installed_schema_leave_ordinary_appointments_usable(): void
    {
        $this->service->update(['accepts_appointment_products' => false]);
        $this->postJson('/api/appointments', $this->booking())->assertUnprocessable();
        Schema::drop('appointment_product_claims');
        $this->getJson('/api/appointment-products/availability')->assertOk()->assertJsonPath('data.schema_ready', false);
        $this->getJson('/api/customer/appointment-products/drafts')->assertStatus(503);
        $this->postJson('/api/appointments', $this->booking(['product_requested' => false]))->assertCreated();
        Sanctum::actingAs($this->staff);
        $this->getJson('/api/admin/orders')->assertOk();
        $this->getJson('/api/admin/dashboard/summary')->assertOk();
    }

    public function test_follow_up_keeps_one_job_and_cannot_quote_from_a_cancelled_meeting(): void
    {
        $j = $this->booked();
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/appointment-products/'.$j->id.'/outcome', ['outcome' => 'follow_up', 'note' => 'Please book a follow-up.', 'expected_revision' => 0])->assertOk();
        Sanctum::actingAs($this->customer);
        $body = ['expected_revision' => $j->fresh()->revision, 'request_key' => (string) Str::uuid(), 'appointment_date' => '2026-11-10', 'appointment_time' => '9:00 - 10:00 AM', 'appointment_method' => 'online'];
        $path = '/api/customer/appointment-products/'.$j->id.'/follow-up';
        $this->postJson($path, $body)->assertOk();
        $this->postJson($path, $body)->assertOk();
        $this->assertDatabaseCount('appointments', 2);
        $this->assertDatabaseCount('appointment_product_jobs', 1);
        $follow = Appointment::where('product_job_id', $j->id)->where('id', '!=', $j->appointment_id)->first();
        $follow->status = 'Cancelled';
        $follow->save();
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/appointment-products/'.$j->id.'/outcome', ['outcome' => 'ready_for_quote', 'note' => 'Discussed', 'discussion_confirmed' => true, 'discussed_appointment_id' => $follow->id, 'expected_revision' => $j->fresh()->revision])->assertUnprocessable();
    }

    public function test_guest_ownership_is_private_one_time_and_matches_signed_in_email(): void
    {
        $a = Appointment::create(['reference_no' => 'AP-GUEST', 'first_name' => 'Maria', 'last_name' => 'Santos', 'email' => $this->customer->email, 'status' => 'Completed', 'appointment_date' => '2026-11-05', 'appointment_time' => '9:00 - 10:00 AM', 'purpose' => 'Consultation', 'client_type' => 'Student', 'country' => 'Philippines', 'full_address' => 'Daet', 'contact_number' => '09171234567']);
        $this->postJson('/api/customer/appointments/'.$a->id.'/product', ['requirements' => $this->brief(), 'request_key' => (string) Str::uuid()])->assertNotFound();
        DB::table('appointment_product_claims')->insert(['appointment_id' => $a->id, 'token_hash' => hash('sha256', 'private-fixture'), 'expires_at' => now()->addHour(), 'created_at' => now()]);
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->postJson('/api/customer/appointment-products/claim', ['token' => 'private-fixture'])->assertUnprocessable();
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/appointment-products/claim', ['token' => 'private-fixture'])->assertOk();
        $this->postJson('/api/customer/appointment-products/claim', ['token' => 'private-fixture'])->assertUnprocessable();
        $this->postJson('/api/customer/appointments/'.$a->id.'/product', ['requirements' => $this->brief(), 'request_key' => (string) Str::uuid()])->assertOk();
        $this->assertDatabaseCount('appointments', 1);
    }

    public function test_service_eligibility_publishes_through_page_save_and_invalid_payload_rolls_back(): void
    {
        Sanctum::actingAs($this->staff);
        $this->service->update(['accepts_appointment_products' => false]);
        $this->putJson('/api/admin/website-pages/services', ['settings' => [], 'services' => ['upsert' => [['id' => $this->service->id, 'accepts_appointment_products' => true], ['title' => '']]]])->assertUnprocessable();
        $this->assertFalse($this->service->fresh()->accepts_appointment_products);
        $this->putJson('/api/admin/website-pages/services', ['settings' => [], 'services' => ['upsert' => [['id' => $this->service->id, 'accepts_appointment_products' => true]]]])->assertOk();
        $this->assertTrue($this->service->fresh()->accepts_appointment_products);
        $this->getJson('/api/appointment-products/availability')->assertJsonFragment(['title' => '3D Printing']);
    }

    public function test_online_acceptance_and_hosted_checkout_use_one_order_and_duplicate_provider_confirmation(): void
    {
        config(['payments.gateway' => 'paymongo', 'payments.paymongo.enabled' => true, 'payments.paymongo.secret_key' => 'sk_test_fixture', 'payments.paymongo.webhook_secret' => 'fixture-hook', 'payments.paymongo.checkout_method' => 'qrph']);
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q, 'online');
        Http::preventStrayRequests();
        Http::fake(['api.paymongo.com/v2/checkout_sessions' => Http::response(['data' => ['id' => 'cs_optional', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/fixture', 'livemode' => false]]]), 'api.paymongo.com/v1/checkout_sessions/*' => Http::response(['data' => ['id' => 'cs_optional', 'attributes' => ['status' => 'active', 'livemode' => false, 'payments' => []]]])]);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk();
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk();
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('payment_attempts', 1);
        $this->assertSame('pending', $o->fresh()->payment->status);
        $this->act($o, 'start')->assertUnprocessable();
    }

    public function test_customer_and_operator_cannot_bypass_unpaid_or_unready_production_checks(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        $o = $this->accept($j, $q);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$o->id.'/approve')->assertUnprocessable();
        $this->postJson('/api/admin/orders/approve-bulk', ['ids' => [$o->id]])->assertUnprocessable();
        $this->postJson('/api/admin/orders/'.$o->id.'/complete')->assertUnprocessable();
        $this->act($o, 'ready')->assertUnprocessable();
        $this->act($o, 'cash_receipt', ['amount' => 1000, 'receipt_reference' => 'GUARD', 'confirmed_received' => true])->assertOk();
        $this->act($o, 'start')->assertOk();
        $o->forceFill(['customer_stage' => 'to_receive'])->save();
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/received')->assertUnprocessable();
        $this->assertSame('pending', $o->fresh()->lifecycle_status);
    }

    public function test_new_assets_are_served_on_normal_and_both_pwa_shells(): void
    {
        foreach (['/home-page/appointment-products.js', '/apps/customer/home-page/appointment-products.js', '/apps/team/home-page/appointment-products.js'] as $url) {
            $response = $this->get($url)->assertOk();
            $this->assertStringContainsString('FMRCAppointmentProducts', file_get_contents($response->baseResponse->getFile()->getPathname()));
        }
        foreach (['http://localhost/apps/customer/home-page/?fixture=1', '/apps/team/admin-page/appointments.html', '/apps/team/staff-page/orders.html'] as $url) {
            $response = $this->get($url)->assertOk();
            $this->assertStringContainsString('appointment-products.js', file_get_contents($response->baseResponse->getFile()->getPathname()));
        }
    }

    public function test_invalid_revision_does_not_withdraw_current_quote_and_a_new_quote_keeps_history(): void
    {
        $j = $this->booked();
        $q = $this->quote($j);
        Sanctum::actingAs($this->staff);
        $path = '/api/admin/appointment-products/'.$j->id.'/quotations';
        $body = ['request_key' => (string) Str::uuid(), 'expected_revision' => $j->fresh()->revision, 'specifications' => $this->brief(), 'unit_price' => 220, 'shipping_fee' => 0, 'fulfillment_type' => 'pickup', 'lead_time' => 'Five working days', 'design_notes' => 'Revised design layout'];
        $this->postJson($path,$body + ['proof_file_ids' => [999]])->assertUnprocessable();
        $this->assertSame('sent',$q->fresh()->state);
        $this->postJson($path,$body)->assertOk();
        $this->assertSame('superseded',$q->fresh()->state);
        $this->assertDatabaseCount('appointment_product_quotes',2);
        $this->assertSame(200,$q->fresh()->agreement['unit_price']);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/appointment-products/'.$j->id.'/quotations/'.$q->id.'/accept',['expected_revision' => $j->fresh()->revision, 'specifications_accepted' => true, 'policy_accepted' => true, 'policy_version' => $this->policy['version'], 'payment_method' => 'cash'])->assertConflict();
    }

    public function test_partial_schema_retains_known_cash_revenue_and_private_history(): void
    {
        $job=$this->booked();$quote=$this->quote($job);$order=$this->accept($job,$quote);
        $this->act($order,'cash_receipt',['amount'=>1000,'receipt_reference'=>'PARTIAL','confirmed_received'=>true])->assertOk();
        Schema::drop('appointment_product_claims');
        Sanctum::actingAs($this->admin);
        $this->getJson('/api/admin/dashboard/summary')->assertOk()->assertJsonPath('data.counts.total_revenue',1000);
        $this->getJson('/api/customer/appointments/'.$job->appointment_id)->assertOk()->assertJsonPath('data.custom_product.unavailable',true);
        $this->deleteJson('/api/appointments/'.$job->appointment_id)->assertStatus(503);
        $this->assertDatabaseHas('appointments',['id'=>$job->appointment_id]);
        $this->assertEquals(1000,FinancialMetrics::collected(null,null)['collected']);
    }
}
