<?php

namespace Tests\Feature;

use App\Models\CourierShipment;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class NinjaVanShippingTest extends TestCase
{
    use RefreshDatabase;

    private Order $order;

    private User $customer;

    private array $sent = [];

    private string $mode = 'success';

    private bool $earlyWebhook = false;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Carbon::setTestNow(Carbon::parse('2026-11-02 00:00:00', 'UTC'));
        config(['ninjavan.enabled' => true, 'ninjavan.environment' => 'sandbox', 'ninjavan.production_approved' => false,
            'ninjavan.client_id' => 'fixture-client', 'ninjavan.client_secret' => 'fixture-secret', 'ninjavan.delivery_start' => '09:00', 'ninjavan.delivery_end' => '22:00',
            'ninjavan.pickup_start' => '09:00', 'ninjavan.pickup_end' => '18:00',
            'ninjavan.from' => ['name' => 'FMRC', 'phone_number' => '09171234567', 'email' => 'fixture@example.test',
                'address' => ['address1' => '1 Test Street', 'area' => 'Test area', 'city' => 'Daet', 'state' => 'Camarines Norte', 'postcode' => '4600', 'country' => 'PH', 'address_type' => 'office']]]);
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->order = Order::create(['order_no' => 'NV-TEST', 'customer_id' => $this->customer->id, 'customer_name' => 'Customer', 'customer_contact' => 'client@example.test',
            'quantity' => 1, 'subtotal' => 414.5, 'shipping_fee' => 85.5, 'shipping_quote' => ['shipping_fee' => 85.5], 'total' => 500, 'payment_method' => 'COD', 'fulfillment_type' => 'delivery',
            'lifecycle_status' => 'pending', 'customer_stage' => 'to_ship', 'approved_at' => now(), 'delivery_recipient_name' => 'Customer', 'delivery_contact_no' => '09171234567',
            'delivery_street' => '1 Test Street', 'delivery_barangay' => 'Barangay 1', 'delivery_city' => 'Daet', 'delivery_province' => 'Camarines Norte', 'delivery_postal_code' => '4600']);
        Payment::create(['order_id' => $this->order->id, 'payment_no' => 'PAY-NV', 'method' => 'COD', 'amount' => 500, 'status' => 'pending']);
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        Http::preventStrayRequests();
        Http::fake(['api-sandbox.ninjavan.co/sg/2.0/oauth/access_token' => Http::response(['access_token' => 'fixture-token', 'expires_in' => 3600]),
            'api-sandbox.ninjavan.co/sg/4.2/orders' => function ($request) {
                $payload = $request->data();
                $this->sent[] = $payload;
                if ($this->mode === 'timeout') {
                    throw new ConnectionException('Fixture connection timeout');
                }
                if ($this->mode === 'reject') {
                    return Http::response(['error' => ['code' => 123]], 400);
                }
                if ($this->mode === 'duplicate') {
                    return Http::response(['error' => ['code' => 109201]], 400);
                }
                if ($this->mode === 'double') {
                    $this->mode = 'success';
                    $this->legacyBook($this->parcel())->assertUnprocessable();
                }
                $tracking = 'PREFIX'.$payload['requested_tracking_number'];
                if ($this->earlyWebhook) {
                    $this->hook($tracking, $payload['reference']['merchant_order_number'], 'Pending Pickup', now()->toIso8601String())->assertOk();
                }

                return Http::response(['tracking_number' => $tracking]);
            },
            'api-sandbox.ninjavan.co/sg/2.2/orders/*' => Http::response(['status' => 'Cancelled']),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function endpoint(string $action): string
    {
        return '/api/admin/orders/'.$this->order->id.'/shipment/'.$action;
    }

    private function parcel(array $changes = []): array
    {
        return array_replace(['request_key' => (string) Str::uuid(), 'weight' => 1.5, 'length' => 20, 'width' => 15, 'height' => 10, 'dispatch_date' => '2026-11-02', 'pickup_required' => false, 'actual_booking_cost' => 120], $changes);
    }

    private function book(array $changes = []): array
    {
        $body = $this->parcel($changes);
        $this->legacyBook($body)->assertOk();

        return $body;
    }

    // Build historical provider records directly; the public booking route is retired.
    private function legacyBook(array $body): TestResponse
    {
        try {
            app(\App\Services\NinjaVanShipping::class)->book($this->order, $body, (int) auth()->id());
            return TestResponse::fromBaseResponse(response()->json(['recorded' => true]));
        } catch (\Throwable $error) {
            $request = \Illuminate\Http\Request::create('/legacy-fixture', 'POST', server: ['HTTP_ACCEPT' => 'application/json']);
            return TestResponse::fromBaseResponse(app(\Illuminate\Contracts\Debug\ExceptionHandler::class)->render($request, $error));
        }
    }

    private function hook(string $tracking, string $reference, string $status, string $timestamp, bool $return = false, ?string $secret = null): TestResponse
    {
        $raw = json_encode(['tracking_id' => $tracking, 'shipper_order_ref_no' => $reference, 'timestamp' => $timestamp, 'status' => $status, 'is_parcel_on_rts_leg' => $return, 'arrived_at_origin_hub_information' => ['city' => 'Daet', 'hub' => 'Fixture hub']]);

        return $this->call('POST', '/api/webhooks/ninjavan', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_NINJAVAN_HMAC_SHA256' => base64_encode(hash_hmac('sha256', $raw, $secret ?? 'fixture-secret', true))], $raw);
    }

    public function test_booking_uses_sg_sandbox_ph_addresses_actual_measurements_and_the_accepted_cod_total(): void
    {
        $body = $this->book();
        $this->assertCount(1, $this->sent);
        $payload = $this->sent[0];
        $this->assertSame(500, $payload['parcel_job']['cash_on_delivery']);
        $this->assertSame('PHP', $payload['parcel_job']['cash_on_delivery_currency']);
        $this->assertSame('PH', $payload['to']['address']['country']);
        $this->assertSame('+639171234567', $payload['to']['phone_number']);
        $this->assertSame(1.5, $payload['parcel_job']['dimensions']['weight']);
        $this->assertSame(20, $payload['parcel_job']['dimensions']['length']);
        $this->assertSame('500.00', $this->order->fresh()->total);
        $this->assertSame('85.50', $this->order->fresh()->shipping_fee);
        $this->legacyBook($body)->assertOk();
        $this->assertCount(1, $this->sent);
        $this->assertDatabaseCount('courier_shipments', 1);
        $this->assertDatabaseCount('shipment_booking_attempts', 1);
    }

    public function test_legacy_online_payment_requires_confirmation_and_customer_cannot_access_retired_booking(): void
    {
        Sanctum::actingAs($this->customer);
        $this->postJson($this->endpoint('book'), $this->parcel())->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->order->update(['payment_method' => 'GCash']);
        $this->legacyBook($this->parcel())->assertUnprocessable();
        $this->order->payment->update(['status' => 'paid']);
        $this->book();
        $this->assertSame(0, $this->sent[0]['parcel_job']['cash_on_delivery']);
    }

    public function test_timeout_retries_keep_one_shipment_and_the_same_requested_tracking_number(): void
    {
        $this->mode = 'timeout';
        $this->legacyBook($this->parcel())->assertConflict();
        $shipment = CourierShipment::firstOrFail();
        $this->assertSame('booking_unknown', $shipment->status);
        $this->legacyBook($this->parcel(['weight' => 2]))->assertUnprocessable();
        $this->mode = 'success';
        $this->book();
        $this->assertDatabaseCount('courier_shipments', 1);
        $this->assertDatabaseCount('shipment_booking_attempts', 2);
        $this->assertSame($this->sent[0], $this->sent[1]);
        $this->assertSame('awaiting_pickup', $shipment->fresh()->status);
    }

    public function test_a_second_click_during_the_provider_request_cannot_start_another_shipment(): void
    {
        $this->mode = 'double';
        $this->book();
        $this->assertCount(1, $this->sent);
        $this->assertDatabaseCount('courier_shipments', 1);
    }

    public function test_signed_webhooks_are_deduplicated_and_delayed_events_cannot_undo_delivery(): void
    {
        $this->book();
        $shipment = CourierShipment::firstOrFail();
        $delivered = now()->addHours(2)->toIso8601String();
        $this->hook($shipment->tracking_number, $shipment->reference, 'Delivered', $delivered, false, 'wrong-secret')->assertUnauthorized();
        $this->hook($shipment->tracking_number, $shipment->reference, 'Delivered', $delivered)->assertOk();
        $revision = (int) $this->order->fresh()->courier_history_version;
        $this->hook($shipment->tracking_number, $shipment->reference, 'Delivered', $delivered)->assertOk();
        $this->assertSame($revision, (int) $this->order->fresh()->courier_history_version);
        $this->hook($shipment->tracking_number, $shipment->reference, 'On Vehicle for Delivery', now()->addHour()->toIso8601String())->assertOk();
        $this->assertGreaterThan($revision, (int) $this->order->fresh()->courier_history_version);
        $this->assertSame('delivered', $shipment->fresh()->status);
        $this->assertDatabaseCount('courier_webhook_events', 3);
        $this->assertSame('pending', $this->order->fresh()->lifecycle_status);
        $this->assertSame('to_ship', $this->order->fresh()->customer_stage);
        $this->assertSame('pending', $this->order->fresh()->payment->status);
        Sanctum::actingAs($this->customer);
        $customer = $this->getJson('/api/customer/orders/'.$this->order->id)->assertOk()->json('data.courier_shipment');
        $this->assertArrayNotHasKey('actual_booking_cost', $customer);
        $this->assertArrayNotHasKey('booking_payload', $customer);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $staff = $this->getJson('/api/admin/orders/'.$this->order->id)->assertOk()->json('data.courier_shipment');
        $this->assertSame($customer['events'], $staff['events']);
        $this->assertSame('delivered', $staff['status']);
    }

    public function test_a_webhook_before_booking_response_does_not_get_downgraded_and_pending_pickup_can_be_cancelled(): void
    {
        $this->earlyWebhook = true;
        $this->book();
        $shipment = CourierShipment::firstOrFail();
        $this->assertSame('pending_pickup', $shipment->status);
        $body = ['request_key' => (string) Str::uuid()];
        $this->postJson($this->endpoint('cancel'), $body)->assertOk()->assertJsonPath('data.courier_shipment.status', 'cancelled');
        $this->postJson($this->endpoint('cancel'), $body)->assertOk();
        $this->assertNull($shipment->fresh()->active_order_id);
        $this->assertNull($this->order->fresh()->courier_tracking_no);
        $this->assertSame('pending', $this->order->fresh()->lifecycle_status);
        $this->assertSame('pending', $this->order->fresh()->payment->status);
        $this->earlyWebhook = false;
        $this->book();
        $this->assertDatabaseCount('courier_shipments', 2);
    }

    public function test_duplicate_tracking_error_can_be_linked_honestly_then_confirmed_by_a_webhook(): void
    {
        $this->mode = 'duplicate';
        $this->legacyBook($this->parcel())->assertConflict();
        $shipment = CourierShipment::firstOrFail();
        $this->assertSame('booking_unknown', $shipment->status);
        $tracking = 'PREFIX'.$shipment->requested_tracking_number;
        $this->postJson($this->endpoint('link-tracking'), ['tracking_number' => 'OTHER123456'])->assertUnprocessable();
        $this->postJson($this->endpoint('link-tracking'), ['tracking_number' => $tracking])->assertOk()->assertJsonPath('data.courier_shipment.status', 'tracking_linked');
        $this->hook($tracking, $shipment->reference, 'Pending Pickup', now()->toIso8601String())->assertOk();
        $this->assertSame('pending_pickup', $shipment->fresh()->status);
    }

    public function test_rejected_booking_can_be_corrected_or_discarded_without_cancelling_the_customer_order(): void
    {
        $this->mode = 'reject';
        $this->legacyBook($this->parcel())->assertConflict();
        $this->assertSame('booking_failed', CourierShipment::first()->status);
        Http::recorded();
        $this->postJson($this->endpoint('cancel'), ['request_key' => (string) Str::uuid()])->assertOk();
        $this->assertSame('pending', $this->order->fresh()->lifecycle_status);
        $this->assertSame('cancelled', CourierShipment::first()->status);
    }

    public function test_production_requires_explicit_approval_and_disabled_booking_makes_no_provider_requests(): void
    {
        config(['ninjavan.environment' => 'production', 'ninjavan.production_approved' => false]);
        $this->legacyBook($this->parcel())->assertStatus(503);
        Http::assertNothingSent();
        $this->assertDatabaseCount('courier_shipments', 0);
        config(['ninjavan.environment' => 'sandbox', 'ninjavan.enabled' => false]);
        $this->legacyBook($this->parcel())->assertStatus(503);
        Http::assertNothingSent();
    }

    public function test_active_api_tracking_cannot_be_replaced_by_a_manual_courier_update(): void
    {
        $this->book();
        $this->patchJson('/api/admin/orders/'.$this->order->id.'/tracking', ['courier_name' => 'J&T Express', 'courier_tracking_no' => 'ANOTHER'])->assertUnprocessable();
    }

    public function test_unknown_or_mismatched_webhook_references_do_not_change_an_order_and_returns_stay_separate_from_refunds(): void
    {
        $this->book();
        $shipment = CourierShipment::firstOrFail();
        $this->hook($shipment->tracking_number, 'OTHER-REFERENCE', 'Delivered', now()->toIso8601String())->assertOk();
        $this->assertSame('awaiting_pickup',$shipment->fresh()->status);
        $this->hook($shipment->tracking_number,$shipment->reference,'Delivered',now()->addMinute()->toIso8601String(),true)->assertOk();
        $this->assertSame('returned',$shipment->fresh()->status);
        $this->assertSame('pending',$this->order->fresh()->payment->status);
        $this->assertDatabaseCount('payment_refunds',0);
    }
}
