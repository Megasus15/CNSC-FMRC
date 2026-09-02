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
use Illuminate\Support\Facades\Log;
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

    /**
     * Resolve one dashboard aggregate behind a guard, degrading to $fallback.
     *
     * A Hostinger deploy copies files and never runs migrations, so the server
     * can sit a column - or a whole table - behind this code. summary() used to
     * be one flat run of ~17 queries with no protection: a single one of them
     * throwing took the entire endpoint down with a 500, and dashboard.js
     * swallows a failed summary and quietly falls back to the four legacy count
     * endpoints. The visible result was Total Revenue, Total Inventory Items,
     * all four Product Analytics cards and Recent Customer Inquiries stuck as
     * shimmering placeholders forever, with no error message anywhere on screen.
     *
     * AdminArchiveRecords::snapshot() already degrades per module; this gives
     * the rest of the dashboard the same contract. A section that cannot be read
     * falls back to its empty value, is named in `availability.sections` so the
     * page can say so plainly, and is logged with the driver's own message so
     * the server log names the missing table or column.
     *
     * @param  array<int, string>  $unavailable
     */
    private function safely(string $section, callable $resolver, mixed $fallback, array &$unavailable): mixed
    {
        try {
            return $resolver();
        } catch (\Throwable $exception) {
            if (! in_array($section, $unavailable, true)) {
                $unavailable[] = $section;
            }

            Log::warning(sprintf(
                'Dashboard section [%s] is unavailable on this server: %s',
                $section,
                $exception->getMessage()
            ));

            return $fallback;
        }
    }

    public function summary(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        // Every block below runs through safely(), so one unreadable table
        // degrades one card instead of blanking the whole dashboard.
        $unavailable = [];

        $appointmentsCount = $this->safely('counts.appointments', fn () => Appointment::query()->count(), 0, $unavailable);
        $accountsCount = $this->safely('counts.accounts', fn () => User::query()->count(), 0, $unavailable);
        $ordersCount = $this->safely('counts.orders', fn () => Order::query()->count(), 0, $unavailable);
        $productsCount = $this->safely('counts.products', fn () => Product::query()->count(), 0, $unavailable);
        $customerInquiriesCount = $this->safely('counts.customer_inquiries', fn () => CustomerMessage::query()->count(), 0, $unavailable);

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
        $completedOrdersRevenue = $this->safely('revenue.completed_orders', fn () => (float) Order::query()
            ->where('lifecycle_status', 'completed')
            ->where('is_archived', false)
            ->sum('total'), 0.0, $unavailable);

        // GCash is collected up front, so a *verified* GCash payment is real money
        // in the FMRC wallet even before the order ships. The scope keys off
        // payments.status = 'paid' and excludes 'completed' and 'rejected', so this
        // can neither double count the sum above nor credit money that is owed
        // back. See Order::scopeGcashAdvanceRevenue().
        $verifiedGcashRevenue = $this->safely('revenue.gcash_advance', fn () => (float) Order::query()
            ->gcashAdvanceRevenue()
            ->where('is_archived', false)
            ->sum('total'), 0.0, $unavailable);

        // `walk_in_orders.status` is free text (default "Pending"), so the two
        // terminal words that mean "no money changed hands" are excluded by name
        // instead of whitelisting one. A walk-in is cash taken at the counter and
        // is recorded when it is taken, so a still-"Pending" one is real revenue —
        // dropping everything but "Completed" would erase most of this term.
        $walkInRevenue = $this->safely('revenue.walkins', fn () => (float) WalkInOrder::query()
            ->where('is_archived', false)
            ->whereRaw("LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'canceled', 'archived', 'voided')")
            ->sum('total'), 0.0, $unavailable);

        // Only 'refund' resolutions give money back — replacement and repair
        // returns also carry an approved_amount but cost no revenue.
        $refundedAmount = $this->safely('revenue.refunds', fn () => (float) OrderReturn::query()
            ->whereIn('status', OrderReturn::REVENUE_DEDUCTING_STATUSES)
            ->where('resolution', 'refund')
            ->sum(DB::raw('COALESCE(refunded_amount, approved_amount, 0)')), 0.0, $unavailable);

        $totalRevenue = max(
            0.0,
            $completedOrdersRevenue + $verifiedGcashRevenue + $walkInRevenue - $refundedAmount
        );

        // ─── Total Inventory Items ───
        $totalInventoryItems = $this->safely('counts.total_inventory_items', fn () => InventoryItem::query()->count(), 0, $unavailable);

        // ─── Analytics Summary (compact, for dashboard overview card) ───
        // Every aggregate below skips archived orders for the same reason Total
        // Revenue does: one screen, one story. A figure that still counted a row
        // the Orders page no longer lists would just look like a bug.
        // Top 3 selling products (this month)
        $now = now('Asia/Manila');
        $topSelling = $this->safely('analytics.top_selling', fn () => OrderItem::query()
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
            ]), collect(), $unavailable);

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
        $salesByCategory = $this->safely('analytics.sales_by_category', fn () => OrderItem::query()
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
            ]), collect(), $unavailable);

        // Top 3 performing products (all time)
        $topPerformance = $this->safely('analytics.top_performance', fn () => OrderItem::query()
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
            ]), collect(), $unavailable);

        // Yearly sales trend (current year, monthly totals)
        $currentYear = $now->year;
        $monthExpression = DB::connection()->getDriverName() === 'sqlite'
            ? "CAST(strftime('%m', created_at) AS INTEGER)"
            : 'MONTH(created_at)';
        $monthlyData = $this->safely('analytics.yearly_trend', fn () => Order::query()
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
            ->keyBy('month'), collect(), $unavailable);

        $yearlyTrend = [];
        for ($m = 1; $m <= 12; $m++) {
            $yearlyTrend[] = [
                'month' => $m,
                'total_sales' => (float) ($monthlyData[$m]->total_sales ?? 0),
            ];
        }

        $recentAppointments = $this->safely('recent.appointments', fn () => Appointment::query()
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
            ->values(), collect(), $unavailable);

        $recentOrders = $this->safely('recent.orders', fn () => Order::query()
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
            ->values(), collect(), $unavailable);

        $recentCustomerInquiries = $this->safely('recent.customer_inquiries', fn () => CustomerMessage::query()
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
            ->values(), collect(), $unavailable);

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
                // `archives` and `report_generations` keep their existing shape.
                // `sections` is additive: an empty list means every figure on the
                // page was read successfully, and a non-empty one names exactly
                // which cards are standing on fallback values.
                'availability' => $liveCounts['availability'] + [
                    'sections' => [
                        'complete' => $unavailable === [],
                        'unavailable' => array_values($unavailable),
                    ],
                ],
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
