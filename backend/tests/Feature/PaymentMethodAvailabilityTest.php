<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\SiteSetting;
use App\Models\User;
use App\Support\PaymentMethodAvailability;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class PaymentMethodAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['payments.gateway' => 'manual', 'payments.gcash.auto_confirm' => false]);
        Mail::fake();
        Http::fake();
    }

    public static function editorRoles(): array
    {
        return [['admin'], ['staff']];
    }

    public static function paymentMethods(): array
    {
        return [['COP'], ['COD'], ['GCash']];
    }

    public static function invalidValues(): array
    {
        return [[null], [''], ['false'], ['true'], ['disabled'], [2], [[]]];
    }

    public function test_public_settings_publish_enabled_defaults_without_creating_rows(): void
    {
        $response = $this->getJson('/api/site-settings')->assertOk();
        foreach (PaymentMethodAvailability::SETTING_KEYS as $key) {
            $response->assertJsonPath('data.'.$key, '1');
            $this->assertDatabaseMissing('site_settings', ['key' => $key]);
        }
    }

    #[DataProvider('editorRoles')]
    public function test_each_editor_can_change_individual_methods_and_enable_or_disable_all(string $role): void
    {
        $this->signIn($role);
        $this->putJson('/api/admin/site-settings', ['payment_gcash_enabled' => false])->assertOk();
        $this->getJson('/api/site-settings')->assertOk()
            ->assertJsonPath('data.payment_gcash_enabled', '0')
            ->assertJsonPath('data.payment_cash_on_pickup_enabled', '1')
            ->assertJsonPath('data.payment_cash_on_delivery_enabled', '1');
        $this->assertSame('0', SiteSetting::get('payment_gcash_enabled'));

        $disabled = [
            'payment_cash_on_pickup_enabled' => false,
            'payment_cash_on_delivery_enabled' => 0,
            'payment_gcash_enabled' => '0',
        ];
        $this->putJson('/api/admin/site-settings', $disabled)->assertOk();
        foreach (array_keys($disabled) as $key) {
            $this->assertSame('0', SiteSetting::get($key));
        }

        $enabled = [
            'payment_cash_on_pickup_enabled' => true,
            'payment_cash_on_delivery_enabled' => 1,
            'payment_gcash_enabled' => '1',
        ];
        $this->putJson('/api/admin/site-settings', $enabled)->assertOk();
        foreach (array_keys($enabled) as $key) {
            $this->assertSame('1', SiteSetting::get($key));
        }
    }

    public function test_customer_and_guest_cannot_change_payment_settings(): void
    {
        $this->putJson('/api/admin/site-settings', ['payment_gcash_enabled' => false])->assertUnauthorized();
        $this->signIn('customer');
        $this->putJson('/api/admin/site-settings', ['payment_gcash_enabled' => false])->assertForbidden();
        $this->assertDatabaseMissing('site_settings', ['key' => 'payment_gcash_enabled']);
    }

    #[DataProvider('invalidValues')]
    public function test_invalid_payment_value_cannot_partially_save_settings(mixed $invalid): void
    {
        $this->signIn('staff');
        SiteSetting::set('hero_title', 'Original title');
        SiteSetting::set('payment_cash_on_pickup_enabled', '1');

        $this->putJson('/api/admin/site-settings', [
            'hero_title' => 'Changed title',
            'payment_cash_on_pickup_enabled' => false,
            'payment_gcash_enabled' => $invalid,
        ])->assertUnprocessable()->assertJsonValidationErrors('payment_gcash_enabled');

        $this->assertSame('Original title', SiteSetting::get('hero_title'));
        $this->assertSame('1', SiteSetting::get('payment_cash_on_pickup_enabled'));
        $this->assertNull(SiteSetting::get('payment_gcash_enabled'));
    }

    public function test_a_write_failure_rolls_back_the_entire_payment_change(): void
    {
        $this->signIn('admin');
        foreach (PaymentMethodAvailability::SETTING_KEYS as $key) {
            SiteSetting::set($key, '1');
        }

        $event = 'eloquent.saving: '.SiteSetting::class;
        Event::listen($event, function (SiteSetting $setting): void {
            if ($setting->key === 'payment_gcash_enabled') {
                throw new RuntimeException('Simulated settings write failure');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->putJson('/api/admin/site-settings', array_fill_keys(array_values(PaymentMethodAvailability::SETTING_KEYS), false));
            $this->fail('The simulated write failure should propagate.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Simulated settings write failure', $exception->getMessage());
        } finally {
            Event::forget($event);
        }

        foreach (PaymentMethodAvailability::SETTING_KEYS as $key) {
            $this->assertSame('1', SiteSetting::get($key));
        }
    }

    public function test_payment_changes_invalidate_public_settings_etag(): void
    {
        $etag = $this->getJson('/api/site-settings')->assertOk()->headers->get('ETag');
        $this->withHeader('If-None-Match', $etag)->getJson('/api/site-settings')->assertStatus(304);
        SiteSetting::set('payment_gcash_enabled', '0');
        $response = $this->withHeader('If-None-Match', $etag)->getJson('/api/site-settings')
            ->assertOk()->assertJsonPath('data.payment_gcash_enabled', '0');
        $this->assertNotSame($etag, $response->headers->get('ETag'));
    }

    #[DataProvider('paymentMethods')]
    public function test_disabled_method_rejects_checkout_without_stock_order_or_provider_side_effects(string $method): void
    {
        $this->signIn('customer');
        $product = $this->makeProduct();
        SiteSetting::set(PaymentMethodAvailability::SETTING_KEYS[$method], '0');
        config(['payments.gateway' => 'paymongo', 'payments.paymongo.secret_key' => 'sk_test_placeholder']);

        $this->postJson('/api/orders', $this->orderPayload($product, $method))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'payment_method_disabled')
            ->assertJsonValidationErrors('payment_method');

        $this->assertSame(10, (int) $product->fresh()->stock);
        foreach (['orders', 'order_items', 'payments', 'order_tracking_events', 'admin_notifications'] as $table) {
            $this->assertDatabaseCount($table, 0);
        }
        Http::assertNothingSent();
        Mail::assertNothingOutgoing();
    }

    #[DataProvider('paymentMethods')]
    public function test_enabled_method_still_places_orders_when_other_methods_are_disabled(string $method): void
    {
        $this->signIn('customer');
        $product = $this->makeProduct();
        foreach (PaymentMethodAvailability::SETTING_KEYS as $candidate => $key) {
            SiteSetting::set($key, $candidate === $method ? '1' : '0');
        }

        $this->postJson('/api/orders', $this->orderPayload($product, $method))->assertCreated();
        $this->assertSame(9, (int) $product->fresh()->stock);
        $this->assertDatabaseHas('orders', ['payment_method' => $method]);
        $this->assertDatabaseHas('payments', ['method' => $method]);
    }

    #[DataProvider('paymentMethods')]
    public function test_disabling_all_methods_blocks_every_new_order(string $method): void
    {
        $this->signIn('customer');
        foreach (PaymentMethodAvailability::SETTING_KEYS as $key) {
            SiteSetting::set($key, '0');
        }
        $this->postJson('/api/orders', $this->orderPayload($this->makeProduct(), $method))
            ->assertUnprocessable()->assertJsonPath('code', 'payment_method_disabled');
        $this->assertDatabaseCount('orders', 0);
    }

    public function test_payment_method_alias_cannot_bypass_disabled_setting(): void
    {
        $this->signIn('customer');
        SiteSetting::set('payment_cash_on_pickup_enabled', '0');
        $this->postJson('/api/orders', $this->orderPayload($this->makeProduct(), 'Cash on pickup'))
            ->assertUnprocessable()->assertJsonPath('code', 'payment_method_disabled');
    }

    public function test_disabling_checkout_does_not_stop_payment_of_an_existing_order(): void
    {
        $this->signIn('customer');
        $this->postJson('/api/orders', $this->orderPayload($this->makeProduct(), 'GCash'))->assertCreated();
        $order = Order::query()->firstOrFail();
        foreach (PaymentMethodAvailability::SETTING_KEYS as $key) {
            SiteSetting::set($key, '0');
        }

        $this->postJson('/api/customer/orders/'.$order->id.'/payment', [
            'payment_reference' => '1234567890123',
        ])->assertOk();
        $this->assertSame('1234567890123', $order->fresh()->payment->reference);
        $this->signIn('staff');
        $this->patchJson('/api/admin/orders/'.$order->id.'/payment-status', [
            'status' => 'paid',
            'confirmed_received' => true,
        ])->assertOk();
        $this->assertSame('paid', $order->fresh()->payment->status);
    }

    public function test_disabling_customer_checkout_does_not_stop_walk_in_orders(): void
    {
        $this->signIn('staff');
        foreach (PaymentMethodAvailability::SETTING_KEYS as $key) {
            SiteSetting::set($key, '0');
        }

        $this->postJson('/api/admin/walkin-orders', [
            'order_no' => 'WALK-PAYMENT-TEST',
            'customer_name' => 'Walk-in Customer',
            'address' => 'Daet, Camarines Norte',
            'contact_number' => '09171234567',
            'client_type' => 'STUDENT',
            'agency_organization' => 'UCN',
            'project_description' => '3D PRINTING',
            'item_detail' => 'Printed prototype',
            'unit' => '1',
            'subtotal_cost' => 500,
            'total' => 500,
        ])->assertCreated();
        $this->assertDatabaseHas('walk_in_orders', [
            'order_no' => 'WALK-PAYMENT-TEST',
            'payment_method' => 'WALKIN VIA CASHIER',
        ]);
    }

    private function signIn(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
    }

    private function makeProduct(): Product
    {
        return Product::create([
            'name' => 'Payment Availability Test Sign',
            'category' => 'Fabrication',
            'code' => 'PAYMENT-TEST',
            'stock' => 10,
            'price' => 500,
            'unit_price' => 500,
        ]);
    }

    private function orderPayload(Product $product, string $method): array
    {
        $payload = [
            'product_id' => $product->id,
            'product_name' => $product->name,
            'quantity' => 1,
            'unit_price' => 500,
            'total_amount' => 500,
            'payment_method' => $method,
            'fulfillment_type' => $method === 'COD' ? 'delivery' : 'pickup',
        ];
        if ($method === 'COD') {
            $payload += [
                'delivery_recipient_name' => 'Test Customer',
                'delivery_contact_no' => '09171234567',
                'delivery_street' => '1 Test Street',
                'delivery_barangay' => 'Barangay 1',
                'delivery_city' => 'Daet',
                'delivery_province' => 'Camarines Norte',
                'delivery_postal_code' => '4600',
            ];
        }

        return $payload;
    }
}
