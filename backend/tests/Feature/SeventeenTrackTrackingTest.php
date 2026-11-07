<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\ShipmentTracker;
use App\Models\ShipmentTrackingSubscription as Subscription;
use App\Models\User;
use App\Services\SeventeenTrackClient;
use App\Services\SeventeenTrackException;
use App\Services\SeventeenTrackTracking;
use App\Services\ShipmentTracking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SeventeenTrackTrackingTest extends TestCase
{
    use RefreshDatabase;

    private Order $order;

    private User $customer;

    private array $external = [];

    private array $snapshots = [];

    private string $mode = 'ok';

    private int $registrationCalls = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-07T07:00:00Z'));
        Mail::fake();
        Http::preventStrayRequests();
        config(['track17.api_key' => 'fixture17', 'track17.enabled' => true,
            'track17.registration_limit' => 200]);
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update(['enabled' => true,
            'carrier_code' => '100240', 'account_fingerprint' => SeventeenTrackClient::fingerprint(),
            'carrier_verified_at' => now(), 'waybill_verified_at' => now(), 'last_webhook_at' => now()]);
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->order = Order::create(['order_no' => 'JT17-TEST', 'customer_id' => $this->customer->id,
            'customer_name' => 'Customer', 'customer_contact' => 'fixture@example.test', 'quantity' => 1,
            'subtotal' => 400, 'shipping_fee' => 85, 'shipping_quote' => ['shipping_fee' => 85], 'total' => 485,
            'payment_method' => 'GCash', 'fulfillment_type' => 'delivery', 'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship', 'approved_at' => now()->subHour(), 'courier_name' => 'J&T Express',
            'shipment_tracking_mode' => 'jnt_dropoff', 'delivery_recipient_name' => 'Customer',
            'delivery_contact_no' => '09171234567', 'delivery_street' => '1 Main Street', 'delivery_barangay' => 'Barangay 1',
            'delivery_city' => 'Labo', 'delivery_province' => 'Camarines Norte', 'delivery_postal_code' => '4604']);
        $this->order->forceFill(['created_at' => now()->subDay()])->save();
        $payment = Payment::create(['order_id' => $this->order->id, 'payment_no' => 'PAY-JT17', 'method' => 'GCash',
            'amount' => 485, 'status' => 'paid', 'gateway' => 'paymongo', 'paymongo_payment_id' => 'pay_17fixture', 'paid_at' => now()]);
        $attempt = DB::table('payment_attempts')->insertGetId(['payment_id' => $payment->id, 'token' => (string) Str::uuid(),
            'amount_centavos' => 48500, 'livemode' => true, 'status' => 'paid', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('payment_receipts')->insert(['payment_id' => $payment->id, 'attempt_id' => $attempt,
            'provider_payment_id' => 'pay_17fixture', 'amount_centavos' => 48500, 'livemode' => true,
            'confirmed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'apicarrier.all.json')) {
                return Http::response([['key' => 100240, '_name' => 'J&T Express (PH)', '_country_iso' => 'PH']]);
            }
            if ($this->mode === 'rate') {
                return Http::response([], 429, ['Retry-After' => '900']);
            }
            $item = $request->data()[0];
            $number = $item['number'];
            $error = fn ($code) => Http::response(['code' => 0, 'data' => ['accepted' => [],
                'rejected' => [['number' => $number, 'carrier' => 100240, 'error' => ['code' => $code]]]]]);
            if (str_ends_with($request->url(), '/register')) {
                $this->registrationCalls++;
                if ($this->mode === 'quota') {
                    return $error(-18019908);
                }
                if ($this->mode === 'invalid') {
                    return $error(-18010012);
                }
                if (isset($this->external[$number])) {
                    return $error(-18019901);
                }
                $this->external[$number] = $item;
                if ($this->mode === 'timeout') {
                    throw new ConnectionException('Fixture timeout after registration');
                }
            } elseif (str_ends_with($request->url(), '/gettrackinfo')) {
                if (! isset($this->external[$number])) {
                    return $error(-18019902);
                }
                $item = $this->external[$number] + ['track_info' => $this->snapshots[$number] ?? ['latest_status' => ['status' => 'NotFound']]];
            }

            return Http::response(['code' => 0, 'data' => ['accepted' => [$item], 'rejected' => []]]);
        });
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function service(): SeventeenTrackTracking
    {
        return app(SeventeenTrackTracking::class);
    }

    private function record(string $number = 'JT0026952419687'): ShipmentTracker
    {
        $this->postJson('/api/admin/orders/'.$this->order->id.'/shipment/tracking', [
            'request_key' => (string) Str::uuid(), 'tracking_number' => $number,
            'handed_over_at' => now()->subMinutes(10)->toIso8601String(), 'handover_confirmed' => true,
            'actual_shipping_cost' => 120,
        ])->assertOk()->assertJsonPath('data.customer_stage', 'to_receive');

        return ShipmentTracker::latest('id')->firstOrFail();
    }

    private function registered(): Subscription
    {
        $sub = $this->service()->subscription($this->record());
        $this->service()->register($sub);

        return $sub->fresh();
    }

    private function message(Subscription $sub, string $status = 'InTransit', ?string $time = null): array
    {
        $time ??= now()->toIso8601String();
        $info = ['latest_status' => ['status' => $status], 'tracking' => ['providers' => [[
            'provider' => ['key' => 100240], 'events' => [['time_iso' => $time, 'time_utc' => $time,
                'stage' => $status, 'sub_status' => $status, 'description' => 'J&T scan '.$status.' – Labo', 'location' => 'Labo hub']],
        ]]]];
        $this->snapshots[$sub->tracking_number] = $info;

        return ['event' => 'TRACKING_UPDATED', 'data' => ['number' => $sub->tracking_number, 'carrier' => 100240,
            'tag' => $sub->tag, 'destination_country' => 'PH', 'track_info' => $info]];
    }

    private function hook(array $message, ?string $key = null)
    {
        $raw = json_encode($message, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return $this->call('POST', '/api/webhooks/17track', [], [], [], ['CONTENT_TYPE' => 'application/json',
            'HTTP_SIGN' => hash('sha256', $raw.'/'.($key ?? config('track17.api_key')))], $raw);
    }

    private function drain(): void
    {
        $this->service()->processInbox(microtime(true) + 10);
    }

    public function test_registration_uses_the_complete_waybill_and_server_side_identity_only(): void
    {
        $sub = $this->registered();
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/register') && $r->hasHeader('17token', 'fixture17')
            && $r->data()[0]['number'] === 'JT0026952419687' && $r->data()[0]['carrier'] === 100240
            && $r->data()[0]['destination_postal_code'] === '4604' && $r->data()[0]['destination_country'] === 'PH'
            && $r->data()[0]['ship_date'] === '2026/11/07' && $r->data()[0]['tag'] === $sub->tag);
        $this->assertSame($sub->tracker_id, $sub->active_tracker_id);
        $this->getJson('/api/admin/orders/'.$this->order->id)->assertOk()->assertJsonPath('data.courier_shipment.tracking_provider', '17track');
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'getRealTime') || str_contains($r->url(), 'ship24'));
    }

    public function test_signed_raw_body_is_stored_before_200_then_updates_customer_etag_once(): void
    {
        $sub = $this->registered();
        Sanctum::actingAs($this->customer);
        $etag = $this->getJson('/api/customer/orders/'.$this->order->id)->assertOk()->headers->get('ETag');
        $message = $this->message($sub);
        $this->hook($message)->assertOk();
        $this->hook($message)->assertOk();
        $this->assertDatabaseCount('shipment_webhook_inbox', 1);
        $this->assertSame('pending', $sub->tracker->fresh()->status);
        $this->drain();
        $response = $this->getJson('/api/customer/orders/'.$this->order->id, ['If-None-Match' => $etag])->assertOk()
            ->assertJsonPath('data.courier_shipment.status', 'in_transit')->assertJsonPath('data.customer_stage', 'to_receive');
        $this->assertNotSame($etag, $response->headers->get('ETag'));
        $this->assertCount(1, collect($response->json('data.timeline'))->where('source_label', 'J&T via 17TRACK'));
        $this->assertSame('485.00', $this->order->fresh()->total);
        $this->assertSame('85.00', $this->order->fresh()->shipping_fee);
        $this->assertDatabaseCount('payment_receipts', 1);
        $this->assertDatabaseCount('payment_refunds', 0);
    }

    public function test_invalid_signatures_and_unsigned_posts_cannot_change_readiness(): void
    {
        $sub = $this->registered();
        $this->hook($this->message($sub), 'wrong-key')->assertUnauthorized();
        $this->postJson('/api/webhooks/17track', $this->message($sub))->assertUnauthorized();
        $this->get('/api/webhooks/17track')->assertOk()->assertContent('');
        $this->call('HEAD', '/api/webhooks/17track')->assertOk()->assertContent('');
        $this->assertDatabaseCount('shipment_webhook_inbox', 0);
    }

    public function test_http_200_partial_failures_are_not_registration_success(): void
    {
        $sub = $this->service()->subscription($this->record());
        $this->mode = 'invalid';
        try {
            $this->service()->register($sub);
            $this->fail('Rejected item must fail.');
        } catch (SeventeenTrackException $error) {
            $this->assertSame('details_rejected', $error->reason);
            $this->service()->failed($sub, $error);
        }
        $this->assertNull($sub->fresh()->registered_at);
        $this->assertSame('failed', $sub->fresh()->registration_state);
    }

    public function test_uncertain_registration_recovers_the_same_tag_without_spending_twice(): void
    {
        $sub = $this->service()->subscription($this->record());
        $this->mode = 'timeout';
        try {
            $this->service()->register($sub);
            $this->fail('Expected ambiguous timeout.');
        } catch (SeventeenTrackException $error) {
            $this->assertSame('connection_unknown', $error->reason);
        }
        $payload = $sub->fresh()->registration_payload;
        $this->mode = 'ok';
        $this->service()->register($sub->fresh());
        $this->assertSame($payload, $sub->fresh()->registration_payload);
        $this->assertSame(1, $this->registrationCalls);
        $this->assertSame(1, ShipmentTracking::health()['budget_used']);
    }

    public function test_foreign_existing_registration_is_quarantined_without_retagging_it(): void
    {
        $sub = $this->service()->subscription($this->record());
        $this->external[$sub->tracking_number] = ['number' => $sub->tracking_number, 'carrier' => 100240, 'tag' => 'another-system'];
        try {
            $this->service()->register($sub);
            $this->fail('Foreign tag must not be adopted.');
        } catch (SeventeenTrackException $error) {
            $this->assertSame('response_mismatch', $error->reason);
        }
        $this->assertNull($sub->fresh()->active_tracker_id);
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'changeinfo'));
    }

    public function test_lifetime_budget_includes_diagnostics_and_survives_month_and_key_changes(): void
    {
        config(['track17.registration_limit' => 1]);
        $this->service()->diagnostic('JT-DIAGNOSTIC', '4604');
        $sub = $this->service()->subscription($this->record());
        foreach (['2026-11-07', '2026-12-07'] as $date) {
            Carbon::setTestNow(Carbon::parse($date.'T07:00:00Z'));
            try {
                $this->service()->register($sub);
                $this->fail('Lifetime quota must not reset.');
            } catch (SeventeenTrackException $error) {
                $this->assertSame('quota_limit_reached', $error->reason);
            }
        }
        config(['track17.api_key' => 'rotated-key']);
        $this->assertFalse(ShipmentTracking::enabled());
        $this->service()->verifyCarrier(100240);
        $this->assertSame(1, ShipmentTracking::health()['budget_used']);
        $this->assertSame(0, ShipmentTracking::health()['budget_remaining']);
        $this->assertSame('lifetime', ShipmentTracking::health()['budget_basis']);
    }

    public function test_diagnostics_never_write_customer_history_or_verify_a_real_order(): void
    {
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update(['waybill_verified_at' => null, 'last_webhook_at' => null]);
        $sub = $this->service()->diagnostic('JT-DIAGNOSTIC', '4604');
        $version = $this->order->fresh()->courier_history_version;
        $this->hook($this->message($sub))->assertOk();
        $this->drain();
        $this->assertDatabaseCount('order_tracking_events', 0);
        $this->assertDatabaseCount('shipment_notification_outbox', 0);
        $this->assertSame($version, $this->order->fresh()->courier_history_version);
        $settings = ShipmentTracking::settings();
        $this->assertNull($settings->waybill_verified_at);
        $this->assertNull($settings->last_webhook_at);
        $this->assertNotNull($settings->last_test_webhook_at);
        $this->assertFalse(ShipmentTracking::verified());
    }

    public function test_real_order_api_and_signed_webhook_are_both_required_before_admin_activation(): void
    {
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update(['enabled' => false,
            'waybill_verified_at' => null, 'last_webhook_at' => null]);
        $tracker = $this->record();
        $this->assertFalse($this->service()->verifyWaybill($tracker));
        $sub = Subscription::where('provider', '17track')->firstOrFail();
        $message = $this->message($sub);
        $this->assertTrue($this->service()->verifyWaybill($tracker->fresh()));
        $revision = ShipmentTracking::settings()->revision;
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => true, 'expected_revision' => $revision])->assertUnprocessable();
        $this->hook($message)->assertOk();
        $this->drain();
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => true, 'expected_revision' => $revision])->assertOk()->assertJsonPath('data.enabled', true);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->putJson('/api/admin/shipping-tracking', ['enabled' => false, 'expected_revision' => $revision + 1])->assertForbidden();
    }

    public function test_unfinished_ship24_handover_migrates_only_after_17track_acceptance(): void
    {
        $tracker = $this->record();
        $tracker->update(['provider_tracker_id' => 'old-ship24-id', 'account_fingerprint' => hash('sha256', 'old'),
            'registration_payload' => ['trackingNumber' => $tracker->tracking_number], 'status' => 'in_transit']);
        $old = Subscription::create(['tracker_id' => $tracker->id, 'active_tracker_id' => $tracker->id,
            'provider' => 'ship24', 'tag' => $tracker->client_tracker_id, 'tracking_number' => $tracker->tracking_number,
            'provider_tracker_id' => 'old-ship24-id', 'registration_state' => 'active']);
        $sub = $this->service()->subscription($tracker);
        $this->assertSame($old->id, ShipmentTracking::subscription($tracker)->id);
        $this->service()->register($sub);
        $this->assertNull($old->fresh()->active_tracker_id);
        $this->assertTrue($old->fresh()->stop_pending);
        $this->assertSame($sub->id, ShipmentTracking::subscription($tracker)->id);
        $this->assertSame('old-ship24-id', $tracker->fresh()->provider_tracker_id);
        $this->assertSame('in_transit', $tracker->fresh()->status);
        $this->assertSame('to_receive', $this->order->fresh()->customer_stage);
        $this->assertDatabaseCount('shipment_trackers', 1);
    }

    public function test_unknown_tags_wrong_carriers_and_wrong_destinations_cannot_update_orders(): void
    {
        $sub = $this->registered();
        foreach ([['tag' => 'unknown'], ['carrier' => 999], ['destination_country' => 'MY']] as $change) {
            $message = $this->message($sub);
            $message['data'] = array_replace($message['data'], $change);
            $this->hook($message)->assertOk();
        }
        $this->drain();
        $this->assertSame(3, DB::table('shipment_webhook_inbox')->where('state', 'quarantined')->count());
        $this->assertSame('pending', $sub->tracker->fresh()->status);
    }

    public function test_other_carrier_provider_events_cannot_enter_the_jnt_timeline_via_latest_event(): void
    {
        $sub = $this->registered();
        $message = $this->message($sub, 'Delivered');
        $message['data']['track_info']['tracking']['providers'][0]['provider']['key'] = 999;
        $message['data']['track_info']['latest_event'] = $message['data']['track_info']['tracking']['providers'][0]['events'][0];
        $this->hook($message)->assertOk();
        $this->drain();
        $this->assertSame('pending', $sub->tracker->fresh()->status);
        $this->assertSame('no_events', $sub->fresh()->last_error_code);
        $this->assertSame(0, DB::table('order_tracking_events')->where('event_type', 'courier_update')->count());
    }

    public function test_correction_preserves_history_and_ignores_superseded_callbacks(): void
    {
        $old = $this->registered();
        $this->hook($this->message($old))->assertOk();
        $this->drain();
        $this->patchJson('/api/admin/orders/'.$this->order->id.'/shipment/tracking', [
            'request_key' => (string) Str::uuid(), 'tracking_number' => 'JT-CORRECTED',
            'handed_over_at' => now()->subMinutes(5)->toIso8601String(), 'handover_confirmed' => true,
            'expected_version' => 1, 'correction_reason' => 'Corrected against physical receipt',
        ])->assertOk();
        Carbon::setTestNow(now()->addMinute());
        $this->hook($this->message($old, 'Delivered'))->assertOk();
        $this->drain();
        $this->assertSame(1, DB::table('shipment_webhook_inbox')->where('state', 'ignored')->count());
        $this->assertSame('JT-CORRECTED', $this->order->fresh()->courier_tracking_no);
        $this->assertSame('pending', ShipmentTracker::latest('id')->first()->status);
        $this->assertDatabaseHas('order_tracking_events', ['shipment_tracker_id' => $old->tracker_id, 'event_type' => 'courier_update']);
    }

    public function test_duplicate_snapshots_and_late_events_do_not_repeat_milestones_or_regress_delivery(): void
    {
        $sub = $this->registered();
        $this->hook($this->message($sub, 'Delivered'))->assertOk();
        $this->artisan('shipments:process')->assertSuccessful();
        Carbon::setTestNow(now()->addMinute());
        $this->hook($this->message($sub, 'Delivered', now()->subMinute()->toIso8601String()))->assertOk();
        $this->hook($this->message($sub, 'InTransit', now()->subHours(1)->toIso8601String()))->assertOk();
        $this->hook($this->message($sub, 'InTransit'))->assertOk();
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('delivered', $sub->tracker->fresh()->status);
        $this->assertTrue($sub->tracker->fresh()->needs_review);
        $this->assertSame(1, DB::table('shipment_notification_outbox')->where('milestone', 'delivered')->count());
        $this->assertSame(1, DB::table('customer_notifications')->where('event_key', 'shipment:'.$sub->tracker_id.':delivered')->count());
        $this->assertSame('pending', $this->order->fresh()->lifecycle_status);
        $this->assertSame('to_receive', $this->order->fresh()->customer_stage);
    }

    public function test_date_only_events_and_tracking_stop_preserve_last_confirmed_status(): void
    {
        $sub = $this->registered();
        $message = $this->message($sub);
        $event = &$message['data']['track_info']['tracking']['providers'][0]['events'][0];
        $event['time_raw'] = ['date' => '2026-11-07', 'time' => null, 'timezone' => null];
        $this->hook($message)->assertOk();
        $this->drain();
        $this->assertSame('date', $sub->tracker->fresh()->last_event_time['precision']);
        $this->hook(['event' => 'TRACKING_STOPPED', 'data' => ['number' => $sub->tracking_number, 'carrier' => 100240, 'tag' => $sub->tag]])->assertOk();
        $this->drain();
        $this->assertSame('stopped', $sub->fresh()->registration_state);
        $this->assertSame('in_transit', $sub->tracker->fresh()->status);
        $this->getJson('/api/admin/orders/'.$this->order->id)->assertOk()->assertJsonPath('data.courier_shipment.tracking_available', false);
    }

    public function test_standard_reconciliation_and_manual_refresh_never_force_paid_carrier_queries(): void
    {
        $sub = $this->registered();
        $this->message($sub);
        $this->service()->synchronize($sub);
        $this->drain();
        $before = count(Http::recorded());
        Carbon::setTestNow(now()->addHours(5));
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertCount($before, Http::recorded());
        $this->postJson('/api/admin/orders/'.$this->order->id.'/shipment/tracking/refresh')->assertOk();
        $this->postJson('/api/admin/orders/'.$this->order->id.'/shipment/tracking/refresh')->assertStatus(429);
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertGreaterThan($before, count(Http::recorded()));
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'getRealTime') || str_contains($r->url(), '/push'));
    }

    public function test_worker_excludes_ineligible_orders_and_respects_provider_backoff(): void
    {
        $sub = $this->registered();
        $this->mode = 'rate';
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('rate_limited', $sub->fresh()->last_error_code);
        $before = count(Http::recorded());
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertCount($before, Http::recorded());
        $this->order->update(['lifecycle_status' => 'cancelled']);
        Carbon::setTestNow(now()->addHours(7));
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertCount($before, Http::recorded());
    }

    public function test_additive_migration_backfills_legacy_provider_identity_without_altering_orders(): void
    {
        $tracker = $this->record();
        $tracker->update(['provider_tracker_id' => 'historical-id', 'account_fingerprint' => hash('sha256', 'legacy'),
            'registration_payload' => ['trackingNumber' => $tracker->tracking_number], 'registered_at' => now()]);
        $migration = require database_path('migrations/2026_11_07_000001_add_17track_subscriptions.php');
        $migration->down();
        $migration->up();
        $old = Subscription::where('tracker_id', $tracker->id)->firstOrFail();
        $this->assertSame('ship24', $old->provider);
        $this->assertSame('historical-id', $old->provider_tracker_id);
        $this->assertSame($tracker->id, $old->active_tracker_id);
        $this->assertSame($tracker->client_tracker_id, $old->tag);
        $this->assertFalse((bool) ShipmentTracking::settings()->enabled);
        $this->assertSame('to_receive', $this->order->fresh()->customer_stage);
        $this->assertSame('485.00', $this->order->fresh()->total);
    }

    public function test_callback_before_registration_acknowledgement_waits_for_the_same_subscription(): void
    {
        $sub = $this->service()->subscription($this->record());
        $sub->update(['registration_requested_at' => now()]);
        $this->hook($this->message($sub))->assertOk();
        $this->drain();
        $this->assertSame('pending', DB::table('shipment_webhook_inbox')->value('state'));
        $this->assertSame('pending', $sub->tracker->fresh()->status);
        $this->service()->register($sub);
        Carbon::setTestNow(now()->addMinutes(2));
        $this->drain();
        $this->assertSame('processed', DB::table('shipment_webhook_inbox')->value('state'));
        $this->assertSame('in_transit', $sub->tracker->fresh()->status);
        $this->assertSame(1, $this->registrationCalls);
    }

    public function test_paused_tracking_still_processes_signed_callbacks_but_ship24_endpoint_is_removed(): void
    {
        $sub = $this->registered();
        config(['track17.enabled' => false]);
        $before = count(Http::recorded());
        $this->hook($this->message($sub, 'OutForDelivery'))->assertOk();
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame('out_for_delivery', $sub->tracker->fresh()->status);
        $this->assertCount($before, Http::recorded());
        $this->postJson('/api/webhooks/ship24', [])->assertNotFound();
        $this->get('/api/webhooks/ship24')->assertNotFound();
        $this->assertNotContains('ship24:verify', array_keys(Artisan::all()));
    }

    public function test_quota_rejection_reserves_once_and_avoids_repeated_registration_requests(): void
    {
        $tracker = $this->record();
        $this->mode = 'quota';
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame(1, ShipmentTracking::health()['budget_used']);
        $this->assertTrue(ShipmentTracking::health()['quota_limited']);
        $this->assertSame('limited', Subscription::where('tracker_id', $tracker->id)->value('registration_state'));
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame(1, $this->registrationCalls);
        $this->mode = 'ok';
        Carbon::setTestNow(now()->addDay()->addMinute());
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertSame(2, $this->registrationCalls);
        $this->assertSame(1, ShipmentTracking::health()['budget_used']);
        $this->assertSame('active', Subscription::where('tracker_id', $tracker->id)->value('registration_state'));
    }

    public function test_stopping_a_corrected_waybill_never_stops_a_foreign_subscription(): void
    {
        $sub = $this->registered();
        $this->external[$sub->tracking_number]['tag'] = 'another-system';
        $sub->update(['stop_pending' => true]);
        config(['track17.enabled' => false]);
        $this->artisan('shipments:process')->assertSuccessful();
        $this->assertFalse($sub->fresh()->stop_pending);
        $this->assertSame('response_mismatch', $sub->fresh()->last_error_code);
        Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/stoptrack'));
    }

    public function test_missing_stages_use_only_the_latest_scan_and_expiry_preserves_confirmed_information(): void
    {
        $sub = $this->registered();
        $message = $this->message($sub, 'OutForDelivery');
        unset($message['data']['track_info']['tracking']['providers'][0]['events'][0]['stage']);
        $this->hook($message)->assertOk();
        $this->drain();
        $this->assertSame('out_for_delivery', $sub->tracker->fresh()->status);
        $message['data']['track_info'] = ['latest_status' => ['status' => 'Expired']];
        $this->hook($message)->assertOk();
        $this->drain();
        $this->assertSame('stopped', $sub->fresh()->registration_state);
        $this->hook($this->message($sub))->assertOk();
        $this->drain();
        $this->assertSame('stopped', $sub->fresh()->registration_state);
        $this->assertSame('out_for_delivery', $sub->tracker->fresh()->status);
    }
}
