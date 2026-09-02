<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The dashboard summary must survive a server whose schema is behind the code.
 *
 * A Hostinger deploy copies files and never runs migrations, so production can
 * be missing a table this endpoint reads. summary() used to be one flat run of
 * ~17 queries with no guard: a single failing one returned a 500, and
 * dashboard.js swallows a failed summary and silently falls back to the four
 * legacy count endpoints. The user-visible result was Total Revenue, Total
 * Inventory Items, all four Product Analytics cards and Recent Customer
 * Inquiries shimmering as placeholders forever with no error on screen — a
 * dashboard that "does not load" and never says why.
 *
 * So the contract asserted here is: one unreadable table costs one card, the
 * response still comes back 200, and `availability.sections` names what failed.
 */
class AdminDashboardResilienceTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsAdmin(): User
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_summary_reports_every_section_available_on_a_healthy_schema(): void
    {
        $this->actingAsAdmin();

        $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.availability.sections.complete', true)
            ->assertJsonPath('data.availability.sections.unavailable', []);
    }

    public function test_summary_survives_missing_tables_and_names_the_failed_sections(): void
    {
        $this->actingAsAdmin();

        Product::create([
            'name' => 'Resilience Filament',
            'price' => 500,
            'stock' => 4,
            'stock_status' => 'in_stock',
        ]);

        // Two tables that the 2026-08-24 production upgrade script never
        // mentions, i.e. exactly the shape a behind-schema server has.
        Schema::drop('order_returns');
        Schema::drop('inventory_items');

        $response = $this->getJson('/api/admin/dashboard/summary')->assertOk();

        // The rest of the page is unaffected: a real figure, not a fallback.
        $response->assertJsonPath('data.counts.products', 1);

        $unavailable = $response->json('data.availability.sections.unavailable');
        $this->assertContains('revenue.refunds', $unavailable);
        $this->assertContains('counts.total_inventory_items', $unavailable);
        $response->assertJsonPath('data.availability.sections.complete', false);

        // A degraded section reads as its empty value rather than disappearing,
        // so the card renders a number instead of an endless skeleton.
        $this->assertSame(0, $response->json('data.counts.total_inventory_items'));
        $this->assertIsNumeric($response->json('data.counts.total_revenue'));
    }

    public function test_a_missing_order_items_table_still_leaves_the_counts_and_revenue_intact(): void
    {
        $this->actingAsAdmin();

        $customer = User::factory()->create(['role' => 'customer']);
        Order::create([
            'order_no' => 'ORD-RESILIENCE-001',
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 1,
            'subtotal' => 1250,
            'total' => 1250,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
            'completed_at' => now(),
            'is_archived' => false,
        ]);

        // order_items feeds three of the four analytics cards; dropping it used
        // to take the whole dashboard down with it.
        Schema::drop('order_items');

        $response = $this->getJson('/api/admin/dashboard/summary')->assertOk();

        $response
            ->assertJsonPath('data.counts.orders', 1)
            ->assertJsonPath('data.analytics_summary.top_selling', [])
            ->assertJsonPath('data.analytics_summary.sales_by_category', [])
            ->assertJsonPath('data.analytics_summary.top_performance', []);

        $this->assertSame(1250.0, (float) $response->json('data.counts.total_revenue'));

        // The trend reads Order directly, so it must still be a full 12 months.
        $this->assertCount(12, $response->json('data.analytics_summary.yearly_trend'));

        $unavailable = $response->json('data.availability.sections.unavailable');
        $this->assertContains('analytics.top_selling', $unavailable);
        $this->assertContains('analytics.sales_by_category', $unavailable);
        $this->assertContains('analytics.top_performance', $unavailable);
        $this->assertNotContains('analytics.yearly_trend', $unavailable);
    }

    /**
     * Sales by Category is the one card that has to reach outside order_items,
     * and on the production server it was the only one that failed. It now reads
     * the category in a second query instead of folding it into the aggregate, so
     * an unreadable `products` table costs the card its labels and nothing else:
     * the money still shows, under the label that means "category unknown".
     */
    public function test_the_sales_by_category_card_survives_an_unreadable_products_table(): void
    {
        $this->actingAsAdmin();
        $customer = User::factory()->create(['role' => 'customer']);

        $product = Product::create([
            'name' => 'Resilience Plaque',
            'category' => 'Laser Cut',
            'price' => 650,
            'stock' => 3,
            'stock_status' => 'in_stock',
        ]);

        $order = Order::create([
            'order_no' => 'ORD-CATEGORY-DROP',
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 2,
            'subtotal' => 1300,
            'total' => 1300,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
            'completed_at' => now(),
            'is_archived' => false,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_id' => $product->id,
            'product_name' => 'Resilience Plaque',
            'unit_price' => 650,
            'quantity' => 2,
            'line_total' => 1300,
        ]);

        Schema::withoutForeignKeyConstraints(fn () => Schema::drop('products'));

        $response = $this->getJson('/api/admin/dashboard/summary')->assertOk();

        $response
            ->assertJsonPath('data.analytics_summary.sales_by_category.0.category', 'Deleted / Uncategorized')
            ->assertJsonPath('data.analytics_summary.sales_by_category.0.total_sold', 2);

        $this->assertSame(
            1300.0,
            (float) $response->json('data.analytics_summary.sales_by_category.0.total_revenue'),
        );

        // The card is not on a fallback value — it answered. Only the product
        // count, which genuinely has no table left to count, degrades.
        $unavailable = $response->json('data.availability.sections.unavailable');
        $this->assertNotContains('analytics.sales_by_category', $unavailable);
        $this->assertContains('counts.products', $unavailable);
    }

    /**
     * Production runs LOG_LEVEL=error, which is above the Log::warning safely()
     * writes, so a degraded card used to leave no trace anywhere: the page said
     * "Not available right now" and the server said nothing at all. The reason
     * travels in the response now, on an endpoint that is already admin-only.
     */
    public function test_a_degraded_section_reports_the_drivers_own_message(): void
    {
        $this->actingAsAdmin();

        Schema::drop('inventory_items');

        $reasons = $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->json('data.availability.sections.reasons');

        $this->assertArrayHasKey('counts.total_inventory_items', $reasons);
        $this->assertNotSame('', trim((string) $reasons['counts.total_inventory_items']));
        $this->assertStringContainsStringIgnoringCase('inventory_items', $reasons['counts.total_inventory_items']);
    }
}
