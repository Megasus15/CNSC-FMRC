<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\ProductRating;
use App\Models\Promotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDashboardLiveCountsTest extends TestCase
{
    use RefreshDatabase;

    public function test_live_counts_require_admin_or_staff_access(): void
    {
        $this->getJson('/api/admin/dashboard/live-counts')->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->getJson('/api/admin/dashboard/live-counts')->assertForbidden();

        foreach (['admin', 'staff'] as $role) {
            $this->actingAsRole($role);
            $response = $this->getJson('/api/admin/dashboard/live-counts');
            $response
                ->assertOk()
                ->assertJsonPath('data.generated_reports', 0);
            $this->assertStringContainsString(
                'no-store',
                (string) $response->headers->get('Cache-Control'),
            );
        }
    }

    public function test_dashboard_counts_match_all_seven_unified_archive_modules(): void
    {
        $admin = $this->actingAsRole('admin');
        $fixtures = $this->makeArchivedFixtures($admin);

        $expected = [
            'inventory' => 1,
            'appointments' => 1,
            'orders' => 1,
            'returns' => 1,
            'ratings' => 1,
            'promotions' => 1,
            'announcements' => 1,
        ];

        $live = $this->getJson('/api/admin/dashboard/live-counts');
        $live->assertOk()
            ->assertJsonPath('data.generated_reports', 0)
            ->assertJsonPath('data.total_archives', 7)
            ->assertJsonPath('data.archives', $expected)
            ->assertJsonPath('data.availability.report_generations', true)
            ->assertJsonPath('data.availability.archives', array_fill_keys(array_keys($expected), true));

        $archives = $this->getJson('/api/admin/archives')->assertOk();
        foreach ($expected as $module => $count) {
            $this->assertCount($count, $archives->json($module));
        }

        $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.counts.generated_reports', 0)
            ->assertJsonPath('data.counts.total_archives', 7)
            ->assertJsonPath('data.counts.archives', $expected);

        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'inventory',
            'ids' => [$fixtures['inventory']->id],
        ])->assertOk();

        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'return',
            'ids' => [$fixtures['return']->id],
        ])->assertOk();

        $this->getJson('/api/admin/dashboard/live-counts')
            ->assertOk()
            ->assertJsonPath('data.total_archives', 5)
            ->assertJsonPath('data.archives.inventory', 0)
            ->assertJsonPath('data.archives.returns', 0);
    }

    /**
     * Total Revenue = completed orders + approved GCash orders (money already
     * collected online) + walk-in sales - refunds that have been approved
     * onward. A GCash order counts the moment admin/staff approve it, and an
     * approved refund reduces the card even before the money is released.
     */
    public function test_total_revenue_adds_approved_gcash_and_deducts_approved_refunds(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);

        $completed = $this->makeOrder($customer, 'ORD-REV-COMPLETED', [
            'total' => 1000,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
        ]);

        // Approved but still pending delivery: GCash is already paid.
        $this->makeOrder($customer, 'ORD-REV-GCASH', [
            'total' => 500,
            'payment_method' => 'GCash',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
            'approved_at' => now(),
        ]);

        // Not approved yet, and a COD order that was approved: neither counts.
        $this->makeOrder($customer, 'ORD-REV-GCASH-UNAPPROVED', [
            'total' => 900,
            'payment_method' => 'GCash',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_pay',
        ]);
        $this->makeOrder($customer, 'ORD-REV-COD-APPROVED', [
            'total' => 700,
            'payment_method' => 'COD',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
            'approved_at' => now(),
        ]);

        $this->assertReportedRevenue(1500.0);

        // Approved refund, money not released yet: still deducts, using the
        // approved amount because refunded_amount is null until release.
        OrderReturn::create([
            'return_no' => 'RTN-REV-APPROVED',
            'order_id' => $completed->id,
            'customer_id' => $customer->id,
            'status' => 'approved',
            'reason' => 'damaged',
            'resolution' => 'refund',
            'requested_amount' => 400,
            'approved_amount' => 250,
            'decided_at' => now(),
        ]);

        $this->assertReportedRevenue(1250.0);

        // Released refund uses refunded_amount instead.
        OrderReturn::create([
            'return_no' => 'RTN-REV-REFUNDED',
            'order_id' => $completed->id,
            'customer_id' => $customer->id,
            'status' => 'refunded',
            'reason' => 'damaged',
            'resolution' => 'refund',
            'requested_amount' => 200,
            'approved_amount' => 200,
            'refunded_amount' => 150,
            'decided_at' => now(),
            'refunded_at' => now(),
        ]);

        $this->assertReportedRevenue(1100.0);
    }

    public function test_total_revenue_ignores_returns_that_give_no_money_back(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);
        $order = $this->makeOrder($customer, 'ORD-REV-REPLACEMENT', [
            'total' => 800,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
        ]);

        // Replacement and repair resolutions also carry an approved_amount, and
        // a rejected refund never pays out: none of them may reduce revenue.
        OrderReturn::create([
            'return_no' => 'RTN-REV-REPLACEMENT',
            'order_id' => $order->id,
            'customer_id' => $customer->id,
            'status' => 'approved',
            'reason' => 'damaged',
            'resolution' => 'replacement',
            'requested_amount' => 800,
            'approved_amount' => 800,
            'decided_at' => now(),
        ]);
        OrderReturn::create([
            'return_no' => 'RTN-REV-REPAIR',
            'order_id' => $order->id,
            'customer_id' => $customer->id,
            'status' => 'item_received',
            'reason' => 'damaged',
            'resolution' => 'repair',
            'requested_amount' => 300,
            'approved_amount' => 300,
            'decided_at' => now(),
        ]);
        OrderReturn::create([
            'return_no' => 'RTN-REV-REJECTED',
            'order_id' => $order->id,
            'customer_id' => $customer->id,
            'status' => 'rejected',
            'reason' => 'damaged',
            'resolution' => 'refund',
            'requested_amount' => 500,
            'decided_at' => now(),
        ]);

        $this->assertReportedRevenue(800.0);
    }

    /**
     * JSON encodes 1500.0 as `1500`, so compare numerically rather than with
     * assertJsonPath's strict identity check.
     */
    private function assertReportedRevenue(float $expected): void
    {
        $response = $this->getJson('/api/admin/dashboard/summary')->assertOk();
        $this->assertSame(
            $expected,
            (float) $response->json('data.counts.total_revenue'),
        );
    }

    /** @param array<string, mixed> $attributes */
    private function makeOrder(User $customer, string $orderNo, array $attributes): Order
    {
        return Order::create(array_merge([
            'order_no' => $orderNo,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 1,
            'subtotal' => $attributes['total'] ?? 0,
        ], $attributes));
    }

    /** @return array<string, object> */
    private function makeArchivedFixtures(User $admin): array
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $inventory = InventoryItem::create([
            'category' => 'Office Supplies',
            'item_name' => 'Archived Dashboard Stock',
            'unit' => 'pcs',
            'last_invent' => 2,
            'on_hand' => 2,
            'status' => 'Good',
            'variants' => [],
            'is_archived' => true,
            'archived_at' => now(),
        ]);
        Appointment::create([
            'reference_no' => 'AP-LIVE-ARCHIVE-001',
            'first_name' => 'Archived',
            'last_name' => 'Appointment',
            'status' => 'Archived',
        ]);
        $order = Order::create([
            'order_no' => 'ORD-LIVE-ARCHIVE-001',
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 1,
            'subtotal' => 100,
            'total' => 100,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
            'is_archived' => true,
            'archived_at' => now(),
        ]);
        $item = OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Archived Dashboard Product',
            'unit_price' => 100,
            'quantity' => 1,
            'line_total' => 100,
        ]);
        $return = OrderReturn::create([
            'return_no' => 'RTN-LIVE-ARCHIVE-001',
            'order_id' => $order->id,
            'customer_id' => $customer->id,
            'status' => 'refunded',
            'reason' => 'damaged',
            'resolution' => 'refund',
            'requested_amount' => 100,
            'refunded_amount' => 100,
            'is_archived' => true,
            'archived_at' => now(),
        ]);
        Promotion::create([
            'title' => 'Archived Dashboard Promotion',
            'discount_percent' => 10,
            'scope' => 'all_products',
            'is_enabled' => false,
            'is_archived' => true,
            'archived_at' => now(),
            'created_by' => $admin->id,
        ]);
        Announcement::create([
            'title' => 'Archived Dashboard Announcement',
            'message' => 'Archived dashboard count fixture.',
            'placement' => 'both',
            'is_enabled' => false,
            'is_archived' => true,
            'archived_at' => now(),
            'created_by' => $admin->id,
        ]);
        ProductRating::create([
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'order_item_id' => $item->id,
            'product_name' => $item->product_name,
            'stars' => 5,
            'is_archived' => true,
            'archived_at' => now(),
        ]);

        return compact('inventory', 'return');
    }

    private function actingAsRole(string $role): User
    {
        $persistedRole = $role === 'staff' ? 'admin' : $role;
        $user = User::factory()->create(['role' => $persistedRole]);
        if ($role === 'staff') {
            $user->setAttribute('role', 'staff');
        }
        Sanctum::actingAs($user);

        return $user;
    }
}
