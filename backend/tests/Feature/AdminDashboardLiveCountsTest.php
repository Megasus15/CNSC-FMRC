<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\Payment;
use App\Models\ProductRating;
use App\Models\Promotion;
use App\Models\User;
use App\Models\WalkInOrder;
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

    public function test_dashboard_counts_match_all_eight_unified_archive_modules(): void
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
            'walkins' => 1,
        ];

        $live = $this->getJson('/api/admin/dashboard/live-counts');
        $live->assertOk()
            ->assertJsonPath('data.generated_reports', 0)
            ->assertJsonPath('data.total_archives', 8)
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
            ->assertJsonPath('data.counts.total_archives', 8)
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
            ->assertJsonPath('data.total_archives', 6)
            ->assertJsonPath('data.archives.inventory', 0)
            ->assertJsonPath('data.archives.returns', 0);
    }

    /**
     * Total Revenue = completed orders + approved GCash orders (money already
     * collected online) + walk-in sales - refunds that have been approved
     * onward. A GCash order counts the moment admin/staff approve it, and an
     * approved refund reduces the card even before the money is released.
     */
    public function test_total_revenue_adds_verified_gcash_and_deducts_approved_refunds(): void
    {
        $this->actingAsRole('admin');
        $customer = User::factory()->create(['role' => 'customer']);

        $completed = $this->makeOrder($customer, 'ORD-REV-COMPLETED', [
            'total' => 1000,
            'payment_method' => 'COD',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
        ]);

        // Still pending delivery, but staff have matched the reference inside the
        // FMRC GCash account, so the money is already in the wallet.
        $gcashVerified = $this->makeOrder($customer, 'ORD-REV-GCASH', [
            'total' => 500,
            'payment_method' => 'GCash',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
            'approved_at' => now(),
        ]);
        $this->makePayment($gcashVerified, 'paid');

        // The customer says they sent it and even attached a screenshot, but
        // nobody has found the money yet. A claim is not revenue, so this must
        // not count however far the order has been moved along - and neither
        // does an approved COD order, where the cash arrives on delivery.
        $gcashClaimed = $this->makeOrder($customer, 'ORD-REV-GCASH-UNVERIFIED', [
            'total' => 900,
            'payment_method' => 'GCash',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_pay',
        ]);
        $this->makePayment($gcashClaimed, 'pending');
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

    /**
     * The payment row an order really carries, in the state staff left it in.
     *
     * `paid` is the confirmation staff record once they have found the reference
     * in the FMRC GCash account; `pending` is a customer claim that has not been
     * matched yet. Revenue keys off this row, not off the order's own approval,
     * so the difference is the whole point of the fixture.
     */
    private function makePayment(Order $order, string $status): Payment
    {
        return Payment::create([
            'order_id' => $order->id,
            'payment_no' => 'PAY-'.$order->order_no,
            'method' => $order->payment_method,
            'reference' => '1234567890123',
            'amount' => $order->total,
            'status' => $status,
            'submitted_at' => now(),
            'paid_at' => $status === 'paid' ? now() : null,
        ]);
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
        WalkInOrder::create([
            'order_no' => 'WALK-LIVE-ARCHIVE-001',
            'customer_name' => 'Archived Walk-in Customer',
            'item_detail' => 'Archived Walk-in Item',
            'unit' => '1',
            'subtotal_cost' => 100,
            'order_item' => 'Archived Walk-in Item',
            'order_date' => now(),
            'customer' => 'Archived Walk-in Customer',
            'payment_method' => 'WALKIN VIA CASHIER',
            'total' => 100,
            'status' => 'Completed',
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
