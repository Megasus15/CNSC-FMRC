<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\Service;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RetiredWorkflowCleanupTest extends TestCase
{
    use DatabaseMigrations;

    public function runDatabaseMigrations(): void
    {
        // These tests exercise irreversible DDL. Rebuild the disposable test
        // database between cases instead of rolling back application migrations.
        $this->refreshTestDatabase();
        $this->beforeApplicationDestroyed(static function (): void {
            RefreshDatabaseState::$migrated = false;
        });
    }

    private function cleanup(): object
    {
        return require database_path('migrations/2026_11_05_000001_remove_retired_request_workflow.php');
    }

    private function retiredSchema(): void
    {
        Schema::table('services', fn (Blueprint $table) => $table->boolean('accepts_custom_requests')->default(false));
        Schema::table('report_generations', fn (Blueprint $table) => $table->string('sales_type')->default('all'));
        Schema::create('custom_product_requests', function (Blueprint $table) {
            $table->id();
            $table->string('status')->default('draft');
        });
        Schema::create('custom_product_quotes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
            $table->timestamp('accepted_at')->nullable();
        });
        Schema::create('custom_product_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
        });
        Schema::create('custom_product_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
            $table->foreignId('message_id')->nullable()->constrained('custom_product_messages');
        });
        Schema::create('custom_product_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('custom_product_quote_id')->nullable()->unique()->constrained('custom_product_quotes');
            $table->string('production_status')->nullable();
            $table->timestamp('production_started_at')->nullable();
            $table->timestamp('production_ready_at')->nullable();
        });
    }

    public function test_cleanup_removes_only_retired_records_and_preserves_normal_orders_services_and_uploads(): void
    {
        Storage::fake('local');
        $this->retiredSchema();
        $service = Service::create(['title' => '3D Printing', 'category' => 'Prototyping', 'image_data' => 'keep-image']);
        $customer = User::factory()->create(['role' => 'customer']);
        $order = Order::create(['customer_id' => $customer->id, 'customer_name' => 'Customer', 'quantity' => 1,
            'subtotal' => 100, 'total' => 100, 'payment_method' => 'COD', 'lifecycle_status' => 'pending', 'customer_stage' => 'to_ship']);
        $payment = Payment::create(['order_id' => $order->id, 'payment_no' => 'PAY-KEEP', 'method' => 'GCash', 'gateway' => 'paymongo', 'reference' => 'Keep receipt', 'amount' => 100, 'status' => 'paid', 'paid_at' => now()]);
        $attemptId = DB::table('payment_attempts')->insertGetId(['payment_id' => $payment->id, 'token' => 'f88de84e-e76e-41bc-9f47-90b59a9b5270', 'livemode' => true, 'amount_centavos' => 10000, 'status' => 'paid', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('payment_receipts')->insert(['payment_id' => $payment->id, 'attempt_id' => $attemptId, 'provider_payment_id' => 'pay_keep', 'amount_centavos' => 10000, 'source_type' => 'gcash', 'livemode' => true, 'confirmed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $ordersBefore = DB::table('orders')->get()->map(fn ($row) => (array) $row)->all();
        $paymentsBefore = DB::table('payments')->get()->map(fn ($row) => (array) $row)->all();
        $receiptsBefore = DB::table('payment_receipts')->get()->map(fn ($row) => (array) $row)->all();
        DB::table('custom_product_requests')->insert(['id' => 1, 'status' => 'cancelled']);
        DB::table('custom_product_quotes')->insert(['id' => 1, 'custom_product_request_id' => 1]);
        SiteSetting::set('editorial_services_custom_title', 'Remove this');
        SiteSetting::set('editorial_services_title', 'Keep Services');
        $legacyAdminId = DB::table('admin_notifications')->insertGetId(['type' => 'custom_request', 'title' => 'Test request', 'message' => 'Remove this']);
        $keepAdminId = DB::table('admin_notifications')->insertGetId(['type' => 'order', 'title' => 'Order', 'message' => 'Keep this']);
        $legacyCustomerId = DB::table('customer_notifications')->insertGetId(['user_id' => $customer->id, 'type' => 'custom_request', 'title' => 'Test request', 'message' => 'Remove this', 'target' => '/products-page/product.html?custom_requests=1', 'event_key' => 'custom:1:1', 'published_at' => now()]);
        DB::table('customer_notification_reads')->insert(['user_id' => $customer->id, 'notification_id' => $legacyCustomerId, 'read_at' => now()]);
        DB::table('customer_notifications')->insert(['user_id' => $customer->id, 'type' => 'appointment', 'title' => 'Appointment', 'message' => 'Keep this', 'target' => '/home-page/main.html?my_appointments=1', 'event_key' => 'appointment:1:1', 'published_at' => now()]);
        $subscriptionId = DB::table('pwa_subscriptions')->insertGetId(['app' => 'customer', 'user_id' => $customer->id, 'role' => 'customer', 'endpoint_hash' => hash('sha256', 'test-endpoint'), 'endpoint' => 'https://example.test/push', 'p256dh' => 'test-key', 'auth' => 'test-auth', 'credential_hash' => hash('sha256', 'test-credential'), 'last_seen_at' => now()]);
        foreach (['custom:1:1', 'team:'.$legacyAdminId, 'appointment:1:1'] as $eventKey) {
            DB::table('pwa_delivery_outbox')->insert(['subscription_id' => $subscriptionId, 'event_key' => $eventKey, 'audience' => 'account', 'audience_user_id' => $customer->id, 'payload' => '{}', 'available_at' => now()]);
        }
        foreach (['all', 'regular', 'custom'] as $type) {
            DB::table('report_generations')->insert(['generation_key' => 'test-'.$type, 'generated_by_user_id' => $customer->id, 'generated_by_name' => 'Customer', 'generated_by_role' => 'customer', 'report_code' => 'TEST-'.$type, 'category' => 'sales', 'period' => 'monthly', 'year' => 2026, 'month' => 11, 'sales_type' => $type]);
        }
        DB::table('migrations')->insert(['migration' => '2026_11_04_000001_create_custom_product_workflow', 'batch' => 99]);
        Storage::disk('local')->put('custom-product-designs/test.pdf', 'Remove this');
        Storage::disk('local')->put('appointment-designs/keep.pdf', 'Keep this');

        $this->cleanup()->up();

        foreach (['custom_product_requests', 'custom_product_quotes', 'custom_product_messages', 'custom_product_attachments', 'custom_product_events'] as $table) {
            $this->assertFalse(Schema::hasTable($table));
        }
        $this->assertFalse(Schema::hasColumn('orders', 'custom_product_quote_id'));
        $this->assertFalse(Schema::hasColumn('services', 'accepts_custom_requests'));
        $this->assertFalse(Schema::hasColumn('report_generations', 'sales_type'));
        foreach ($ordersBefore as &$row) foreach (['custom_product_quote_id', 'production_status', 'production_started_at', 'production_ready_at'] as $column) unset($row[$column]);
        $this->assertSame($ordersBefore, DB::table('orders')->get()->map(fn ($row) => (array) $row)->all());
        $this->assertSame($paymentsBefore, DB::table('payments')->get()->map(fn ($row) => (array) $row)->all());
        $this->assertSame($receiptsBefore, DB::table('payment_receipts')->get()->map(fn ($row) => (array) $row)->all());
        $this->assertDatabaseHas('services', ['id' => $service->id, 'image_data' => 'keep-image']);
        $this->assertDatabaseHas('site_settings', ['key' => 'editorial_services_title', 'value' => 'Keep Services']);
        $this->assertDatabaseMissing('site_settings', ['key' => 'editorial_services_custom_title']);
        $this->assertDatabaseMissing('admin_notifications', ['id' => $legacyAdminId]);
        $this->assertDatabaseHas('admin_notifications', ['id' => $keepAdminId]);
        $this->assertDatabaseCount('customer_notification_reads', 0);
        $this->assertDatabaseHas('customer_notifications', ['type' => 'appointment']);
        $this->assertDatabaseCount('pwa_delivery_outbox', 1);
        $this->assertDatabaseHas('pwa_delivery_outbox', ['event_key' => 'appointment:1:1']);
        $this->assertDatabaseCount('report_generations', 2);
        $this->assertDatabaseHas('report_generations', ['generation_key' => 'test-regular']);
        Storage::disk('local')->assertMissing('custom-product-designs/test.pdf');
        Storage::disk('local')->assertExists('appointment-designs/keep.pdf');
        $this->cleanup()->up();
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'total' => 100]);
        Sanctum::actingAs($customer);
        $this->getJson('/api/customer/orders')->assertOk();
    }

    public function test_cleanup_stops_before_mutation_when_an_order_uses_the_retired_schema(): void
    {
        Storage::fake('local');
        $this->retiredSchema();
        DB::table('custom_product_requests')->insert(['id' => 1]);
        DB::table('custom_product_quotes')->insert(['id' => 1, 'custom_product_request_id' => 1]);
        $order = Order::create(['customer_name' => 'Keep order', 'quantity' => 1, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'COD']);
        DB::table('orders')->where('id', $order->id)->update(['custom_product_quote_id' => 1]);
        Storage::disk('local')->put('custom-product-designs/keep.pdf', 'Keep this');
        try {
            $this->cleanup()->up();
            $this->fail('A linked order must stop cleanup.');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('Cleanup stopped', $error->getMessage());
        }
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'custom_product_quote_id' => 1, 'total' => 100]);
        $this->assertDatabaseCount('custom_product_requests', 1);
        Storage::disk('local')->assertExists('custom-product-designs/keep.pdf');
    }

    public function test_cleanup_is_safe_when_schema_is_partial_or_already_absent(): void
    {
        Storage::fake('local');
        Schema::table('services', fn (Blueprint $table) => $table->boolean('accepts_custom_requests')->default(false));
        Schema::create('custom_product_requests', fn (Blueprint $table) => $table->id());
        $this->cleanup()->up();
        $this->cleanup()->up();
        $this->assertFalse(Schema::hasTable('custom_product_requests'));
        $this->assertFalse(Schema::hasColumn('services', 'accepts_custom_requests'));
        $this->assertTrue(Schema::hasTable('appointments'));
        $this->assertTrue(Schema::hasTable('payments'));
    }

    public function test_an_accepted_quote_stops_cleanup_even_without_a_linked_order(): void
    {
        Storage::fake('local');
        $this->retiredSchema();
        DB::table('custom_product_requests')->insert(['id' => 1]);
        DB::table('custom_product_quotes')->insert(['id' => 1, 'custom_product_request_id' => 1, 'accepted_at' => now()]);
        try {
            $this->cleanup()->up();
            $this->fail('An accepted quotation must be reviewed.');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('accepted quotation', $error->getMessage());
        }
        $this->assertTrue(Schema::hasColumn('services', 'accepts_custom_requests'));
        $this->assertDatabaseCount('custom_product_quotes', 1);
    }

    public function test_retired_routes_are_gone_while_existing_customer_and_team_pages_are_served(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        foreach (['/api/admin/custom-requests', '/api/customer/custom-requests', '/api/admin/custom-requests-summary', '/products-page/custom-products.html', '/apps/customer/products-page/custom-products.html'] as $url) {
            $this->getJson($url)->assertNotFound();
        }
        foreach (['/api/customer/custom-requests', '/api/admin/custom-requests/1/review', '/api/admin/orders/1/production'] as $url) {
            $this->postJson($url, [])->assertNotFound();
        }
        foreach (['/products-page/custom-products', '/products-page/custom-products.js', '/products-page/custom-products.css', '/apps/customer/products-page/custom-products', '/apps/customer/products-page/custom-products.js'] as $url) {
            $this->get($url)->assertNotFound();
        }
        foreach (['/products-page/product', '/services-page/service', '/admin-page/orders', '/apps/team/staff-page/orders.html'] as $url) {
            $this->get($url)->assertOk();
        }
    }
}
