<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\SiteSetting;
use App\Models\User;
use App\Models\WalkInOrder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminReportsTest extends TestCase
{
    use RefreshDatabase;

    private int $orderSequence = 0;

    private int $walkInSequence = 0;

    private int $returnSequence = 0;

    private int $appointmentSequence = 0;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_reports_require_authentication_and_allow_admin_and_staff_only(): void
    {
        $params = $this->reportParams('sales');

        $this->getJson($this->reportsUrl($params))->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->getJson($this->reportsUrl($params))->assertForbidden();

        foreach (['admin', 'staff'] as $role) {
            $this->actingAsRole($role);

            $response = $this->getJson($this->reportsUrl($params));

            $response->assertOk();
            $this->assertReportContract($response, 'sales', 'monthly');
        }
    }

    public function test_report_query_validation_enforces_category_period_year_and_period_selector(): void
    {
        $this->actingAsRole('admin');

        $this->getJson('/api/admin/reports')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category', 'period', 'year']);

        $this->getJson($this->reportsUrl([
            'category' => 'not-a-report',
            'period' => 'monthly',
            'year' => 2026,
            'month' => 4,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category']);

        $this->getJson($this->reportsUrl([
            'category' => 'sales',
            'period' => 'not-a-period',
            'year' => 2026,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['period']);

        $this->getJson($this->reportsUrl([
            'category' => 'sales',
            'period' => 'monthly',
            'year' => 2026,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['month']);

        $this->getJson($this->reportsUrl([
            'category' => 'sales',
            'period' => 'monthly',
            'year' => 2026,
            'month' => 13,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['month']);

        $this->getJson($this->reportsUrl([
            'category' => 'sales',
            'period' => 'quarterly',
            'year' => 2026,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['quarter']);

        $this->getJson($this->reportsUrl([
            'category' => 'sales',
            'period' => 'quarterly',
            'year' => 2026,
            'quarter' => 5,
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['quarter']);

        $this->getJson($this->reportsUrl([
            'category' => 'inventory',
            'period' => 'yearly',
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['year']);

        $yearly = $this->getJson($this->reportsUrl([
            'category' => 'sales',
            'period' => 'yearly',
            'year' => 2026,
        ]));

        $yearly->assertOk();
        $this->assertReportContract($yearly, 'sales', 'yearly');
    }

    public function test_monthly_sales_include_refunds_by_refunded_at_and_refresh_from_current_data(): void
    {
        $this->actingAsRole('admin');

        $before = $this->makeOrder(
            'completed',
            10,
            '2026-03-31 15:59:59',
            '2026-03-31 15:59:59',
        );
        $online = $this->makeOrder(
            'completed',
            100,
            '2026-03-01 00:00:00',
            '2026-03-31 16:00:00',
        );
        $processing = $this->makeOrder(
            'pending',
            999,
            '2026-04-15 00:00:00',
        );
        $walkInAtStart = $this->makeWalkIn(20, '2026-04-01 00:00:00', 'Pending');
        $lateWalkIn = $this->makeWalkIn(30, '2026-04-30 23:59:59', 'Pending');
        $outsideWalkIn = $this->makeWalkIn(200, '2026-05-01 00:00:00', 'Completed');
        $partialRefund = $this->makeRefund($before, 5, '2026-04-15 00:00:00', 10);
        $outsideRefund = $this->makeRefund($online, 25, '2026-04-30 16:00:00', 100);

        $params = $this->reportParams('sales');
        $first = $this->getJson($this->reportsUrl($params));

        $first->assertOk();
        $this->assertReportContract($first, 'sales', 'monthly');
        $this->assertSame('2026-04-01', $first->json('data.report.start_date'));
        $this->assertSame('2026-04-30', $first->json('data.report.end_date'));
        $this->assertSame(150.0, $this->metricFloat($first, 'gross_sales'));
        $this->assertSame(5.0, $this->metricFloat($first, 'refunds_issued'));
        $this->assertSame(145.0, $this->metricFloat($first, 'net_sales'));
        $this->assertSame(100.0, $this->metricFloat($first, 'online_sales'));
        $this->assertSame(50.0, $this->metricFloat($first, 'walk_in_sales'));
        $this->assertSame(4, $this->metricInt($first, 'total_transactions'));
        $this->assertSame('Sales & Refund Transactions', $first->json('data.table.title'));
        $this->assertTableContains(
            $first,
            $online->order_no,
            $walkInAtStart->order_no,
            $lateWalkIn->order_no,
            $partialRefund->return_no,
        );
        $this->assertTableDoesNotContain(
            $first,
            $before->order_no,
            $processing->order_no,
            $outsideWalkIn->order_no,
            $outsideRefund->return_no,
        );

        $refundRow = collect($first->json('data.table.rows'))
            ->firstWhere('transaction_no', $partialRefund->return_no);
        $this->assertNotNull($refundRow);
        $this->assertSame('Order Refund', $refundRow['source']);
        $this->assertSame(-5.0, (float) $refundRow['amount']);

        $refundSeries = collect($first->json('data.chart.series'))
            ->firstWhere('name', 'Refunds');
        $this->assertIsArray($refundSeries);
        $this->assertSame(-5.0, (float) array_sum($refundSeries['values']));

        $refundBreakdown = collect($first->json('data.breakdown.items'))
            ->firstWhere('label', 'Refunds (Approved & Released)');
        $this->assertIsArray($refundBreakdown);
        $this->assertSame(-5.0, (float) $refundBreakdown['value']);

        $lateWalkInRow = collect($first->json('data.table.rows'))
            ->firstWhere('transaction_no', $lateWalkIn->order_no);
        $this->assertNotNull($lateWalkInRow);
        $this->assertSame('2026-04-30T23:59:59+08:00', $lateWalkInRow['transaction_date']);

        $lastAprilBucket = array_search('Apr 30', $first->json('data.chart.labels'), true);
        $this->assertNotFalse($lastAprilBucket);
        $walkInSeries = collect($first->json('data.chart.series'))
            ->firstWhere('name', 'Walk-in Sales');
        $this->assertSame(30.0, (float) $walkInSeries['values'][$lastAprilBucket]);

        $newWalkIn = $this->makeWalkIn(25, '2026-04-20 08:30:00', 'Pending');
        $second = $this->getJson($this->reportsUrl($params));

        $second->assertOk();
        $this->assertSame(175.0, $this->metricFloat($second, 'gross_sales'));
        $this->assertSame(5.0, $this->metricFloat($second, 'refunds_issued'));
        $this->assertSame(170.0, $this->metricFloat($second, 'net_sales'));
        $this->assertSame(75.0, $this->metricFloat($second, 'walk_in_sales'));
        $this->assertSame(5, $this->metricInt($second, 'total_transactions'));
        $this->assertTableContains($second, $newWalkIn->order_no);
    }

    /**
     * The sales report and the dashboard Total Revenue card share
     * OrderReturn::REVENUE_DEDUCTING_STATUSES, so an approved GCash order counts
     * as revenue and an approved-but-unreleased refund already reduces it. Only
     * 'refund' resolutions may deduct.
     */
    public function test_sales_report_counts_approved_gcash_and_approved_refunds(): void
    {
        $this->actingAsRole('admin');

        // Completed before the window, so it only exists to carry the returns.
        $settled = $this->makeOrder(
            'completed',
            1000,
            '2026-03-01 00:00:00',
            '2026-03-31 15:59:59',
        );

        $gcash = $this->makeApprovedGcashOrder(400, '2026-04-10 00:00:00');

        // Approved, money not released: refunded_at is null so the period window
        // has to fall back to decided_at.
        $approvedRefund = $this->makeReturn($settled, [
            'status' => 'approved',
            'resolution' => 'refund',
            'requested_amount' => 90,
            'approved_amount' => 60,
            'decided_at' => '2026-04-12 00:00:00',
        ]);

        // Neither of these gives money back.
        $replacement = $this->makeReturn($settled, [
            'status' => 'approved',
            'resolution' => 'replacement',
            'requested_amount' => 300,
            'approved_amount' => 300,
            'decided_at' => '2026-04-12 00:00:00',
        ]);
        $rejected = $this->makeReturn($settled, [
            'status' => 'rejected',
            'resolution' => 'refund',
            'requested_amount' => 500,
            'decided_at' => '2026-04-12 00:00:00',
        ]);

        $response = $this->getJson($this->reportsUrl($this->reportParams('sales')));
        $response->assertOk();

        $this->assertSame(400.0, $this->metricFloat($response, 'gross_sales'));
        $this->assertSame(60.0, $this->metricFloat($response, 'refunds_issued'));
        $this->assertSame(340.0, $this->metricFloat($response, 'net_sales'));
        $this->assertSame(400.0, $this->metricFloat($response, 'online_sales'));
        $this->assertSame(2, $this->metricInt($response, 'total_transactions'));

        $this->assertTableContains($response, $gcash->order_no, $approvedRefund->return_no);
        $this->assertTableDoesNotContain(
            $response,
            $settled->order_no,
            $replacement->return_no,
            $rejected->return_no,
        );

        $gcashRow = collect($response->json('data.table.rows'))
            ->firstWhere('transaction_no', $gcash->order_no);
        $this->assertNotNull($gcashRow);
        $this->assertSame('Online Order (GCash Paid)', $gcashRow['source']);
        $this->assertSame('Approved', $gcashRow['status']);

        // The row must carry the real return status, not a hardcoded "Refunded".
        $refundRow = collect($response->json('data.table.rows'))
            ->firstWhere('transaction_no', $approvedRefund->return_no);
        $this->assertNotNull($refundRow);
        $this->assertSame('Return Approved', $refundRow['status']);
        $this->assertSame(-60.0, (float) $refundRow['amount']);

        $advanceBreakdown = collect($response->json('data.breakdown.items'))
            ->firstWhere('label', 'Approved GCash Orders');
        $this->assertIsArray($advanceBreakdown);
        $this->assertSame(400.0, (float) $advanceBreakdown['value']);
    }

    private function makeApprovedGcashOrder(float $total, string $approvedAt): Order
    {
        $this->orderSequence++;
        $order = Order::create([
            'order_no' => 'ORD-GCASH-'.str_pad((string) $this->orderSequence, 3, '0', STR_PAD_LEFT),
            'customer_name' => 'GCash Customer '.$this->orderSequence,
            'customer_contact' => 'gcash'.$this->orderSequence.'@example.test',
            'quantity' => 1,
            'subtotal' => $total,
            'total' => $total,
            'payment_method' => 'GCash',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
            'approved_at' => $approvedAt,
        ]);

        DB::table('orders')->where('id', $order->id)->update([
            'created_at' => $approvedAt,
            'updated_at' => $approvedAt,
            'approved_at' => $approvedAt,
        ]);

        return $order->refresh();
    }

    /** @param array<string, mixed> $attributes */
    private function makeReturn(Order $order, array $attributes): OrderReturn
    {
        $this->returnSequence++;
        $orderReturn = OrderReturn::create(array_merge([
            'return_no' => 'RET-REPORT-'.str_pad((string) $this->returnSequence, 3, '0', STR_PAD_LEFT),
            'order_id' => $order->id,
            'reason' => 'damaged',
        ], $attributes));

        $decidedAt = $attributes['decided_at'] ?? null;
        DB::table('order_returns')->where('id', $orderReturn->id)->update([
            'created_at' => $decidedAt,
            'updated_at' => $decidedAt,
            'decided_at' => $decidedAt,
        ]);

        return $orderReturn->refresh();
    }

    public function test_quarterly_and_yearly_reports_use_correct_calendar_ranges(): void
    {
        $this->actingAsRole('staff');

        $quarterStart = $this->makeOrder(
            'completed',
            10,
            '2026-01-01 00:00:00',
            '2026-03-31 16:00:00',
        );
        $quarterEnd = $this->makeOrder(
            'completed',
            20,
            '2026-01-01 00:00:00',
            '2026-06-30 15:59:59',
        );
        $afterQuarter = $this->makeOrder(
            'completed',
            30,
            '2026-01-01 00:00:00',
            '2026-06-30 16:00:00',
        );
        $yearStart = $this->makeOrder(
            'completed',
            40,
            '2025-01-01 00:00:00',
            '2025-12-31 16:00:00',
        );
        $yearEnd = $this->makeOrder(
            'completed',
            50,
            '2025-01-01 00:00:00',
            '2026-12-31 15:59:59',
        );
        $afterYear = $this->makeOrder(
            'completed',
            60,
            '2026-01-01 00:00:00',
            '2026-12-31 16:00:00',
        );

        $quarterly = $this->getJson($this->reportsUrl([
            'category' => 'completed_orders',
            'period' => 'quarterly',
            'year' => 2026,
            'quarter' => 2,
        ]));

        $quarterly->assertOk();
        $this->assertReportContract($quarterly, 'completed_orders', 'quarterly');
        $this->assertSame('2026-04-01', $quarterly->json('data.report.start_date'));
        $this->assertSame('2026-06-30', $quarterly->json('data.report.end_date'));
        $this->assertSame(2, $this->metricInt($quarterly, 'total_orders'));
        $this->assertCount(3, $quarterly->json('data.chart.labels'));
        $this->assertTableContains($quarterly, $quarterStart->order_no, $quarterEnd->order_no);
        $this->assertTableDoesNotContain($quarterly, $afterQuarter->order_no);

        $yearly = $this->getJson($this->reportsUrl([
            'category' => 'completed_orders',
            'period' => 'yearly',
            'year' => 2026,
        ]));

        $yearly->assertOk();
        $this->assertReportContract($yearly, 'completed_orders', 'yearly');
        $this->assertSame('2026-01-01', $yearly->json('data.report.start_date'));
        $this->assertSame('2026-12-31', $yearly->json('data.report.end_date'));
        $this->assertSame(5, $this->metricInt($yearly, 'total_orders'));
        $this->assertCount(12, $yearly->json('data.chart.labels'));
        $this->assertTableContains(
            $yearly,
            $quarterStart->order_no,
            $quarterEnd->order_no,
            $afterQuarter->order_no,
            $yearStart->order_no,
            $yearEnd->order_no,
        );
        $this->assertTableDoesNotContain($yearly, $afterYear->order_no);
    }

    public function test_completed_and_processing_reports_map_statuses_and_use_completed_at_fallback(): void
    {
        $this->actingAsRole('admin');

        $completedByTimestamp = $this->makeOrder(
            'completed',
            100,
            '2026-03-01 00:00:00',
            '2026-04-10 00:00:00',
        );
        $completedByFallback = $this->makeOrder(
            'completed',
            200,
            '2026-04-11 00:00:00',
        );
        $completedOutside = $this->makeOrder(
            'completed',
            300,
            '2026-04-12 00:00:00',
            '2026-05-01 00:00:00',
        );
        $archivedCompleted = $this->makeOrder(
            'completed',
            50,
            '2026-04-13 00:00:00',
            '2026-04-13 00:00:00',
            true,
        );
        $incoming = $this->makeOrder('incoming', 70, '2026-04-14 00:00:00');
        $pending = $this->makeOrder('pending', 80, '2026-04-15 00:00:00');
        $rejected = $this->makeOrder('rejected', 90, '2026-04-16 00:00:00');
        $archivedPending = $this->makeOrder('pending', 40, '2026-04-17 00:00:00', null, true);

        $completed = $this->getJson($this->reportsUrl($this->reportParams('completed_orders')));

        $completed->assertOk();
        $this->assertSame(3, $this->metricInt($completed, 'total_orders'));
        $this->assertSame(350.0, $this->metricFloat($completed, 'total_value'));
        $this->assertTableContains(
            $completed,
            $completedByTimestamp->order_no,
            $completedByFallback->order_no,
            $archivedCompleted->order_no,
        );
        $this->assertTableDoesNotContain(
            $completed,
            $completedOutside->order_no,
            $incoming->order_no,
            $pending->order_no,
            $rejected->order_no,
        );

        $processing = $this->getJson($this->reportsUrl($this->reportParams('processing_orders')));

        $processing->assertOk();
        $this->assertSame(2, $this->metricInt($processing, 'total_orders'));
        $this->assertSame(1, $this->metricInt($processing, 'incoming_orders'));
        $this->assertSame(1, $this->metricInt($processing, 'pending_orders'));
        $this->assertSame(150.0, $this->metricFloat($processing, 'total_value'));
        $this->assertTableContains($processing, $incoming->order_no, $pending->order_no);
        $this->assertTableDoesNotContain(
            $processing,
            $completedByTimestamp->order_no,
            $completedByFallback->order_no,
            $rejected->order_no,
            $archivedPending->order_no,
        );
    }

    public function test_appointments_use_appointment_date_and_archived_counts_as_historical_completion(): void
    {
        $this->actingAsRole('staff');

        $scheduled = $this->makeAppointment(
            'Scheduled',
            '2026-04-10',
            '2026-03-01 00:00:00',
        );
        $completed = $this->makeAppointment(
            'Completed',
            '2026-04-11',
            '2026-04-11 00:00:00',
        );
        $archived = $this->makeAppointment(
            'Archived',
            '2026-04-12',
            '2026-04-12 00:00:00',
        );
        $cancelled = $this->makeAppointment(
            'Cancelled',
            '2026-04-13',
            '2026-04-13 00:00:00',
        );
        $pending = $this->makeAppointment(
            'Pending',
            '2026-04-14',
            '2026-04-14 00:00:00',
        );
        $outsideByAppointmentDate = $this->makeAppointment(
            'Completed',
            '2026-05-01',
            '2026-04-15 00:00:00',
        );

        $response = $this->getJson($this->reportsUrl($this->reportParams('appointments')));

        $response->assertOk();
        $this->assertReportContract($response, 'appointments', 'monthly');
        $this->assertSame(5, $this->metricInt($response, 'total_appointments'));
        $this->assertSame(2, $this->metricInt($response, 'completed_appointments'));
        $this->assertSame(1, $this->metricInt($response, 'scheduled_appointments'));
        $this->assertSame(1, $this->metricInt($response, 'pending_appointments'));
        $this->assertSame(1, $this->metricInt($response, 'cancelled_appointments'));
        $pendingBreakdown = collect($response->json('data.breakdown.items'))
            ->firstWhere('label', 'Pending');
        $this->assertIsArray($pendingBreakdown);
        $this->assertSame(1, (int) $pendingBreakdown['value']);
        $this->assertTableContains(
            $response,
            $scheduled->reference_no,
            $completed->reference_no,
            $archived->reference_no,
            $cancelled->reference_no,
            $pending->reference_no,
        );
        $this->assertTableDoesNotContain($response, $outsideByAppointmentDate->reference_no);
    }

    public function test_inventory_returns_active_snapshot_and_period_movements_without_archived_stock(): void
    {
        $admin = $this->actingAsRole('admin');

        $active = $this->makeInventoryItem('Active Paper', 20);
        $variantParent = $this->makeInventoryItem('Variant Cable', 99, false, [
            [
                'id' => 1,
                'name' => 'One Meter',
                'description' => 'Short cable',
                'unit' => 'pcs',
                'on_hand' => 3,
                'initial_on_hand' => 10,
                'status' => 'Good',
                'remarks' => '',
            ],
        ]);
        $archived = $this->makeInventoryItem('Archived Toner', 100, true);

        SiteSetting::set('inventory_stock_rules', json_encode([
            'global' => ['mode' => 'fixed', 'threshold' => 0],
            'categories' => [],
            'items' => [],
            'variants' => [
                $variantParent->id.':1' => ['mode' => 'fixed', 'threshold' => 4],
            ],
        ], JSON_THROW_ON_ERROR));

        $this->makeInventoryMovement($active, 'in', 10, '2026-04-05 00:00:00', $admin);
        $this->makeInventoryMovement($active, 'out', 4, '2026-04-06 00:00:00', $admin);
        $this->makeInventoryMovement($active, 'in', 50, '2026-05-01 00:00:00', $admin);
        $this->makeInventoryMovement($variantParent, 'in', 2, '2026-04-07 00:00:00', $admin, 1);
        $this->makeInventoryMovement($variantParent, 'out', 1, '2026-04-08 00:00:00', $admin, 1);
        $this->makeInventoryMovement($archived, 'in', 100, '2026-04-09 00:00:00', $admin);

        $response = $this->getJson($this->reportsUrl($this->reportParams('inventory')));

        $response->assertOk();
        $this->assertReportContract($response, 'inventory', 'monthly');
        $this->assertSame(2, $this->metricInt($response, 'stock_entries'));
        $this->assertSame(23, $this->metricInt($response, 'units_on_hand'));
        $this->assertSame(12, $this->metricInt($response, 'stock_in'));
        $this->assertSame(5, $this->metricInt($response, 'stock_out'));
        $this->assertSame('Current Stock Entries', $this->metric($response, 'stock_entries')['label']);
        $this->assertSame('Current Units on Hand', $this->metric($response, 'units_on_hand')['label']);
        $this->assertSame('Selected-Period Stock In', $this->metric($response, 'stock_in')['label']);
        $this->assertSame('Selected-Period Stock Out', $this->metric($response, 'stock_out')['label']);
        $this->assertSame(
            'Current Stock Snapshot & Selected-Period Movements',
            $response->json('data.report.title'),
        );
        $this->assertSame('Selected-Period Inventory Movements', $response->json('data.chart.title'));
        $this->assertSame(
            'Current Stock Snapshot with Selected-Period Movements',
            $response->json('data.table.title'),
        );
        $inventoryColumns = collect($response->json('data.table.columns'))->keyBy('key');
        $this->assertSame('Period Stock In', $inventoryColumns->get('stock_in')['label']);
        $this->assertSame('Period Stock Out', $inventoryColumns->get('stock_out')['label']);
        $this->assertSame('Period Net Movement', $inventoryColumns->get('net_movement')['label']);
        $this->assertCount(2, $response->json('data.table.rows'));
        $this->assertTableContains($response, 'Active Paper', 'Variant Cable', 'One Meter');
        $this->assertTableDoesNotContain($response, 'Archived Toner');

        $variantRow = collect($response->json('data.table.rows'))
            ->firstWhere('item_name', 'Variant Cable');
        $this->assertIsArray($variantRow);
        $this->assertSame('Good', $variantParent->variants[0]['status']);

        $inventoryPage = $this->getJson('/api/admin/inventory');
        $inventoryPage->assertOk();
        $inventoryItem = collect($inventoryPage->json('data'))
            ->firstWhere('id', $variantParent->id);
        $this->assertIsArray($inventoryItem);
        $liveVariant = collect($inventoryItem['variants'])->firstWhere('id', 1);
        $this->assertIsArray($liveVariant);
        $this->assertSame('Low Stock', $liveVariant['status']);
        $this->assertSame($liveVariant['status'], $variantRow['status']);

        $lowStock = collect($response->json('data.breakdown.items'))
            ->firstWhere('label', 'Low Stock');
        $this->assertIsArray($lowStock);
        $this->assertSame(1, (int) $lowStock['value']);
    }

    public function test_empty_report_returns_a_successful_zero_state(): void
    {
        $this->actingAsRole('admin');

        $response = $this->getJson($this->reportsUrl($this->reportParams('sales')));

        $response->assertOk();
        $this->assertReportContract($response, 'sales', 'monthly');
        $this->assertSame([], $response->json('data.table.rows'));

        foreach ($response->json('data.metrics') as $metric) {
            $this->assertSame(0.0, (float) $metric['value']);
        }

        foreach ($response->json('data.chart.series') as $series) {
            $this->assertSame(0.0, (float) array_sum($series['values']));
        }
    }

    private function actingAsRole(string $role): User
    {
        // The production staff-role migration alters MySQL's enum, while the
        // SQLite test schema intentionally keeps the original CHECK constraint.
        // Sanctum accepts the authenticated model instance, so preserve a valid
        // persisted fixture and expose the Staff role for this request in memory.
        $persistedRole = $role === 'staff' ? 'admin' : $role;
        $user = User::factory()->create(['role' => $persistedRole]);
        if ($role === 'staff') {
            $user->setAttribute('role', 'staff');
        }
        Sanctum::actingAs($user);

        return $user;
    }

    private function reportParams(string $category): array
    {
        return [
            'category' => $category,
            'period' => 'monthly',
            'year' => 2026,
            'month' => 4,
        ];
    }

    private function reportsUrl(array $params): string
    {
        return '/api/admin/reports?'.http_build_query($params);
    }

    private function assertReportContract(
        TestResponse $response,
        string $category,
        string $period,
    ): void {
        $response->assertJsonStructure([
            'data' => [
                'report' => [
                    'id',
                    'title',
                    'category',
                    'period',
                    'period_label',
                    'start_date',
                    'end_date',
                    'timezone',
                    'generated_at',
                    'generated_by',
                ],
                'metrics',
                'chart' => ['title', 'value_type', 'labels', 'series'],
                'breakdown' => ['title', 'value_type', 'items'],
                'table' => ['title', 'columns', 'rows'],
            ],
        ]);

        $this->assertSame($category, $response->json('data.report.category'));
        $this->assertSame($period, $response->json('data.report.period'));
        $this->assertSame('Asia/Manila', $response->json('data.report.timezone'));

        $metrics = $response->json('data.metrics');
        $this->assertIsArray($metrics);
        foreach ($metrics as $metric) {
            $this->assertIsArray($metric);
            $this->assertArrayHasKey('key', $metric);
            $this->assertArrayHasKey('label', $metric);
            $this->assertArrayHasKey('value', $metric);
            $this->assertArrayHasKey('format', $metric);
        }

        $expectedMetricKeys = [
            'sales' => ['gross_sales', 'refunds_issued', 'net_sales', 'online_sales', 'walk_in_sales', 'total_transactions'],
            'completed_orders' => ['total_orders', 'total_value', 'average_order_value', 'total_items'],
            'processing_orders' => ['total_orders', 'incoming_orders', 'pending_orders', 'total_value'],
            'appointments' => ['total_appointments', 'completed_appointments', 'scheduled_appointments', 'pending_appointments', 'cancelled_appointments'],
            'inventory' => ['stock_entries', 'units_on_hand', 'stock_in', 'stock_out'],
        ];
        $this->assertEqualsCanonicalizing(
            $expectedMetricKeys[$category],
            array_column($metrics, 'key'),
        );

        $columns = $response->json('data.table.columns');
        $this->assertIsArray($columns);
        foreach ($columns as $column) {
            $this->assertIsArray($column);
            $this->assertArrayHasKey('key', $column);
            $this->assertArrayHasKey('label', $column);
            $this->assertArrayHasKey('type', $column);
        }

        $expectedColumnKeys = [
            'sales' => ['source', 'transaction_no', 'transaction_date', 'customer', 'status', 'payment_method', 'amount', 'archived'],
            'completed_orders' => ['order_no', 'completed_at', 'customer', 'items', 'payment_method', 'payment_status', 'amount', 'archived'],
            'processing_orders' => ['order_no', 'created_at', 'customer', 'lifecycle_status', 'customer_stage', 'payment_status', 'amount', 'archived'],
            'appointments' => ['reference_no', 'appointment_date', 'appointment_time', 'client_name', 'purpose', 'status'],
            'inventory' => ['category', 'item_name', 'variant', 'unit', 'on_hand', 'status', 'stock_in', 'stock_out', 'net_movement', 'updated_at'],
        ];
        $this->assertEqualsCanonicalizing(
            $expectedColumnKeys[$category],
            array_column($columns, 'key'),
        );

        $this->assertIsArray($response->json('data.chart.labels'));
        $series = $response->json('data.chart.series');
        $this->assertIsArray($series);
        foreach ($series as $chartSeries) {
            $this->assertIsArray($chartSeries);
            $this->assertArrayHasKey('name', $chartSeries);
            $this->assertArrayHasKey('values', $chartSeries);
            $this->assertIsArray($chartSeries['values']);
        }

        $breakdownItems = $response->json('data.breakdown.items');
        $this->assertIsArray($breakdownItems);
        foreach ($breakdownItems as $item) {
            $this->assertIsArray($item);
            $this->assertArrayHasKey('label', $item);
            $this->assertArrayHasKey('value', $item);
        }

        $this->assertIsArray($response->json('data.table.rows'));
    }

    private function metricFloat(TestResponse $response, string $key): float
    {
        return (float) $this->metric($response, $key)['value'];
    }

    private function metricInt(TestResponse $response, string $key): int
    {
        return (int) $this->metric($response, $key)['value'];
    }

    private function metric(TestResponse $response, string $key): array
    {
        $metric = collect($response->json('data.metrics'))
            ->firstWhere('key', $key);

        $this->assertIsArray($metric, "The report did not include the [{$key}] metric.");

        return $metric;
    }

    private function assertTableContains(TestResponse $response, string ...$values): void
    {
        $tableJson = json_encode(
            $response->json('data.table.rows'),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
        );

        foreach ($values as $value) {
            $this->assertStringContainsString($value, $tableJson);
        }
    }

    private function assertTableDoesNotContain(TestResponse $response, string ...$values): void
    {
        $tableJson = json_encode(
            $response->json('data.table.rows'),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
        );

        foreach ($values as $value) {
            $this->assertStringNotContainsString($value, $tableJson);
        }
    }

    private function makeOrder(
        string $status,
        float $total,
        string $createdAt,
        ?string $completedAt = null,
        bool $archived = false,
    ): Order {
        $this->orderSequence++;
        $order = Order::create([
            'order_no' => 'ORD-REPORT-'.str_pad((string) $this->orderSequence, 3, '0', STR_PAD_LEFT),
            'customer_name' => 'Report Customer '.$this->orderSequence,
            'customer_contact' => 'report'.$this->orderSequence.'@example.test',
            'quantity' => 1,
            'subtotal' => $total,
            'total' => $total,
            'payment_method' => 'COD',
            'payment_reference' => 'Pending',
            'lifecycle_status' => $status,
            'customer_stage' => $status === 'completed'
                ? 'completed'
                : ($status === 'pending' ? 'to_ship' : 'to_pay'),
            'completed_at' => $completedAt,
            'is_archived' => $archived,
            'archived_at' => $archived ? $createdAt : null,
        ]);

        DB::table('orders')->where('id', $order->id)->update([
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
            'completed_at' => $completedAt,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Report Item '.$this->orderSequence,
            'unit_price' => $total,
            'quantity' => 1,
            'line_total' => $total,
        ]);

        return $order->refresh();
    }

    private function makeWalkIn(float $total, string $orderDate, string $status): WalkInOrder
    {
        $this->walkInSequence++;
        $walkIn = WalkInOrder::create([
            'order_no' => 'WALK-REPORT-'.str_pad((string) $this->walkInSequence, 3, '0', STR_PAD_LEFT),
            'customer_name' => 'Walk-in Customer '.$this->walkInSequence,
            'item_detail' => 'Walk-in Report Item '.$this->walkInSequence,
            'unit' => '1',
            'subtotal_cost' => $total,
            'order_item' => 'Walk-in Report Item '.$this->walkInSequence,
            'order_date' => $orderDate,
            'customer' => 'Walk-in Customer '.$this->walkInSequence,
            'payment_method' => 'WALKIN VIA CASHIER',
            'total' => $total,
            'status' => $status,
        ]);

        DB::table('walk_in_orders')->where('id', $walkIn->id)->update([
            'created_at' => $orderDate,
            'updated_at' => $orderDate,
        ]);

        return $walkIn->refresh();
    }

    private function makeRefund(
        Order $order,
        float $refundedAmount,
        string $refundedAt,
        ?float $requestedAmount = null,
    ): OrderReturn {
        $this->returnSequence++;
        $requestedAmount ??= (float) $order->total;
        $orderReturn = OrderReturn::create([
            'return_no' => 'RET-REPORT-'.str_pad((string) $this->returnSequence, 3, '0', STR_PAD_LEFT),
            'order_id' => $order->id,
            'status' => 'refunded',
            'reason' => 'damaged',
            'resolution' => 'refund',
            'requested_amount' => $requestedAmount,
            'approved_amount' => $refundedAmount,
            'refunded_amount' => $refundedAmount,
            'refund_method' => 'gcash',
            'refund_reference' => 'REPORT-REFUND-'.$this->returnSequence,
            'requested_at' => $refundedAt,
            'refunded_at' => $refundedAt,
        ]);

        DB::table('order_returns')->where('id', $orderReturn->id)->update([
            'created_at' => $refundedAt,
            'updated_at' => $refundedAt,
            'refunded_at' => $refundedAt,
        ]);

        return $orderReturn->refresh();
    }

    private function makeAppointment(
        string $status,
        string $appointmentDate,
        string $createdAt,
    ): Appointment {
        $this->appointmentSequence++;
        $appointment = Appointment::create([
            'reference_no' => 'APT-REPORT-'.str_pad((string) $this->appointmentSequence, 3, '0', STR_PAD_LEFT),
            'first_name' => 'Report',
            'last_name' => 'Client '.$this->appointmentSequence,
            'purpose' => 'Report testing',
            'appointment_date' => $appointmentDate,
            'appointment_time' => '9:00 - 10:00 AM',
            'status' => $status,
        ]);

        DB::table('appointments')->where('id', $appointment->id)->update([
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        return $appointment->refresh();
    }

    private function makeInventoryItem(
        string $name,
        int $onHand,
        bool $archived = false,
        array $variants = [],
    ): InventoryItem {
        return InventoryItem::create([
            'category' => 'Office Supplies',
            'item_name' => $name,
            'description' => 'Report inventory fixture',
            'unit' => 'pcs',
            'last_invent' => max($onHand, 10),
            'on_hand' => $onHand,
            'status' => $onHand <= 0 ? 'Out of Stock' : ($onHand <= 5 ? 'Low Stock' : 'Good'),
            'remarks' => null,
            'variants' => $variants,
            'is_archived' => $archived,
            'archived_at' => $archived ? '2026-04-01 00:00:00' : null,
        ]);
    }

    private function makeInventoryMovement(
        InventoryItem $item,
        string $type,
        int $amount,
        string $createdAt,
        User $actor,
        ?int $variantId = null,
    ): InventoryTransaction {
        $transaction = InventoryTransaction::create([
            'inventory_item_id' => $item->id,
            'variant_id' => $variantId,
            'type' => $type,
            'amount' => $amount,
            'name' => 'Report stock movement',
            'purpose' => 'Feature test',
            'created_by_user_id' => $actor->id,
        ]);

        DB::table('inventory_transactions')->where('id', $transaction->id)->update([
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        return $transaction->refresh();
    }
}
