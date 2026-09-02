<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use App\Models\WalkInOrder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Total Revenue used to be a lifetime, unfiltered sum, and two of the three
 * sales cards carried no date predicate at all. Between them that produced the
 * report from the back office: a number that never went down no matter what was
 * archived, and last year's categories sitting beside a "This Day" bar chart.
 *
 * These tests pin both halves — the archive filter on the money, and the shared
 * period window on the cards.
 */
class RevenueAndSalesAnalyticsTest extends TestCase
{
    use RefreshDatabase;

    public function test_archiving_a_completed_order_reduces_total_revenue(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);

        $kept = $this->makeCompletedOrder($customer, 'ORD-ARCH-KEPT', 1000);
        $archived = $this->makeCompletedOrder($customer, 'ORD-ARCH-GONE', 400);

        $this->assertSame(1400.0, $this->reportedRevenue());

        $archived->forceFill(['is_archived' => true, 'archived_at' => now()])->save();

        $this->assertSame(1000.0, $this->reportedRevenue());

        // Restoring it puts the money back, so the filter is the archive flag and
        // nothing else.
        $archived->forceFill(['is_archived' => false, 'archived_at' => null])->save();

        $this->assertSame(1400.0, $this->reportedRevenue());
        $this->assertFalse($kept->fresh()->is_archived);
    }

    public function test_archived_and_cancelled_walk_ins_stop_counting_but_pending_ones_still_do(): void
    {
        $this->actingAsRole('admin');

        // Cash taken at the counter is recorded when it is taken, so the default
        // "Pending" status is real money and has to keep counting.
        $this->makeWalkIn('WALK-REV-PENDING', 300, 'Pending');
        $this->makeWalkIn('WALK-REV-DONE', 200, 'Completed');

        $this->assertSame(500.0, $this->reportedRevenue());

        $this->makeWalkIn('WALK-REV-CANCELLED', 900, 'Cancelled');
        $this->makeWalkIn('WALK-REV-VOIDED', 800, 'voided');
        $this->makeWalkIn('WALK-REV-ARCHIVED', 700, 'Completed', true);

        $this->assertSame(500.0, $this->reportedRevenue());
    }

    public function test_all_three_sales_cards_honour_the_same_period_window(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);
        $product = Product::create([
            'name' => 'Period Filter Widget',
            'category' => '3D Print',
            'code' => 'PF-001',
            'price' => 250,
        ]);

        $today = $this->makeCompletedOrder($customer, 'ORD-PERIOD-TODAY', 250, Carbon::now('Asia/Manila'));
        $this->makeItem($today, $product, 'Period Filter Widget', 1, 250);

        // Same shop, same product, one year ago. This is the row that used to
        // show up under a "This Day" filter.
        $lastYear = $this->makeCompletedOrder(
            $customer,
            'ORD-PERIOD-LASTYEAR',
            7800,
            Carbon::now('Asia/Manila')->subYear(),
        );
        $this->makeItem($lastYear, $product, 'Period Filter Widget', 6, 7800);

        foreach (['top-selling' => 'total_sold', 'sales-by-category' => 'total_sold'] as $endpoint => $key) {
            $day = $this->getJson("/api/admin/product-analytics/{$endpoint}?period=day")->assertOk();
            $this->assertSame(1, (int) $day->json("data.0.{$key}"), "{$endpoint} leaked a row from outside the day");
        }

        $performanceDay = $this->getJson('/api/admin/product-analytics/product-performance?period=day')->assertOk();
        $this->assertCount(1, $performanceDay->json('data'));
        $this->assertSame(1, (int) $performanceDay->json('data.0.total_sold'));
        $this->assertSame(250.0, (float) $performanceDay->json('data.0.total_revenue'));

        // The month window holds today's row only as well: last year's order is
        // in the same calendar month but a different year.
        $this->assertSame(
            1,
            (int) $this->getJson('/api/admin/product-analytics/sales-by-category?period=month')
                ->assertOk()
                ->json('data.0.total_sold'),
        );
    }

    public function test_archived_orders_drop_out_of_the_sales_cards_too(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);
        $product = Product::create([
            'name' => 'Archived Card Widget',
            'category' => 'Laser Cut',
            'code' => 'AC-001',
            'price' => 100,
        ]);

        $order = $this->makeCompletedOrder($customer, 'ORD-CARD-ARCHIVE', 100, Carbon::now('Asia/Manila'));
        $this->makeItem($order, $product, 'Archived Card Widget', 1, 100);

        $this->assertCount(1, $this->getJson('/api/admin/product-analytics/sales-by-category?period=day')->json('data'));

        $order->forceFill(['is_archived' => true, 'archived_at' => now()])->save();

        foreach (['top-selling', 'sales-by-category', 'product-performance'] as $endpoint) {
            $this->assertCount(
                0,
                $this->getJson("/api/admin/product-analytics/{$endpoint}?period=day")->assertOk()->json('data'),
                "{$endpoint} still counted an archived order",
            );
        }
    }

    public function test_items_whose_product_is_gone_are_labelled_deleted_uncategorized(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);

        $deleted = Product::create([
            'name' => 'Discontinued Print',
            'category' => '3D Print',
            'code' => 'DP-001',
            'price' => 500,
        ]);
        $blankCategory = Product::create([
            'name' => 'Category Cleared Print',
            'category' => '',
            'code' => 'CC-001',
            'price' => 300,
        ]);

        $order = $this->makeCompletedOrder($customer, 'ORD-CAT-GONE', 800, Carbon::now('Asia/Manila'));
        // order_items keeps its own product_name and line_total snapshot, so the
        // money survives the product row.
        $this->makeItem($order, $deleted, 'Discontinued Print', 1, 500);
        $this->makeItem($order, $blankCategory, 'Category Cleared Print', 1, 300);

        $deleted->delete();

        $categories = collect(
            $this->getJson('/api/admin/product-analytics/sales-by-category?period=day')->assertOk()->json('data')
        )->keyBy('category');

        // One bucket, not two: NULLIF folds the empty-string category in with the
        // deleted product instead of leaving it a blank slice of its own.
        $this->assertSame(['Deleted / Uncategorized'], $categories->keys()->all());
        $this->assertSame(800.0, (float) $categories['Deleted / Uncategorized']['total_revenue']);
        $this->assertSame(2, (int) $categories['Deleted / Uncategorized']['total_sold']);

        $performance = collect(
            $this->getJson('/api/admin/product-analytics/product-performance?period=day')->assertOk()->json('data')
        );
        $this->assertSame(
            ['Deleted / Uncategorized'],
            $performance->pluck('category')->unique()->values()->all(),
        );

        // The dashboard's own compact card uses the same label, so the two pages
        // cannot disagree about what the bucket is called.
        $this->assertSame(
            'Deleted / Uncategorized',
            $this->getJson('/api/admin/dashboard/summary')
                ->assertOk()
                ->json('data.analytics_summary.sales_by_category.0.category'),
        );
    }

    private function reportedRevenue(): float
    {
        return (float) $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->json('data.counts.total_revenue');
    }

    private function makeCompletedOrder(
        User $customer,
        string $orderNo,
        float $total,
        ?Carbon $completedAt = null,
    ): Order {
        return Order::create([
            'order_no' => $orderNo,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 1,
            'subtotal' => $total,
            'total' => $total,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
            'completed_at' => $completedAt,
            'created_at' => $completedAt,
        ]);
    }

    private function makeItem(
        Order $order,
        Product $product,
        string $name,
        int $quantity,
        float $lineTotal,
    ): OrderItem {
        return OrderItem::create([
            'order_id' => $order->id,
            'product_id' => $product->id,
            'product_name' => $name,
            'unit_price' => $lineTotal / max(1, $quantity),
            'quantity' => $quantity,
            'line_total' => $lineTotal,
        ]);
    }

    private function makeWalkIn(
        string $orderNo,
        float $total,
        string $status,
        bool $archived = false,
    ): WalkInOrder {
        return WalkInOrder::create([
            'order_no' => $orderNo,
            'customer_name' => 'Walk-in Customer',
            'item_detail' => 'Walk-in Item',
            'unit' => '1',
            'subtotal_cost' => $total,
            'order_item' => 'Walk-in Item',
            'order_date' => now(),
            'customer' => 'Walk-in Customer',
            'payment_method' => 'WALKIN VIA CASHIER',
            'total' => $total,
            'status' => $status,
            'is_archived' => $archived,
            'archived_at' => $archived ? now() : null,
        ]);
    }

    private function actingAsRole(string $role): User
    {
        $user = User::factory()->create(['role' => $role]);
        Sanctum::actingAs($user);

        return $user;
    }
}
