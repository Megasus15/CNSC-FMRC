<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\Payment;
use App\Models\User;
use App\Models\WalkInOrder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The /admin/dashboard/revenue endpoint scopes the same four-term money
 * contract as counts.total_revenue to a period window, and hands back the
 * previous window for the hero's ▲/▼ delta. These pin the scoping (each term by
 * its own collection date), the archive filter, the breakdown↔collected
 * identity, the delta math, and the invariant that keeps the two figures
 * honest: period=all must equal the lifetime counts.total_revenue.
 */
class DashboardRevenuePeriodTest extends TestCase
{
    use RefreshDatabase;

    private const TZ = 'Asia/Manila';

    private User $customer;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        // Mid-June, mid-year: "this month" = June, "last month" = May, both 2026.
        Carbon::setTestNow(Carbon::create(2026, 6, 15, 12, 0, 0, self::TZ));

        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $this->customer = User::factory()->create(['role' => 'customer']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_period_all_equals_the_lifetime_total_revenue(): void
    {
        $this->makeCompletedOrder(1000, Carbon::create(2025, 1, 5, 9, 0, 0, self::TZ));
        $this->makeWalkIn(300, 'Pending', Carbon::now(self::TZ));
        $this->makeRefund(100, Carbon::create(2026, 2, 3, 9, 0, 0, self::TZ));

        // 1000 online + 300 walk-in − 100 refund
        $this->assertSame(1200.0, (float) $this->revenue('all')->json('data.period.collected'));

        // The lifetime figure the KPI grid shows must be the exact same number.
        $lifetime = (float) $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()->json('data.counts.total_revenue');
        $this->assertSame(1200.0, $lifetime);
    }

    public function test_all_time_reports_no_previous_window(): void
    {
        $this->makeCompletedOrder(500, Carbon::now(self::TZ));

        $all = $this->revenue('all');
        $this->assertNull($all->json('data.previous'));
        $this->assertSame('none', $all->json('data.change.direction'));
        $this->assertNull($all->json('data.change.percent'));
    }

    public function test_each_term_is_scoped_by_its_own_collection_date(): void
    {
        // This month (June)…
        $this->makeCompletedOrder(1000, Carbon::create(2026, 6, 10, 9, 0, 0, self::TZ));
        $this->makeWalkIn(300, 'Pending', Carbon::create(2026, 6, 12, 9, 0, 0, self::TZ));
        $this->makeRefund(50, Carbon::create(2026, 6, 13, 9, 0, 0, self::TZ));
        // …and last month (May), which the June window must exclude entirely.
        $this->makeCompletedOrder(500, Carbon::create(2026, 5, 10, 9, 0, 0, self::TZ));
        $this->makeWalkIn(200, 'Pending', Carbon::create(2026, 5, 12, 9, 0, 0, self::TZ));
        $this->makeRefund(20, Carbon::create(2026, 5, 13, 9, 0, 0, self::TZ));

        $month = $this->revenue('month');
        $this->assertSame(1000.0, (float) $month->json('data.period.breakdown.online'));
        $this->assertSame(300.0, (float) $month->json('data.period.breakdown.walkins'));
        $this->assertSame(50.0, (float) $month->json('data.period.breakdown.refunds'));
        $this->assertSame(1250.0, (float) $month->json('data.period.collected')); // 1000 + 300 − 50
    }

    public function test_breakdown_sums_to_collected(): void
    {
        $this->makeCompletedOrder(1000, Carbon::create(2026, 6, 10, 9, 0, 0, self::TZ));
        $this->makeWalkIn(300, 'Pending', Carbon::create(2026, 6, 12, 9, 0, 0, self::TZ));
        $this->makeGcashAdvance(800, Carbon::create(2026, 6, 14, 9, 0, 0, self::TZ));
        $this->makeRefund(50, Carbon::create(2026, 6, 13, 9, 0, 0, self::TZ));

        $period = $this->revenue('month')->json('data.period');
        $b = $period['breakdown'];
        $sum = $b['online'] + $b['gcash_advance'] + $b['walkins'] - $b['refunds'];
        $this->assertSame(round((float) $period['collected'], 2), round((float) $sum, 2));
        $this->assertSame(2050.0, (float) $period['collected']); // 1000 + 800 + 300 − 50
    }

    public function test_previous_period_drives_the_delta(): void
    {
        $this->makeCompletedOrder(1000, Carbon::create(2026, 6, 10, 9, 0, 0, self::TZ)); // June
        $this->makeCompletedOrder(500, Carbon::create(2026, 5, 10, 9, 0, 0, self::TZ));  // May

        $month = $this->revenue('month');
        $this->assertSame(1000.0, (float) $month->json('data.period.collected'));
        $this->assertSame('Last Month', $month->json('data.previous.label'));
        $this->assertSame(500.0, (float) $month->json('data.previous.collected'));
        $this->assertSame(500.0, (float) $month->json('data.change.amount'));
        $this->assertSame(100.0, (float) $month->json('data.change.percent'));
        $this->assertSame('up', $month->json('data.change.direction'));
    }

    public function test_gcash_advance_is_attributed_to_the_payment_paid_at(): void
    {
        $this->makeGcashAdvance(800, Carbon::create(2026, 6, 14, 9, 0, 0, self::TZ)); // June
        $this->makeGcashAdvance(400, Carbon::create(2026, 5, 14, 9, 0, 0, self::TZ)); // May

        $this->assertSame(800.0, (float) $this->revenue('month')->json('data.period.breakdown.gcash_advance'));
    }

    public function test_archived_rows_drop_out_of_the_period_figure(): void
    {
        $order = $this->makeCompletedOrder(1000, Carbon::create(2026, 6, 10, 9, 0, 0, self::TZ));
        $this->assertSame(1000.0, (float) $this->revenue('month')->json('data.period.collected'));

        $order->forceFill(['is_archived' => true, 'archived_at' => now()])->save();
        $this->assertSame(0.0, (float) $this->revenue('month')->json('data.period.collected'));
    }

    // ── helpers ──

    private function revenue(string $period)
    {
        return $this->getJson("/api/admin/dashboard/revenue?period={$period}")->assertOk();
    }

    private function orderNo(string $prefix): string
    {
        return $prefix.'-'.str_pad((string) (++$this->seq), 6, '0', STR_PAD_LEFT);
    }

    private function makeCompletedOrder(float $total, Carbon $completedAt): Order
    {
        return Order::create([
            'order_no' => $this->orderNo('REV'),
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'customer_contact' => $this->customer->email,
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

    private function makeGcashAdvance(float $total, Carbon $paidAt): Order
    {
        $order = Order::create([
            'order_no' => $this->orderNo('GC'),
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'customer_contact' => $this->customer->email,
            'quantity' => 1,
            'subtotal' => $total,
            'total' => $total,
            'payment_method' => 'GCash',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_pay',
            'created_at' => $paidAt,
        ]);

        // The scope keys off a *verified* payment, and the money is attributed to
        // when staff verified it — paid_at, not the order's own timestamps.
        Payment::create([
            'order_id' => $order->id,
            'method' => 'gcash',
            'amount' => $total,
            'status' => 'paid',
            'paid_at' => $paidAt,
        ]);

        return $order;
    }

    private function makeRefund(float $amount, Carbon $refundedAt): OrderReturn
    {
        // A non-completed parent so the refund's own order never counts as
        // online revenue and cancels out the deduction under test. 'rejected'
        // is in every schema variant of the lifecycle enum.
        $parent = Order::create([
            'order_no' => $this->orderNo('RJ'),
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'customer_contact' => $this->customer->email,
            'quantity' => 1,
            'subtotal' => $amount,
            'total' => $amount,
            'payment_method' => 'COD',
            'lifecycle_status' => 'rejected',
            'customer_stage' => 'to_pay',
            'created_at' => $refundedAt->copy()->subDay(),
        ]);

        return OrderReturn::create([
            'return_no' => $this->orderNo('RET'),
            'order_id' => $parent->id,
            'status' => 'refunded',
            'resolution' => 'refund',
            'refunded_amount' => $amount,
            'refunded_at' => $refundedAt,
            'decided_at' => $refundedAt,
        ]);
    }

    private function makeWalkIn(float $total, string $status, Carbon $orderDate): WalkInOrder
    {
        return WalkInOrder::create([
            'order_no' => $this->orderNo('WALK'),
            'customer_name' => 'Walk-in Customer',
            'item_detail' => 'Walk-in Item',
            'unit' => '1',
            'subtotal_cost' => $total,
            'order_item' => 'Walk-in Item',
            'order_date' => $orderDate,
            'customer' => 'Walk-in Customer',
            'payment_method' => 'WALKIN VIA CASHIER',
            'total' => $total,
            'status' => $status,
            'is_archived' => false,
            'archived_at' => null,
        ]);
    }




}
