<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\CustomerMessage;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderReturn;
use App\Models\Product;
use App\Models\ReportGeneration;
use App\Models\User;
use App\Models\WalkInOrder;
use App\Support\AdminArchiveRecords;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AdminDashboardController extends Controller
{
    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        $role = strtolower((string) ($actor->role ?? ''));
        if (! $actor || ! in_array($role, ['admin', 'staff'], true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }

    public function summary(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $appointmentsCount = Appointment::query()->count();
        $accountsCount = User::query()->count();
        $ordersCount = Order::query()->count();
        $productsCount = Product::query()->count();
        $customerInquiriesCount = CustomerMessage::query()->count();

        $liveCounts = $this->liveCountSnapshot();

        // ─── Total Revenue ───
        // Completed orders + GCash orders whose payment staff have verified +
        // walk-in sales, minus refunds that have been approved onward.
        //
        // Archived rows are excluded from every term. Archiving is how the back
        // office retires a finished sale, and until now no revenue query looked
        // at `is_archived` at all — so the card was a lifetime total that could
        // only ever grow, and clearing out old orders left it untouched. The
        // filter sits at each call site rather than inside
        // Order::scopeGcashAdvanceRevenue(), which the sales report shares.
        $completedOrdersRevenue = (float) Order::query()
            ->where('lifecycle_status', 'completed')
            ->where('is_archived', false)
            ->sum('total');

        // GCash is collected up front, so a *verified* GCash payment is real money
        // in the FMRC wallet even before the order ships. The scope keys off
        // payments.status = 'paid' and excludes 'completed' and 'rejected', so this
        // can neither double count the sum above nor credit money that is owed
        // back. See Order::scopeGcashAdvanceRevenue().
        $verifiedGcashRevenue = (float) Order::query()
            ->gcashAdvanceRevenue()
            ->where('is_archived', false)
            ->sum('total');

        // `walk_in_orders.status` is free text (default "Pending"), so the two
        // terminal words that mean "no money changed hands" are excluded by name
        // instead of whitelisting one. A walk-in is cash taken at the counter and
        // is recorded when it is taken, so a still-"Pending" one is real revenue —
        // dropping everything but "Completed" would erase most of this term.
        $walkInRevenue = (float) WalkInOrder::query()
            ->where('is_archived', false)
            ->whereRaw("LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'canceled', 'archived', 'voided')")
            ->sum('total');

        // Only 'refund' resolutions give money back — replacement and repair
        // returns also carry an approved_amount but cost no revenue.
        $refundedAmount = (float) OrderReturn::query()
            ->whereIn('status', OrderReturn::REVENUE_DEDUCTING_STATUSES)
            ->where('resolution', 'refund')
            ->sum(DB::raw('COALESCE(refunded_amount, approved_amount, 0)'));

        $totalRevenue = max(
            0.0,
            $completedOrdersRevenue + $verifiedGcashRevenue + $walkInRevenue - $refundedAmount
        );

        // ─── Total Inventory Items ───
        $totalInventoryItems = InventoryItem::query()->count();

        // ─── Analytics Summary (compact, for dashboard overview card) ───
        // Every aggregate below skips archived orders for the same reason Total
        // Revenue does: one screen, one story. A figure that still counted a row
        // the Orders page no longer lists would just look like a bug.
        // Top 3 selling products (this month)
        $now = now('Asia/Manila');
        $topSelling = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->where('orders.lifecycle_status', 'completed')
            ->where('orders.is_archived', false)
            ->whereMonth('orders.created_at', $now->month)
            ->whereYear('orders.created_at', $now->year)
            ->select('order_items.product_name', DB::raw('SUM(order_items.quantity) as total_sold'))
            ->groupBy('order_items.product_name')
            ->orderByDesc('total_sold')
            ->limit(3)
            ->get()
            ->map(fn ($item) => [
                'name' => $item->product_name,
                'total_sold' => (int) $item->total_sold,
            ]);

        // Sales by category (all time, top 3)
        // NULLIF folds the empty-string category into the same bucket as a
        // deleted product, which otherwise formed its own blank slice. The label
        // matches ProductAnalyticsController so the two cards read the same.
        //
        // The GROUP BY names the expression, not the `category` alias: MySQL
        // resolves the alias but SQLite resolves the source column first, so
        // grouping by the alias split NULL and '' back into two buckets that both
        // render under the one label.
        $categoryExpression = "COALESCE(NULLIF(products.category, ''), 'Deleted / Uncategorized')";
        $salesByCategory = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->where('orders.lifecycle_status', 'completed')
            ->where('orders.is_archived', false)
            ->select(
                DB::raw($categoryExpression . ' as category'),
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy(DB::raw($categoryExpression))
            ->orderByDesc('total_revenue')
            ->limit(3)
            ->get()
            ->map(fn ($item) => [
                'category' => $item->category,
                'total_sold' => (int) $item->total_sold,
                'total_revenue' => (float) $item->total_revenue,
            ]);

        // Top 3 performing products (all time)
        $topPerformance = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->where('orders.lifecycle_status', 'completed')
            ->where('orders.is_archived', false)
            ->select(
                'order_items.product_name',
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy('order_items.product_name')
            ->orderByDesc('total_revenue')
            ->limit(3)
            ->get()
            ->map(fn ($item) => [
                'name' => $item->product_name,
                'total_sold' => (int) $item->total_sold,
                'total_revenue' => (float) $item->total_revenue,
            ]);

        // Yearly sales trend (current year, monthly totals)
        $currentYear = $now->year;
        $monthExpression = DB::connection()->getDriverName() === 'sqlite'
            ? "CAST(strftime('%m', created_at) AS INTEGER)"
            : 'MONTH(created_at)';
        $monthlyData = Order::query()
            ->where('lifecycle_status', 'completed')
            ->where('is_archived', false)
            ->whereYear('created_at', $currentYear)
            ->select(
                DB::raw("{$monthExpression} as month"),
                DB::raw('SUM(total) as total_sales')
            )
            ->groupBy('month')
            ->orderBy('month')
            ->get()
            ->keyBy('month');

        $yearlyTrend = [];
        for ($m = 1; $m <= 12; $m++) {
            $yearlyTrend[] = [
                'month' => $m,
                'total_sales' => (float) ($monthlyData[$m]->total_sales ?? 0),
            ];
        }

        $recentAppointments = Appointment::query()
            ->select(['id', 'first_name', 'last_name', 'purpose', 'appointment_date', 'appointment_time', 'status', 'created_at'])
            ->orderByDesc('created_at')
            ->limit(3)
            ->get()
            ->map(function (Appointment $appointment) {
                $fullName = trim(implode(' ', array_filter([
                    $appointment->first_name,
                    $appointment->last_name,
                ])));

                return [
                    'id' => $appointment->id,
                    'client_name' => $fullName !== '' ? $fullName : 'Unknown Client',
                    'purpose' => $appointment->purpose,
                    'appointment_date' => optional($appointment->appointment_date)->format('Y-m-d'),
                    'appointment_time' => $appointment->appointment_time,
                    'status' => $appointment->status,
                    'created_at' => optional($appointment->created_at)->toIso8601String(),
                ];
            })
            ->values();

        $recentOrders = Order::query()
            ->with(['latestItem'])
            ->select(['id', 'order_no', 'quantity', 'lifecycle_status', 'customer_stage', 'created_at'])
            ->orderByDesc('created_at')
            ->limit(3)
            ->get()
            ->map(function (Order $order) {
                $lifecycle = strtolower((string) $order->lifecycle_status);
                $stage = strtolower((string) $order->customer_stage);

                $statusLabel = match (true) {
                    $lifecycle === 'completed' || $stage === 'completed' => 'Completed',
                    $lifecycle === 'rejected' => 'Rejected',
                    // Checked before the stage arms: a cancelled order keeps the
                    // stage it died at, so falling through would label it
                    // "To Pay" as though it were still live.
                    $lifecycle === 'cancelled' => 'Cancelled',
                    $lifecycle === 'incoming' => 'Incoming',
                    $stage === 'to_ship' => 'To Ship',
                    $stage === 'to_receive' => 'To Receive',
                    default => 'To Pay',
                };

                return [
                    'id' => $order->id,
                    'order_no_display' => $order->order_no ?: ('#'.$order->id),
                    'product_name' => $order->latestItem?->product_name ?: 'Custom Order',
                    'quantity' => max(1, (int) $order->quantity),
                    'lifecycle_status' => $order->lifecycle_status,
                    'customer_stage' => $order->customer_stage,
                    'status_label' => $statusLabel,
                    'created_at' => optional($order->created_at)->toIso8601String(),
                ];
            })
            ->values();

        $recentCustomerInquiries = CustomerMessage::query()
            ->select(['id', 'sender_name', 'sender_email', 'message', 'status', 'is_read', 'created_at'])
            ->orderByDesc('created_at')
            ->limit(3)
            ->get()
            ->map(function (CustomerMessage $msg) {
                return [
                    'id' => $msg->id,
                    'sender_name' => $msg->sender_name,
                    'sender_email' => $msg->sender_email,
                    'message_preview' => Str::limit($msg->message, 50),
                    'status' => $msg->status,
                    'is_read' => (bool) $msg->is_read,
                    'created_at' => optional($msg->created_at)->toIso8601String(),
                ];
            })
            ->values();

        return response()->json([
            'data' => [
                'counts' => [
                    'appointments' => $appointmentsCount,
                    'accounts' => $accountsCount,
                    'orders' => $ordersCount,
                    'products' => $productsCount,
                    'customer_inquiries' => $customerInquiriesCount,
                    'generated_reports' => $liveCounts['generated_reports'],
                    'total_archives' => $liveCounts['total_archives'],
                    'archives' => $liveCounts['archives'],
                    'total_revenue' => $totalRevenue,
                    'total_inventory_items' => $totalInventoryItems,
                ],
                'analytics_summary' => [
                    'top_selling' => $topSelling,
                    'sales_by_category' => $salesByCategory,
                    'top_performance' => $topPerformance,
                    'yearly_trend' => $yearlyTrend,
                    'year' => $currentYear,
                ],
                'recent_appointments' => $recentAppointments,
                'recent_orders' => $recentOrders,
                'recent_customer_inquiries' => $recentCustomerInquiries,
                'availability' => $liveCounts['availability'],
                'generated_at' => now('Asia/Manila')->toIso8601String(),
            ],
        ])->header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }

    public function liveCounts(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdmin($request)) {
            return $denied;
        }

        return response()->json([
            'data' => $this->liveCountSnapshot() + [
                'generated_at' => now('Asia/Manila')->toIso8601String(),
            ],
        ])
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
            ->header('Pragma', 'no-cache')
            ->header('Expires', '0');
    }

    /**
     * @return array{
     *     generated_reports: int,
     *     total_archives: int,
     *     archives: array<string, int>,
     *     availability: array{report_generations: bool, archives: array<string, bool>}
     * }
     */
    private function liveCountSnapshot(): array
    {
        $archives = AdminArchiveRecords::snapshot();
        $reportGenerationsAvailable = ReportGeneration::schemaAvailable();
        $generatedReports = 0;

        if ($reportGenerationsAvailable) {
            try {
                $generatedReports = ReportGeneration::query()->count();
            } catch (\Throwable) {
                $reportGenerationsAvailable = false;
            }
        }

        return [
            'generated_reports' => $generatedReports,
            'total_archives' => $archives['total'],
            'archives' => $archives['counts'],
            'availability' => [
                'report_generations' => $reportGenerationsAvailable,
                'archives' => $archives['availability'],
            ],
        ];
    }
}
