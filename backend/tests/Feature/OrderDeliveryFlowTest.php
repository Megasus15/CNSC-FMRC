<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\ShipmentTracker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\CommercePolicyFixture;
use Tests\TestCase;

/** Exercises the connected API flow using an isolated database and simulated providers only. */
class OrderDeliveryFlowTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_checkout_payment_approval_handover_tracking_and_customer_receipt_share_one_order(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-03T07:00:00Z'));
        Mail::fake();
        Http::preventStrayRequests();
        config(['payments.gateway' => 'paymongo', 'payments.paymongo.enabled' => true,
            'payments.paymongo.secret_key' => 'sk_live_fixture_for_isolated_tests_only',
            'payments.paymongo.webhook_secret' => 'fixture-payment-hook', 'payments.paymongo.checkout_method' => 'qrph',
            'ship24.enabled' => false, 'ship24.api_key' => 'fixture-tracking-key',
            'ship24.webhook_secret' => 'fixture-tracking-hook', 'ship24.monthly_registration_limit' => 10]);
        $session = [];
        $paid = false;
        $external = [];
        $results = [];
        Http::fake([
            'api.paymongo.com/*' => function ($request) use (&$session, &$paid) {
                if ($request->method() === 'POST' && str_ends_with($request->url(), '/v2/checkout_sessions')) {
                    $attributes = $request['data']['attributes'];
                    $this->assertSame(['qrph'], $attributes['payment_method_types']);
                    $this->assertSame(48500, $attributes['line_items'][0]['amount']);
                    $session = ['id' => 'cs_deliveryfixture', 'attributes' => ['livemode' => true, 'status' => 'active',
                        'checkout_url' => 'https://checkout.paymongo.com/fixture', 'metadata' => $attributes['metadata'], 'payments' => []]];

                    return Http::response(['data' => $session], 201);
                }
                if ($request->method() === 'GET' && str_ends_with($request->url(), '/v1/checkout_sessions/cs_deliveryfixture')) {
                    $current = $session;
                    $current['attributes']['payments'] = $paid ? [['id' => 'pay_deliveryfixture', 'attributes' => [
                        'amount' => 48500, 'currency' => 'PHP', 'livemode' => true, 'status' => 'paid', 'source' => ['type' => 'qrph']]]] : [];

                    return Http::response(['data' => $current]);
                }
                $this->fail('Unexpected payment provider request: '.$request->method().' '.$request->url());
            },
            'api.ship24.com/*' => function ($request) use (&$external, &$results) {
                if (str_ends_with($request->url(), '/couriers')) {
                    return Http::response(['data' => ['couriers' => [['courierCode' => 'fixture-jnt-ph',
                        'courierName' => 'J&T Express Philippines', 'countryCode' => 'PH', 'requiredFields' => [], 'isDeprecated' => false]]]]);
                }
                if ($request->method() === 'POST' && str_ends_with($request->url(), '/trackers')) {
                    $payload = $request->data();
                    $external = ['trackerId' => 'tracker-deliveryfixture', 'trackingNumber' => $payload['trackingNumber'],
                        'clientTrackerId' => $payload['clientTrackerId'], 'shipmentReference' => $payload['shipmentReference']];

                    return Http::response(['data' => ['tracker' => $external]], 201);
                }
                if (str_contains($request->url(), '/results')) {
                    return Http::response(['data' => ['trackings' => $results]]);
                }
                if ($request->method() === 'GET' && str_contains($request->url(), '/trackers/')) {
                    return Http::response(['data' => ['tracker' => $external]]);
                }
                $this->fail('Unexpected tracking provider request: '.$request->method().' '.$request->url());
            },
        ]);

        $customer = User::factory()->create(['role' => 'customer']);
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $product = Product::create(['name' => 'Printed prototype', 'code' => 'DELIVERY-FIXTURE',
            'category' => 'Fabrication', 'price' => 400, 'stock' => 2]);
        Sanctum::actingAs($admin);
        $revision = DB::table('shipping_settings')->value('revision');
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => $revision, 'settings' => [
            'enabled' => true, 'nonworking_weekdays' => [7], 'nonworking_dates' => [], 'zones' => [[
                'id' => (string) Str::uuid(), 'name' => 'Fixture delivery area', 'province' => 'Camarines Norte',
                'cities' => ['Daet'], 'postal_codes' => ['4600'], 'fee' => '85.00',
                'preparation_days' => 1, 'transit_min_days' => 1, 'transit_max_days' => 3]]]])->assertOk();
        $this->postJson('/api/admin/shipping-settings/publish', ['expected_revision' => $revision + 1, 'approved' => true])->assertOk();
        $this->artisan('ship24:verify', ['--carrier' => 'fixture-jnt-ph'])->assertSuccessful();

        Sanctum::actingAs($customer);
        $destination = ['fulfillment_type' => 'delivery', 'delivery_recipient_name' => $customer->name,
            'delivery_contact_no' => '09171234567', 'delivery_street' => '1 Fixture Street',
            'delivery_barangay' => 'Barangay 1', 'delivery_city' => 'Daet',
            'delivery_province' => 'Camarines Norte', 'delivery_postal_code' => '4600'];
        $quote = $this->postJson('/api/shipping/quote', $destination + ['items' => [['product_id' => $product->id, 'quantity' => 1]]])
            ->assertOk()->assertJsonPath('data.payable_total', 485)->json('data');
        $input = $destination + CommercePolicyFixture::acceptance() + ['items' => [[
            'product_id' => $product->id, 'product_name' => $product->name, 'quantity' => 1]],
            'payment_method' => 'GCash', 'shipping_quote_token' => $quote['quote_token'], 'checkout_request_key' => (string) Str::uuid()];
        $created = $this->postJson('/api/orders', $input)->assertCreated()
            ->assertJsonPath('data.payment_status', 'pending')->assertJsonPath('data.total_amount', 485)
            ->assertJsonPath('data.checkout_url', 'https://checkout.paymongo.com/fixture');
        $order = Order::findOrFail($created->json('data.id'));
        $this->postJson('/api/orders', $input)->assertCreated()->assertJsonPath('data.id', $order->id);
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('payment_attempts', 1);
        $this->assertSame(1, $product->fresh()->stock);

        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/orders')->assertOk()->assertJsonFragment(['order_no' => $order->order_no]);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.payment_status', 'pending');
        $handover = ['request_key' => (string) Str::uuid(), 'tracking_number' => '001234567890',
            'handed_over_at' => now()->toIso8601String(), 'handover_confirmed' => true, 'actual_shipping_cost' => 120];
        $endpoint = '/api/admin/orders/'.$order->id.'/shipment/tracking';
        $this->postJson($endpoint, $handover)->assertUnprocessable();

        $paid = true;
        $body = json_encode(['data' => ['id' => 'evt_deliveryfixture', 'attributes' => [
            'type' => 'checkout_session.payment.paid', 'livemode' => true, 'data' => $session]]]);
        $timestamp = time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$body, 'fixture-payment-hook');
        for ($i = 0; $i < 2; $i++) {
            $this->call('POST', '/api/webhooks/paymongo', [], [], [], [
                'CONTENT_TYPE' => 'application/json', 'HTTP_PAYMONGO_SIGNATURE' => 't='.$timestamp.',li='.$signature], $body)->assertOk();
        }
        $this->assertDatabaseCount('payment_receipts', 1);
        $this->assertDatabaseCount('payment_webhook_events', 1);
        $this->assertSame('paid', $order->fresh()->payment->status);
        $this->assertSame('incoming', $order->fresh()->lifecycle_status);
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertOk()->assertJsonPath('data.customer_stage', 'to_ship');
        $this->postJson($endpoint, $handover)->assertOk()->assertJsonPath('data.customer_stage', 'to_receive');
        $this->postJson($endpoint, $handover)->assertOk();
        $this->assertDatabaseCount('shipment_trackers', 1);
        $tracker = ShipmentTracker::firstOrFail();
        $this->artisan('shipments:process')->assertSuccessful();
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/trackers'));

        Sanctum::actingAs($customer);
        $before = $this->getJson('/api/customer/orders/'.$order->id)->assertOk()
            ->assertJsonPath('data.courier_shipment.tracking_number', $handover['tracking_number'])
            ->assertJsonPath('data.courier_shipment.tracking_available', false);
        $etag = $before->headers->get('ETag');
        $this->assertDatabaseHas('customer_notifications', ['user_id' => $customer->id,
            'event_key' => 'shipment:'.$tracker->id.':handover', 'target' => '/home-page/main.html?orders=1&order_id='.$order->id]);
        $this->assertNotNull(DB::table('shipment_notification_outbox')->where('milestone', 'handover')->value('sent_at'));

        // A genuine deployment uses this command only for a real handover. All provider responses here are fixtures.
        $this->artisan('ship24:verify', ['--carrier' => 'fixture-jnt-ph', '--order' => $order->id, '--real-handover' => true])->assertFailed();
        Carbon::setTestNow(now()->addMinutes(1));
        $results = [$this->scan($external, 'in_transit')];
        $this->artisan('ship24:verify', ['--carrier' => 'fixture-jnt-ph', '--order' => $order->id, '--real-handover' => true])->assertSuccessful();
        $this->postJson('/api/webhooks/ship24', ['trackings' => $results], ['Authorization' => 'Bearer fixture-tracking-hook'])->assertAccepted();
        $this->artisan('shipments:process')->assertSuccessful();

        Sanctum::actingAs($admin);
        config(['ship24.enabled' => true]);
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => true,
            'expected_revision' => DB::table('shipment_tracking_settings')->value('revision')])->assertOk()->assertJsonPath('data.enabled', true);
        Sanctum::actingAs($customer);
        $updated = $this->getJson('/api/customer/orders/'.$order->id, ['If-None-Match' => $etag])->assertOk()
            ->assertJsonPath('data.courier_shipment.status', 'in_transit')->assertJsonPath('data.courier_shipment.tracking_available', true);
        $this->assertNotSame($etag, $updated->headers->get('ETag'));

        foreach (['out_for_delivery', 'delivered'] as $status) {
            Carbon::setTestNow(now()->addMinutes(1));
            $update = $this->scan($external, $status);
            for ($i = 0; $i < 2; $i++) {
                $this->postJson('/api/webhooks/ship24', ['trackings' => [$update]], ['Authorization' => 'Bearer fixture-tracking-hook'])->assertAccepted();
            }
            $this->artisan('shipments:process')->assertSuccessful();
            $this->getJson('/api/customer/orders/'.$order->id)->assertOk()->assertJsonPath('data.courier_shipment.status', $status)
                ->assertJsonPath('data.customer_stage', 'to_receive')->assertJsonPath('data.payment_status', 'paid')->assertJsonPath('data.total_amount', 485);
            $this->assertSame(1, DB::table('order_tracking_events')->where('shipment_tracker_id', $tracker->id)->where('provider_event_id', $status)->count());
            $this->assertSame(1, DB::table('customer_notifications')->where('event_key', 'shipment:'.$tracker->id.':'.$status)->count());
        }
        $this->assertSame('pending', $order->fresh()->lifecycle_status);
        $this->postJson('/api/customer/orders/'.$order->id.'/received')->assertOk()->assertJsonPath('data.customer_stage', 'completed');
        $this->assertSame('completed', $order->fresh()->lifecycle_status);
        $this->assertSame('85.00', $order->fresh()->shipping_fee);
        $this->assertSame('120.00', $tracker->fresh()->actual_shipping_cost);
        $this->assertSame(1, $product->fresh()->stock);
        $this->assertDatabaseCount('payment_receipts', 1);
        $this->assertDatabaseCount('payment_refunds', 0);
        foreach (['https://api.paymongo.com/v2/checkout_sessions', 'https://api.ship24.com/public/v1/trackers'] as $url) {
            $this->assertCount(1, Http::recorded(fn ($request) => $request->method() === 'POST' && $request->url() === $url));
        }
    }

    private function scan(array $external, string $status): array
    {
        return ['metadata' => ['messageId' => 'message-'.$status, 'topic' => 'tracking/events'], 'tracker' => $external,
            'shipment' => ['destinationCountryCode' => 'PH'], 'events' => [['eventId' => $status, 'status' => 'Fixture courier scan',
                'statusMilestone' => $status, 'courierCode' => 'fixture-jnt-ph', 'occurrenceDatetime' => now()->toIso8601String(),
                'location' => 'Fixture hub', 'order' => 1]]];
    }
}
