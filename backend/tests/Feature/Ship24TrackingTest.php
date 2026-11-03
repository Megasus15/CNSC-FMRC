<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\ShipmentTracker;
use App\Models\User;
use App\Services\Ship24Client;
use App\Services\Ship24Exception;
use App\Services\Ship24Tracking;
use App\Support\PaymentMethodAvailability;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class Ship24TrackingTest extends TestCase
{
    use RefreshDatabase;

    private Order $order;

    private User $customer;

    private array $created = [];

    private array $results = [];

    private string $mode = 'ok';

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-03T07:00:00Z'));
        Mail::fake();
        Http::preventStrayRequests();
        config(['ship24.enabled' => true, 'ship24.api_key' => 'fixture-key', 'ship24.webhook_secret' => 'fixture-hook',
            'ship24.monthly_registration_limit' => 10]);
        DB::table('shipment_tracking_settings')->where('id', 1)->update(['enabled' => true, 'carrier_code' => 'fixture-jnt-ph',
            'carrier_verified_at' => now(), 'waybill_verified_at' => now(), 'last_webhook_at' => now(), 'account_fingerprint' => Ship24Client::fingerprint()]);
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
        Http::fake(function ($request) {
            if ($this->mode === 'rate_limit') {
                return Http::response([], 429, ['Retry-After' => '900']);
            }
            $path = parse_url($request->url(), PHP_URL_PATH);
            if ($path === '/public/v1/couriers') {
                return Http::response(['data' => ['couriers' => [
                    ['courierCode' => 'fixture-jnt-ph', 'courierName' => 'J&T Express Philippines', 'countryCode' => 'PH', 'requiredFields' => [], 'isDeprecated' => false],
                    ['courierCode' => 'fixture-jnt-other', 'courierName' => 'J&T Express', 'countryCode' => 'MY', 'requiredFields' => []],
                ]]]);
            }
            if ($request->method() === 'POST' && $path === '/public/v1/trackers') {
                $this->created[] = $request->data();
                if ($this->mode === 'timeout') {
                    throw new ConnectionException('Fixture timeout');
                }
                if ($this->mode === 'quota') {
                    return Http::response(['errors' => [['code' => 'quota_limit_reached']]], 403);
                }

                return Http::response(['data' => ['tracker' => $this->external($request->data())]], 201);
            }
            if (str_ends_with($path, '/results')) {
                return Http::response(['data' => ['trackings' => $this->results]]);
            }
            if ($request->method() === 'PATCH') {
                return Http::response(['data' => ['tracker' => ['isSubscribed' => false]]]);
            }
            if ($this->mode === 'recover') {
                return Http::response(['data' => ['tracker' => $this->external($this->created[0])]]);
            }

            return Http::response(['errors' => [['code' => 'not_found']]], 404);
        });
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

    private function external(array $payload): array
    {
        return ['trackerId' => 'provider-'.$payload['clientTrackerId'], 'clientTrackerId' => $payload['clientTrackerId'],
            'shipmentReference' => $payload['shipmentReference'], 'trackingNumber' => $payload['trackingNumber']];
    }

    private function update(ShipmentTracker $tracker, string $status = 'in_transit', string $id = 'event-1', ?string $date = null): array
    {
        return ['metadata' => ['messageId' => (string) Str::uuid(), 'topic' => 'tracking/events'], 'tracker' => $this->external($tracker->registration_payload),
            'shipment' => ['destinationCountryCode' => 'PH'], 'events' => [['eventId' => $id, 'status' => 'Courier scan', 'statusMilestone' => $status,
                'courierCode' => 'fixture-jnt-ph', 'occurrenceDatetime' => $date ?? now()->toIso8601String(), 'location' => 'Daet hub', 'order' => 1]]];
    }

    private function hook(array $updates, string $secret = 'fixture-hook')
    {
        return $this->postJson('/api/webhooks/ship24', ['trackings' => $updates], ['Authorization' => 'Bearer '.$secret]);
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
        config(['ship24.enabled' => false]);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->record();
        $this->artisan('shipments:process')->assertSuccessful();
        $this->getJson('/api/admin/orders/'.$this->order->id)->assertOk()->assertJsonPath('data.courier_shipment.tracking_available', false);
        Http::assertNothingSent();
    }

    public function test_timeout_recovers_the_same_tracker_without_a_second_create(): void
    {
        $tracker = $this->record();
        $this->mode = 'timeout';
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('retry', $tracker->fresh()->registration_state);
        $payload = $tracker->fresh()->registration_payload;
        $this->mode = 'recover';
        Carbon::setTestNow(now()->addMinutes(2));
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('active', $tracker->fresh()->registration_state);
        $this->assertCount(1, $this->created);
        $this->assertSame($payload, $tracker->fresh()->registration_payload);
    }

    public function test_quota_failure_preserves_handover_and_official_tracking_link(): void
    {
        $tracker = $this->record();
        $this->mode = 'quota';
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('limited', $tracker->fresh()->registration_state);
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/customer/orders/'.$this->order->id)->assertOk()->assertJsonPath('data.courier_shipment.tracking_url', 'https://www.jtexpress.ph')
            ->assertJsonPath('data.customer_stage', 'to_receive')->assertJsonPath('data.total_amount', 485);
    }

    public function test_webhook_auth_durable_receipt_deduplication_and_delayed_updates(): void
    {
        $tracker = $this->record();
        app(Ship24Tracking::class)->register($tracker);
        $tracker->refresh();
        $delivered = $this->update($tracker, 'delivered');
        $this->call('HEAD', '/api/webhooks/ship24')->assertOk()->assertContent('');
        $this->get('/api/webhooks/ship24')->assertOk()->assertContent('');
        $this->assertDatabaseCount('shipment_webhook_inbox', 0);
        $this->assertSame('pending', $tracker->fresh()->status);
        $this->postJson('/api/webhooks/ship24', ['trackings' => [$delivered]])->assertUnauthorized();
        $this->hook([$delivered], 'wrong')->assertUnauthorized();
        $this->hook([$delivered])->assertAccepted();
        $this->hook([$delivered])->assertAccepted();
        $this->assertSame('pending', $tracker->fresh()->status);
        $this->assertDatabaseCount('shipment_webhook_inbox', 1);
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('delivered', $tracker->fresh()->status);
        $this->hook([$this->update($tracker, 'in_transit', 'older', now()->subMinute()->toIso8601String())])->assertAccepted();
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('delivered', $tracker->fresh()->status);
        $this->assertSame('pending', $this->order->fresh()->lifecycle_status);
        $this->assertSame('paid', $this->order->payment->fresh()->status);
        $this->assertDatabaseCount('payment_refunds', 0);
        $this->assertDatabaseCount('order_tracking_events', 3);
        $this->assertSame(1, DB::table('shipment_notification_outbox')->where('milestone', 'delivered')->count());
    }

    public function test_batched_early_webhooks_match_client_id_and_unknown_tracker_is_quarantined(): void
    {
        $tracker = $this->record();
        $this->mode = 'timeout';
        $this->artisan('shipments:process')->assertSuccessful();
        $tracker->refresh();
        $valid = $this->update($tracker);
        $unknown = $valid;
        $unknown['metadata']['messageId'] = 'unknown';
        $unknown['tracker']['clientTrackerId'] = (string) Str::uuid();
        $this->hook([$valid, $unknown])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('in_transit', $tracker->fresh()->status);
        $this->assertSame('active', $tracker->fresh()->registration_state);
        $this->assertDatabaseHas('shipment_webhook_inbox', ['state' => 'quarantined']);
    }

    public function test_admin_correction_preserves_history_and_rejects_stale_staff_and_old_callbacks(): void
    {
        $tracker = $this->record();
        app(Ship24Tracking::class)->register($tracker);
        $tracker->refresh();
        $input = $this->input(['tracking_number' => '009876543210', 'expected_version' => $tracker->version, 'correction_reason' => 'Corrected from the branch receipt']);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->patchJson($this->endpoint(), $input)->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->patchJson($this->endpoint(), array_replace($input, ['expected_version' => 99]))->assertConflict();
        $this->patchJson($this->endpoint(), $input)->assertOk();
        $this->hook([$this->update($tracker, 'delivered')])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('009876543210', $this->order->fresh()->courier_tracking_no);
        $this->assertDatabaseCount('shipment_trackers', 2);
        $this->assertSame('pending', ShipmentTracker::latest('id')->first()->status);
        $this->assertNull($tracker->fresh()->active_order_id);
    }

    public function test_refresh_is_rate_limited_and_never_calls_provider_in_the_page_request(): void
    {
        $this->record();
        $this->postJson($this->endpoint().'/refresh')->assertOk();
        $this->postJson($this->endpoint().'/refresh')->assertStatus(429);
        Http::assertNothingSent();
    }

    public function test_date_only_precision_and_event_order_are_preserved_in_customer_timeline(): void
    {
        $tracker = $this->record();
        app(Ship24Tracking::class)->register($tracker);
        $tracker->refresh();
        $first = $this->update($tracker, 'in_transit', 'date-1', '2026-11-03');
        $second = $this->update($tracker, 'out_for_delivery', 'date-2', '2026-11-03');
        $second['events'][0]['order'] = 2;
        $this->hook([$second, $first])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('out_for_delivery', $tracker->fresh()->status);
        Sanctum::actingAs($this->customer);
        $events = collect($this->getJson('/api/customer/orders/'.$this->order->id)->assertOk()->json('data.timeline'))->where('source_label', 'J&T via Ship24');
        $this->assertCount(2, $events);
        $this->assertSame('Nov 3, 2026', $events->first()['occurred_at_label']);
        $this->assertSame('date', $events->first()['time_precision']);
    }

    public function test_activation_requires_matching_account_carrier_waybill_and_webhook_evidence(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => true, 'expected_revision' => 0])->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => true, 'expected_revision' => 0])->assertOk()->assertJsonPath('data.enabled', true);
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => false, 'expected_revision' => 0])->assertConflict();
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => false, 'expected_revision' => 1])->assertOk()->assertJsonPath('data.enabled', false);
        DB::table('shipment_tracking_settings')->where('id', 1)->update(['enabled' => false, 'waybill_verified_at' => null, 'revision' => 0]);
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => true, 'expected_revision' => 0])->assertUnprocessable();
        $this->expectException(ValidationException::class);
        app(Ship24Tracking::class)->verifyCarrier('fixture-jnt-other');
    }

    public function test_new_cod_disabled_and_ninja_booking_retired(): void
    {
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.payment_cash_on_delivery_enabled', '0');
        $this->postJson('/api/admin/orders/'.$this->order->id.'/shipment/book', [])->assertUnprocessable();
        $this->assertFalse(PaymentMethodAvailability::isEnabled('COD'));
        Http::assertNothingSent();
    }

    public function test_payment_receipt_must_match_the_total_and_demo_handover_never_contacts_ship24(): void
    {
        DB::table('payment_receipts')->update(['amount_centavos' => 1]);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        DB::table('payment_receipts')->update(['amount_centavos' => 48500, 'livemode' => false]);
        $this->postJson($this->endpoint(), $this->input())->assertUnprocessable();
        config(['ship24.allow_demo_handover' => true]);
        $tracker = $this->record();
        $this->assertTrue($tracker->demo);
        $this->artisan('shipments:process')->assertSuccessful();
        Http::assertNothingSent();
        $this->assertDatabaseCount('shipment_notification_outbox', 0);
        $this->expectException(ValidationException::class);
        app(Ship24Tracking::class)->verifyWaybill($tracker);
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
        $this->postJson('/api/customer/orders/'.$this->order->id.'/received')->assertOk();
        $this->assertSame('completed', $this->order->fresh()->customer_stage);
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

    public function test_webhook_provider_id_is_sufficient_when_client_id_is_omitted_but_conflicts_are_quarantined(): void
    {
        $tracker = $this->record();
        app(Ship24Tracking::class)->register($tracker);
        $tracker->refresh();
        $event = $this->update($tracker);
        unset($event['tracker']['clientTrackerId']);
        $this->hook([$event])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('in_transit', $tracker->fresh()->status);
        $conflict = $this->update($tracker, 'delivered', 'conflict');
        $conflict['tracker']['trackingNumber'] = 'ANOTHER';
        $this->hook([$conflict])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('in_transit', $tracker->fresh()->status);
        $this->assertTrue($tracker->fresh()->needs_review);
        $this->assertDatabaseHas('shipment_webhook_inbox', ['state' => 'quarantined']);
    }

    public function test_timezone_ordering_and_contradictory_terminal_events_preserve_confirmed_delivery(): void
    {
        $tracker = $this->record();
        app(Ship24Tracking::class)->register($tracker);
        $tracker->refresh();
        $newer = $this->update($tracker, 'delivered', 'delivered', '2026-11-03T14:59:00+08:00');
        $older = $this->update($tracker, 'in_transit', 'older', '2026-11-03T07:00:00+01:00');
        $this->hook([$newer, $older])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('delivered', $tracker->fresh()->status);
        $this->assertSame('2026-11-03T14:59:00+08:00', $tracker->fresh()->last_event_time['raw']);
        $this->hook([$this->update($tracker, 'exception', 'contradiction')])->assertAccepted();
        app(Ship24Tracking::class)->processInbox(microtime(true) + 10);
        $this->assertSame('delivered', $tracker->fresh()->status);
        $this->assertTrue($tracker->fresh()->needs_review);
        $this->assertDatabaseCount('order_tracking_events', 4);
    }

    public function test_reconciliation_waits_six_hours_and_pause_keeps_authenticated_incoming_updates(): void
    {
        $tracker = $this->record();
        $this->artisan('shipments:process')->assertSuccessful();
        $tracker->refresh();
        $this->assertTrue($tracker->next_attempt_at->eq(now()->addHours(6)));
        $requests = count(Http::recorded());
        Carbon::setTestNow(now()->addMinutes(5));
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertCount($requests, Http::recorded());
        config(['ship24.enabled' => false]);
        $this->hook([$this->update($tracker, 'out_for_delivery')])->assertAccepted();
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('out_for_delivery', $tracker->fresh()->status);
        $this->assertCount($requests, Http::recorded());
    }

    public function test_quota_recovery_keeps_the_same_payload_and_rate_limits_use_provider_delay(): void
    {
        $tracker = $this->record();
        $this->mode = 'quota';
        $this->artisan('shipments:process')->assertSuccessful();
        $payload = $tracker->fresh()->registration_payload;
        Carbon::setTestNow(now()->addDay()->addMinute());
        $this->mode = 'ok';
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('active', $tracker->fresh()->registration_state);
        $this->assertSame($payload, $this->created[1]);
        $this->mode = 'rate_limit';
        try {
            app(Ship24Client::class)->couriers();
            $this->fail('Expected rate limit');
        } catch (Ship24Exception $error) {
            $this->assertSame(900, $error->retryAfter);
        }
    }

    public function test_email_failure_retries_without_repeating_in_app_notification(): void
    {
        config(['ship24.enabled' => false]);
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
