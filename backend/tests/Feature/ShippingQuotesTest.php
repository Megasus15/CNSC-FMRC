<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
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

class ShippingQuotesTest extends TestCase
{
    use RefreshDatabase;

    private Product $product;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config(['payments.gateway' => 'paymongo', 'payments.paymongo.enabled' => true, 'payments.paymongo.secret_key' => 'sk_test_fixture', 'payments.paymongo.webhook_secret' => 'fixture']);
        Http::fake(['api.paymongo.com/v2/checkout_sessions' => Http::response(['data' => ['id' => 'cs_shipping', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/fixture', 'livemode' => false]]])]);
        Carbon::setTestNow(Carbon::parse('2026-11-06 08:00:00', 'UTC'));
        $this->product = Product::create(['name' => 'Prototype', 'code' => 'SHIPPING-TEST', 'category' => 'Fabrication', 'price' => 123.45, 'stock' => 30]);
        $this->customer = User::factory()->create(['role' => 'customer']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function settings(): array
    {
        return ['enabled' => true, 'nonworking_weekdays' => [6, 7], 'nonworking_dates' => ['2026-11-09'], 'zones' => [
            ['id' => (string) Str::uuid(), 'name' => 'Camarines Norte', 'province' => 'Camarines Norte', 'cities' => [], 'postal_codes' => [],
                'fee' => '85.50', 'preparation_days' => 1, 'transit_min_days' => 1, 'transit_max_days' => 3],
        ]];
    }

    private function publish(?array $settings = null): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $revision = DB::table('shipping_settings')->value('revision');
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => $revision, 'settings' => $settings ?? $this->settings()])->assertOk();
        $this->postJson('/api/admin/shipping-settings/publish', ['expected_revision' => $revision + 1, 'approved' => true])->assertOk();
        Sanctum::actingAs($this->customer);
    }

    private function input(string $fulfillment = 'delivery'): array
    {
        return ['items' => [['product_id' => $this->product->id, 'quantity' => 2]], 'fulfillment_type' => $fulfillment,
            'delivery_province' => 'Camarines Norte', 'delivery_city' => 'Daet', 'delivery_postal_code' => '4600'];
    }

    private function quote(array $changes = []): array
    {
        Sanctum::actingAs($this->customer);

        return $this->postJson('/api/shipping/quote', array_replace($this->input(), $changes))->assertOk()->json('data');
    }

    private function order(array $quote, array $changes = []): array
    {
        return array_replace($this->input(), CommercePolicyFixture::acceptance(), ['items' => [['product_id' => $this->product->id, 'product_name' => 'Untrusted title', 'quantity' => 2, 'unit_price' => 0.01]],
            'payment_method' => 'GCash', 'checkout_request_key' => (string) Str::uuid(), 'shipping_quote_token' => $quote['quote_token'] ?? '',
            'delivery_recipient_name' => 'Client', 'delivery_contact_no' => '09171234567', 'delivery_street' => '1 Test Street', 'delivery_barangay' => 'Barangay 1'], $changes);
    }

    public function test_unconfigured_delivery_is_unavailable_and_pickup_is_zero(): void
    {
        $this->assertFalse($this->quote()['available']);
        $pickup = $this->quote(['fulfillment_type' => 'pickup']);
        $this->assertTrue($pickup['available']);
        $this->assertSame(0, $pickup['shipping_fee']);
        $this->assertNull($pickup['estimated_delivery_from']);
        $this->postJson('/api/orders', $this->order($pickup, ['fulfillment_type' => 'pickup', 'payment_method' => 'COP']))->assertCreated()
            ->assertJsonPath('data.pricing.shipping_fee', 0)->assertJsonPath('data.total_amount', 246.9);
    }

    public function test_city_names_and_postal_codes_can_repeat_across_different_delivery_areas(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $settings = $this->settings();
        $settings['zones'][0]['cities'] = ['San Jose'];
        $settings['zones'][0]['postal_codes'] = ['4400'];
        $other = $settings['zones'][0];
        $other['id'] = (string) Str::uuid();
        $other['name'] = 'Another delivery area';
        $other['province'] = 'Camarines Sur';
        $settings['zones'][] = $other;
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $settings])->assertOk();
        $this->postJson('/api/admin/shipping-settings/publish', ['expected_revision' => 1, 'approved' => true])->assertOk();
    }

    public function test_duplicate_entries_within_one_area_have_readable_validation_messages(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $settings = $this->settings();
        $settings['zones'][0]['postal_codes'] = ['4604', '4604'];
        // Dotted validation keys are literal JSON keys, not nested objects.
        $response = $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $settings])->assertUnprocessable();
        $this->assertSame('Delivery area 1 has a repeated postal code. Enter each postal code only once.', $response->json('errors')['settings.zones.0.postal_codes.0'][0]);
        $settings['zones'][0]['postal_codes'] = ['4604'];
        $settings['zones'][0]['cities'] = ['Labo', 'LABO'];
        $response = $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $settings])->assertUnprocessable();
        $this->assertSame('Delivery area 1 has a repeated city or municipality. Enter each name only once.', $response->json('errors')['settings.zones.0.cities.0'][0]);
        $this->assertNull(DB::table('shipping_settings')->value('draft'));
    }

    public function test_admin_drafts_do_not_activate_rates_and_staff_reads_only_published_values(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->getJson('/api/admin/shipping-settings')->assertOk()->assertJsonPath('data.has_saved_draft', false);
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $this->settings()])->assertOk()->assertJsonPath('data.has_saved_draft', true);
        $this->assertFalse($this->quote()['available']);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->getJson('/api/admin/shipping-settings')->assertOk()->assertJsonMissingPath('data.draft')->assertJsonMissingPath('data.has_saved_draft')->assertJsonPath('data.can_edit', false);
        $this->putJson('/api/admin/shipping-settings/draft', [])->assertForbidden();
        $this->postJson('/api/admin/shipping-settings/publish', [])->assertForbidden();
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/admin/shipping-settings')->assertForbidden();
    }

    public function test_fee_is_per_order_and_estimates_skip_weekends_and_nonworking_dates(): void
    {
        $this->publish();
        $quote = $this->quote();
        $this->assertEquals(246.90, $quote['item_subtotal']);
        $this->assertEquals(85.50, $quote['shipping_fee']);
        $this->assertEquals(332.40, $quote['payable_total']);
        $this->assertSame('2026-11-11', $quote['estimated_delivery_from']);
        $this->assertSame('2026-11-13', $quote['estimated_delivery_to']);
        $larger = $this->quote(['items' => [['product_id' => $this->product->id, 'quantity' => 4]]]);
        $this->assertEquals(85.50, $larger['shipping_fee']);
    }

    public function test_rate_edits_and_deletions_publish_fresh_snapshots_and_can_disable_the_last_area(): void
    {
        $settings = $this->settings();
        $settings['zones'][0]['cities'] = ['Daet'];
        $other = $settings['zones'][0];
        $other['id'] = (string) Str::uuid();
        $other['name'] = 'Labo';
        $other['cities'] = ['Labo'];
        $settings['zones'][] = $other;
        $this->publish($settings);
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $shown = $this->getJson('/api/admin/shipping-settings')->assertOk();
        $this->assertTrue($shown->headers->hasCacheControlDirective('no-store'));
        $this->assertTrue($shown->headers->hasCacheControlDirective('private'));
        $shown->assertHeader('Vary', 'Authorization');
        $settings['zones'][0]['fee'] = '99.50';
        array_pop($settings['zones']);
        $saved = $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => $shown->json('data.revision'), 'settings' => $settings])
            ->assertOk()->assertJsonCount(1, 'data.draft.zones')->assertJsonCount(2, 'data.published.zones');
        $this->assertTrue($saved->headers->hasCacheControlDirective('no-store'));
        $this->assertEquals(85.50, $this->quote()['shipping_fee']);
        Sanctum::actingAs($admin);
        $published = $this->postJson('/api/admin/shipping-settings/publish', ['expected_revision' => $saved->json('data.revision'), 'approved' => true])
            ->assertOk()->assertJsonCount(1, 'data.published.zones')->assertJsonPath('data.published.zones.0.fee', '99.50');
        $this->assertTrue($published->headers->hasCacheControlDirective('no-store'));
        $this->assertEquals(99.50, $this->quote()['shipping_fee']);
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $staff = $this->getJson('/api/admin/shipping-settings')->assertOk()->assertJsonCount(1, 'data.published.zones')
            ->assertJsonMissingPath('data.draft')->assertJsonPath('data.published.zones.0.fee', '99.50');
        $this->assertTrue($staff->headers->hasCacheControlDirective('no-store'));
        Sanctum::actingAs($admin);
        $settings['enabled'] = false;
        $settings['zones'] = [];
        $removed = $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => $published->json('data.revision'), 'settings' => $settings])->assertOk();
        $this->postJson('/api/admin/shipping-settings/publish', ['expected_revision' => $removed->json('data.revision'), 'approved' => true])
            ->assertOk()->assertJsonPath('data.published.enabled', false)->assertJsonPath('data.published.zones', []);
        $this->assertFalse($this->quote()['available']);
        $this->assertTrue($this->quote(['fulfillment_type' => 'pickup'])['available']);
        $this->assertSame(0, $this->quote(['fulfillment_type' => 'pickup'])['shipping_fee']);
    }

    public function test_order_snapshots_survive_new_rates_and_all_portals_agree(): void
    {
        $this->publish();
        $quote = $this->quote();
        $payload = $this->order($quote);
        $this->postJson('/api/orders', array_replace($payload, ['courier_name' => 'Customer supplied courier', 'courier_tracking_no' => 'FAKE12345']))
            ->assertUnprocessable()->assertJsonValidationErrors(['courier_name', 'courier_tracking_no']);
        $result = $this->postJson('/api/orders', $payload)->assertCreated()->assertJsonPath('data.pricing.shipping_fee', 85.5)->assertJsonPath('data.total_amount', 332.4);
        $id = $result->json('data.id');
        $this->assertDatabaseHas('orders', ['id' => $id, 'courier_name' => 'J&T Express', 'courier_tracking_no' => null, 'shipment_tracking_mode' => 'jnt_dropoff']);
        $this->assertDatabaseHas('orders', ['id' => $id, 'subtotal' => 246.90, 'total' => 332.40, 'shipping_fee' => 85.50]);
        $this->assertDatabaseHas('payments', ['order_id' => $id, 'amount' => 332.40]);
        $this->postJson('/api/orders', $payload)->assertCreated()->assertJsonPath('data.id', $id);
        Carbon::setTestNow(now()->addMinutes(16));
        $this->postJson('/api/orders', $payload)->assertCreated()->assertJsonPath('data.id', $id);
        $settings = $this->settings();
        $settings['zones'][0]['fee'] = '120.00';
        $this->publish($settings);
        $customer = $this->getJson('/api/customer/orders/'.$id)->assertOk()->json('data.pricing');
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonPath('data.0.pricing.shipping_fee', 85.5);
        foreach (['admin', 'staff'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            $admin = $this->getJson('/api/admin/orders/'.$id)->assertOk()->json('data.pricing');
            $this->assertSame($customer, $admin);
        }
        $this->assertSame(30, $this->product->fresh()->stock); // Submitted requests do not reserve inventory.
    }

    public function test_quote_tampering_expiry_owner_destination_and_quantity_changes_are_rejected_without_writes(): void
    {
        $this->publish();
        $quote = $this->quote();
        foreach ([
            ['shipping_quote_token' => $quote['quote_token'].'tampered'],
            ['delivery_city' => 'Labo'],
            ['items' => [['product_id' => $this->product->id, 'product_name' => 'Prototype', 'quantity' => 3]]],
        ] as $changes) {
            $this->postJson('/api/orders', $this->order($quote, $changes))->assertConflict()->assertJsonPath('code', 'shipping_quote_stale');
        }
        $this->customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/orders', $this->order($quote))->assertConflict();
        $quote = $this->quote();
        Carbon::setTestNow(now()->addMinutes(16));
        $this->postJson('/api/orders', $this->order($quote))->assertConflict();
        $this->assertDatabaseCount('orders', 0);
        $this->assertSame(30, $this->product->fresh()->stock);
    }

    public function test_catalog_price_and_published_version_changes_require_review(): void
    {
        $this->publish();
        $quote = $this->quote();
        $this->product->update(['price' => 150]);
        $this->postJson('/api/orders', $this->order($quote))->assertConflict()->assertJsonPath('quote.item_subtotal', 300);
        $quote = $this->quote();
        $this->publish();
        $this->postJson('/api/orders', $this->order($quote))->assertConflict()->assertJsonPath('code', 'shipping_quote_stale');
    }

    public function test_specific_zones_win_and_unconfigured_destinations_are_not_free_delivery(): void
    {
        $settings = $this->settings();
        $specific = $settings['zones'][0];
        $specific['id'] = (string) Str::uuid();
        $specific['cities'] = ['Daet'];
        $specific['postal_codes'] = ['4600'];
        $specific['fee'] = '45.00';
        $settings['zones'][] = $specific;
        $this->publish($settings);
        $this->assertEquals(45, $this->quote()['shipping_fee']);
        $quote = $this->quote(['delivery_province' => 'Albay']);
        $this->assertFalse($quote['available']);
        $this->assertNull($quote['payable_total']);
    }

    public function test_invalid_calendars_overlaps_and_stale_settings_cannot_be_published(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $settings = $this->settings();
        $settings['nonworking_weekdays'] = [1, 2, 3, 4, 5, 6, 7];
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $settings])->assertUnprocessable();
        $settings = $this->settings();
        $other = $settings['zones'][0];
        $other['id'] = (string) Str::uuid();
        $settings['zones'][] = $other;
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $settings])->assertOk();
        $this->postJson('/api/admin/shipping-settings/publish', ['expected_revision' => 1, 'approved' => true])->assertUnprocessable();
        $this->putJson('/api/admin/shipping-settings/draft', ['expected_revision' => 0, 'settings' => $this->settings()])->assertConflict();
    }

    public function test_online_payment_uses_the_same_accepted_payable_total_as_cod(): void
    {
        $this->publish();
        $quote = $this->quote();
        config(['payments.gateway' => 'paymongo', 'payments.paymongo.enabled' => true, 'payments.paymongo.secret_key' => 'sk_test_example', 'payments.paymongo.webhook_secret' => 'secret']);
        Http::preventStrayRequests();
        Http::fake(['api.paymongo.com/v2/checkout_sessions' => function ($request) {
            $this->assertSame(33240, $request['data']['attributes']['line_items'][0]['amount']);

            return Http::response(['data' => ['id' => 'cs_shipping', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/test', 'livemode' => false]]]);
        }]);
        $this->postJson('/api/orders', $this->order($quote, ['payment_method' => 'GCash']))->assertCreated()->assertJsonPath('data.total_amount', 332.4);
        $this->assertDatabaseHas('payments', ['amount' => 332.40]);
    }

    public function test_historical_orders_keep_their_total_without_invented_fees_or_dates(): void
    {
        $order = Order::create(['customer_id' => $this->customer->id, 'customer_name' => 'Client', 'quantity' => 1, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'COD', 'lifecycle_status' => 'incoming', 'customer_stage' => 'to_pay']);
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/customer/orders/'.$order->id)->assertOk()->assertJsonPath('data.total_amount', 100)
            ->assertJsonPath('data.pricing.has_shipping_snapshot', false)->assertJsonPath('data.pricing.shipping_fee', null)
            ->assertJsonPath('data.pricing.estimated_delivery_from', null);
    }

    public function test_manila_midnight_changes_the_estimate_before_a_quote_expires(): void
    {
        $this->publish();
        Carbon::setTestNow(Carbon::parse('2026-11-02 15:55:00', 'UTC'));
        $quote = $this->quote();
        $this->assertSame('2026-11-04', $quote['estimated_delivery_from']);
        Carbon::setTestNow(now()->addMinutes(10));
        $this->postJson('/api/orders', $this->order($quote))->assertConflict()->assertJsonPath('quote.estimated_delivery_from', '2026-11-05');
    }

    public function test_numeric_calendar_inputs_are_canonical_and_client_fee_fields_cannot_lower_the_payable_total(): void
    {
        $settings = $this->settings();
        $settings['nonworking_weekdays'] = ['6', '7'];
        $this->publish($settings);
        $quote = $this->quote();
        $this->postJson('/api/orders', $this->order($quote, ['shipping_fee' => 0, 'total_amount' => 0.01]))->assertCreated()
            ->assertJsonPath('data.total_amount', 332.4)->assertJsonPath('data.pricing.shipping_fee', 85.5);
    }
}
