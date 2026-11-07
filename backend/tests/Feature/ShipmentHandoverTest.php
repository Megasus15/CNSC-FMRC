<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\ShipmentTracker;
use App\Models\User;
use App\Services\SeventeenTrackTracking;
use App\Support\PaymentMethodAvailability;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ShipmentHandoverTest extends TestCase
{
    use RefreshDatabase;

    private Order $order;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-03T07:00:00Z'));
        Mail::fake();
        Http::preventStrayRequests();
        config(['track17.enabled' => false]);
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->order = Order::create(['order_no' => 'JT-TEST', 'customer_id' => $this->customer->id, 'customer_name' => 'Customer',
            'customer_contact' => 'fixture@example.test', 'quantity' => 1, 'subtotal' => 400, 'shipping_fee' => 85,
            'shipping_quote' => ['shipping_fee' => 85], 'total' => 485, 'payment_method' => 'GCash', 'fulfillment_type' => 'delivery',
            'lifecycle_status' => 'pending', 'customer_stage' => 'to_ship', 'approved_at' => now()->subHour(), 'created_at' => now()->subDay(),
            'courier_name' => 'J&T Express', 'shipment_tracking_mode' => 'jnt_dropoff', 'delivery_recipient_name' => 'Customer', 'delivery_contact_no' => '09171234567',
            'delivery_street' => '1 Main Street', 'delivery_barangay' => 'Barangay 1', 'delivery_city' => 'Daet',
            'delivery_province' => 'Camarines Norte', 'delivery_postal_code' => '4600']);
        $this->order->forceFill(['created_at' => now()->subDay()])->save();
        $payment = Payment::create(['order_id' => $this->order->id, 'payment_no' => 'PAY-JT', 'method' => 'GCash', 'amount' => 485,
            'status' => 'paid', 'gateway' => 'paymongo', 'paymongo_payment_id' => 'pay_fixture', 'paid_at' => now()]);
        $attempt = DB::table('payment_attempts')->insertGetId(['payment_id' => $payment->id, 'token' => (string) Str::uuid(),
            'amount_centavos' => 48500, 'livemode' => true, 'status' => 'paid', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('payment_receipts')->insert(['payment_id' => $payment->id, 'attempt_id' => $attempt, 'provider_payment_id' => 'pay_fixture',
            'amount_centavos' => 48500, 'livemode' => true, 'confirmed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        Http::fake();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function endpoint(): string
    {
        return '/api/admin/orders/'.$this->order->id.'/shipment/tracking';
    }

    private function input(array $changes = []): array
    {
        return array_replace(['request_key' => (string) Str::uuid(), 'tracking_number' => '001234567890',
            'handed_over_at' => now()->subMinutes(10)->toIso8601String(), 'handover_confirmed' => true, 'actual_shipping_cost' => 120], $changes);
    }

    private function record(array $changes = []): ShipmentTracker
    {
        $this->postJson($this->endpoint(), $this->input($changes))->assertOk();

        return ShipmentTracker::latest('id')->firstOrFail();
    }

    public function test_handover_is_paid_idempotent_and_never_changes_customer_total(): void
    {
        $input = $this->input();
        $this->postJson($this->endpoint(), $input)->assertOk()->assertJsonPath('data.customer_stage', 'to_receive')
            ->assertJsonPath('data.courier_shipment.tracking_number', '001234567890');
        $this->postJson($this->endpoint(), $input)->assertOk();
        $this->postJson($this->endpoint(), array_replace($input, ['request_key' => (string) Str::uuid()]))->assertOk();
        $this->assertDatabaseCount('shipment_trackers', 1);
        $this->assertDatabaseCount('order_tracking_events', 1);
        $this->assertSame('485.00', $this->order->fresh()->total);
        $this->assertSame('85.00', $this->order->fresh()->shipping_fee);
        Http::assertNothingSent();
    }

    public function test_unauthorized_unpaid_pickup_cancelled_and_incomplete_orders_cannot_dispatch(): void
    {
        Sanctum::actingAs($this->customer);
        $this->postJson($this->endpoint(), $this->input())->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        foreach ([['lifecycle_status' => 'cancelled'], ['fulfillment_type' => 'pickup'], ['delivery_postal_code' => null]] as $changes) {
            $original = $this->order->fresh()->only(array_keys($changes));
            $this->order->update($changes);
            $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
            $this->order->update($original);
        }
        $this->order->payment->update(['status' => 'pending']);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        $this->order->payment->update(['status' => 'refunded']);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        $this->assertDatabaseCount('shipment_trackers', 0);
    }

    public function test_staff_can_record_when_automatic_tracking_is_disabled(): void
    {
        config(['track17.enabled' => false]);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->record();
        $this->artisan('shipments:process')->assertSuccessful();
        $this->getJson('/api/admin/orders/'.$this->order->id)->assertOk()->assertJsonPath('data.courier_shipment.tracking_available', false);
        Http::assertNothingSent();
    }

    public function test_new_cod_disabled_and_ninja_booking_retired(): void
    {
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.payment_cash_on_delivery_enabled', '0');
        $this->postJson('/api/admin/orders/'.$this->order->id.'/shipment/book', [])->assertUnprocessable();
        $this->assertFalse(PaymentMethodAvailability::isEnabled('COD'));
        Http::assertNothingSent();
    }

    public function test_payment_receipt_must_match_the_total_and_demo_handover_never_contacts_the_provider(): void
    {
        DB::table('payment_receipts')->update(['amount_centavos' => 1]);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        DB::table('payment_receipts')->update(['amount_centavos' => 48500, 'livemode' => false]);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        config(['track17.allow_demo_handover' => true]);
        $tracker = $this->record();
        $this->assertTrue($tracker->demo);
        $this->artisan('shipments:process')->assertSuccessful();
        Http::assertNothingSent();
        $this->assertDatabaseCount('shipment_notification_outbox', 0);
        $this->expectException(ValidationException::class);
        app(SeventeenTrackTracking::class)->verifyWaybill($tracker);
    }

    public function test_unaccepted_cancellation_pending_and_refund_pending_cannot_be_dispatched(): void
    {
        foreach ([['approved_at' => null], ['cancel_state' => 'requested']] as $changes) {
            $original = $this->order->fresh()->only(array_keys($changes));
            $this->order->update($changes);
            $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
            $this->order->update($original);
        }
        DB::table('payment_refunds')->insert(['payment_id' => $this->order->payment->id, 'provider_payment_id' => 'pay_fixture',
            'token' => (string) Str::uuid(), 'requested_by' => auth()->id(), 'amount_centavos' => 48500, 'reason' => 'Requested refund',
            'livemode' => true, 'status' => 'requested', 'created_at' => now(), 'updated_at' => now()]);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        $this->assertDatabaseCount('shipment_trackers', 0);
    }

    public function test_note_and_completion_routes_cannot_bypass_physical_handover_or_forge_a_courier_event(): void
    {
        $path = '/api/admin/orders/'.$this->order->id;
        $this->patchJson($path.'/tracking', ['stage' => 'to_receive'])->assertUnprocessable();
        $this->postJson($path.'/complete')->assertUnprocessable();
        $this->assertDatabaseCount('shipment_trackers', 0);
        $this->record();
        foreach ([['stage' => 'completed'], ['event_type' => 'courier_update'], ['courier_tracking_no' => 'FORGED'], ['latitude' => 14, 'longitude' => 123]] as $changes) {
            $this->patchJson($path.'/tracking', $changes)->assertUnprocessable();
        }
        $this->patchJson($path.'/tracking', ['title' => 'FMRC assistance', 'description' => 'Please contact FMRC for assistance.'])->assertOk();
        $this->assertSame('to_receive', $this->order->fresh()->customer_stage);
        $this->assertDatabaseHas('order_tracking_events', ['title' => 'FMRC assistance', 'event_type' => 'admin_update']);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$this->order->id.'/received')->assertConflict();
        $this->assertSame('to_receive', $this->order->fresh()->customer_stage);
    }

    public function test_duplicate_waybill_on_another_order_and_conflicting_request_keys_are_rejected(): void
    {
        $input = $this->input();
        $this->postJson($this->endpoint(), $input)->assertOk();
        $this->postJson($this->endpoint(), array_replace($input, ['tracking_number' => 'DIFFERENT']))->assertConflict();
        $other = $this->order->replicate();
        $other->order_no = 'OTHER';
        $other->save();
        $this->postJson('/api/admin/orders/'.$other->id.'/shipment/tracking', $input)->assertConflict();
        $this->assertDatabaseCount('shipment_trackers', 1);
    }

    public function test_email_failure_retries_without_repeating_in_app_notification(): void
    {
        config(['track17.enabled' => false]);
        $tracker = $this->record();
        $calls = 0;
        Mail::shouldReceive('html')->twice()->andReturnUsing(function () use (&$calls) {
            if (++$calls === 1) {
                throw new \RuntimeException('Fixture mail outage');
            }
        });
        $this->artisan('shipments:process')->assertSuccessful();
        $row = DB::table('shipment_notification_outbox')->first();
        $this->assertNull($row->sent_at);
        $this->assertNotNull($row->in_app_sent_at);
        Carbon::setTestNow(now()->addMinutes(2));
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertNotNull(DB::table('shipment_notification_outbox')->value('sent_at'));
        $this->assertDatabaseCount('shipment_notification_outbox', 1);
        $this->assertSame(2, $calls);
    }
}
