<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\WalkInOrder;
use App\Support\CategorySalesBuckets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ProductAnalyticsController extends Controller
{
    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    private const COUNTED_ORDER_STATUSES = ['completed'];

    private const YEARLY_TREND_DATE_COLUMN_CREATED = 'created_at';

    private const YEARLY_TREND_DATE_COLUMN_COMPLETED = 'completed_at';

    /**
     * The date a sale counts on. A completed order that never got a
     * completed_at timestamp still has to land somewhere, so it falls back to
     * when it was placed.
     */
    private const ORDER_SALE_DATE = 'COALESCE(orders.completed_at, orders.created_at)';

    /**
     * The code shown for a sale whose product row is gone.
     *
     * Its category counterpart lives in CategorySalesBuckets::FALLBACK_LABEL, as
     * does the reason both are resolved in PHP now rather than by a COALESCE in
     * the SQL: the grouped expression this pair used to build threw on the
     * production server while the same query grouped on an order_items column
     * did not.
     */
    private const PRODUCT_CODE_FALLBACK = 'N/A';

    /**
     * The window every sales card reports on.
     *
     * All three resolve it here so "This Day" means the same day on each of
     * them. Before this existed only topSelling() filtered at all, which is why
     * a lifetime Sales by Category donut could sit beside an empty daily Top
     * Selling list and show last year's figures.
     *
     * @return array{0: Carbon, 1: Carbon}
     */
    private function resolvePeriodRange(Request $request): array
    {
        $now = Carbon::now('Asia/Manila');

        return match ($request->query('period', 'month')) {
            'day' => [$now->copy()->startOfDay(), $now->copy()->endOfDay()],
            'week' => [
                $now->copy()->startOfWeek(Carbon::SUNDAY),
                $now->copy()->endOfWeek(Carbon::SATURDAY)->endOfDay(),
            ],
            default => [$now->copy()->startOfMonth(), $now->copy()->endOfMonth()->endOfDay()],
        };
    }

    /**
     * Top Selling Products based on completed order quantities + walk-in orders.
     * Supports period filter: month, week, day
     */
    public function topSelling(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        [$startDate, $endDate] = $this->resolvePeriodRange($request);

        // ── Source 1: Completed online orders (from order_items + orders) ──
        // Archived orders are left out so that archiving one takes it off every
        // sales card at once, the same way it comes off Total Revenue.
        $onlineQuery = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->where('orders.is_archived', false)
            ->whereBetween(DB::raw(self::ORDER_SALE_DATE), [$startDate, $endDate])
            ->select(
                'order_items.product_name as product_name',
                DB::raw('SUM(order_items.quantity) as total_sold')
            )
            ->groupBy('order_items.product_name');

        // ── Source 2: Walk-in orders (from walk_in_orders) ──
        // Walk-in orders use order_item as product name and order_date for filtering.
        $walkInQuery = WalkInOrder::query()
            ->where('is_archived', false)
            ->whereBetween(DB::raw('COALESCE(order_date, created_at)'), [$startDate, $endDate])
            ->select(
                DB::raw("COALESCE(NULLIF(TRIM(item_detail), ''), NULLIF(TRIM(order_item), ''), 'Walk-in Item') as product_name"),
                DB::raw('1 as total_sold')
            );

        // ── Combine both sources using UNION ALL and aggregate ──
        $onlineSql = $onlineQuery->toSql();
        $onlineBindings = $onlineQuery->getBindings();

        $walkInSql = $walkInQuery->toSql();
        $walkInBindings = $walkInQuery->getBindings();

        // The two branches are *not* individually parenthesised. MySQL tolerates
        // `(SELECT …) UNION ALL (SELECT …)`, SQLite rejects it outright, and the
        // parentheses buy nothing here: neither branch carries its own ORDER BY or
        // LIMIT, and the GROUP BY binds to the SELECT it follows. Written this way
        // the statement runs on both engines, which is what makes this endpoint
        // testable at all.
        $combinedSql = "SELECT product_name as name, SUM(total_sold) as total_sold FROM ("
            . "{$onlineSql} UNION ALL {$walkInSql}"
            . ") as combined GROUP BY product_name ORDER BY total_sold DESC LIMIT 8";

        $combinedBindings = array_merge($onlineBindings, $walkInBindings);

        $topProducts = DB::select($combinedSql, $combinedBindings);

        return response()->json([
            'data' => collect($topProducts)->map(fn($item) => [
                'name' => $item->name,
                'total_sold' => (int) $item->total_sold,
            ]),
        ]);
    }

    /**
     * Sales by Category based on actual order data.
     * Honours the same period filter as Top Selling.
     */
    public function salesByCategory(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        [$startDate, $endDate] = $this->resolvePeriodRange($request);

        // Totals per product first, then folded into categories in PHP. Nothing
        // in this query names a products column, so it cannot fail on a server
        // where the grouped COALESCE it replaced did.
        $categoryData = CategorySalesBuckets::fold(
            DB::table('order_items')
                ->join('orders', 'order_items.order_id', '=', 'orders.id')
                ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
                ->where('orders.is_archived', false)
                ->whereBetween(DB::raw(self::ORDER_SALE_DATE), [$startDate, $endDate])
                ->groupBy('order_items.product_id')
                ->select(
                    'order_items.product_id',
                    DB::raw('SUM(order_items.quantity) as total_sold'),
                    DB::raw('SUM(order_items.line_total) as total_revenue')
                )
                ->get()
        );

        return response()->json([
            'data' => $categoryData->values(),
        ]);
    }

    /**
     * Product Performance - detailed sales per product from orders.
     * Honours the same period filter as Top Selling.
     */
    public function productPerformance(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        [$startDate, $endDate] = $this->resolvePeriodRange($request);

        // Grouped on the order_items snapshot, then labelled from `products` in a
        // second read, for the same reason as salesByCategory() — the pair of
        // COALESCE expressions this replaced sat in both the SELECT list and the
        // GROUP BY. Rows sharing a code, name and category still merge; that now
        // happens in PHP, where a NULL code and a blank one fold together instead
        // of splitting into two rows both labelled "N/A".
        $rows = DB::table('order_items')
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->where('orders.is_archived', false)
            ->whereBetween(DB::raw(self::ORDER_SALE_DATE), [$startDate, $endDate])
            ->groupBy('order_items.product_id', 'order_items.product_name')
            ->select(
                'order_items.product_id',
                'order_items.product_name',
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->get();

        $meta = CategorySalesBuckets::meta($rows->pluck('product_id')->all());
        $merged = [];

        foreach ($rows as $row) {
            $code = trim((string) ($meta[$row->product_id]->code ?? ''));
            $code = $code !== '' ? $code : self::PRODUCT_CODE_FALLBACK;

            $category = trim((string) ($meta[$row->product_id]->category ?? ''));
            $category = $category !== '' ? $category : CategorySalesBuckets::FALLBACK_LABEL;

            $name = (string) $row->product_name;
            $key = $code."\0".$name."\0".$category;

            if (! isset($merged[$key])) {
                $merged[$key] = [
                    'product_code' => $code,
                    'product_name' => $name,
                    'category' => $category,
                    'total_sold' => 0,
                    'total_revenue' => 0.0,
                ];
            }

            $merged[$key]['total_sold'] += (int) $row->total_sold;
            $merged[$key]['total_revenue'] += (float) $row->total_revenue;
        }

        $performanceData = collect($merged)->sortByDesc('total_sold')->take(20)->values();

        return response()->json([
            'data' => $performanceData->map(function (array $item) {
                $sold = (int) $item['total_sold'];
                $status = 'Low';
                $statusClass = 'low';
                if ($sold >= 100) {
                    $status = 'Top Seller';
                    $statusClass = 'top';
                } elseif ($sold >= 50) {
                    $status = 'High';
                    $statusClass = 'high';
                }

                return $item + [
                    'status' => $status,
                    'status_class' => $statusClass,
                ];
            }),
        ]);
    }

    /**
     * Yearly Sales Trend - monthly total from orders for a given year.
     */
    public function yearlySalesTrend(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        $year = (int) $request->query('year', date('Y'));
        $dateColumn = $this->resolveYearlyTrendDateColumn($request);
        $countedStatuses = $dateColumn === self::YEARLY_TREND_DATE_COLUMN_COMPLETED
            ? ['completed']
            : self::COUNTED_ORDER_STATUSES;

        $monthlyData = Order::query()
            ->whereIn('lifecycle_status', $countedStatuses)
            ->where('is_archived', false)
            ->whereYear($dateColumn, $year)
            ->whereNotNull($dateColumn)
            ->select(
                DB::raw("MONTH({$dateColumn}) as month"),
                DB::raw('SUM(total) as total_sales'),
                DB::raw('COUNT(*) as order_count')
            )
            ->groupBy('month')
            ->orderBy('month')
            ->get()
            ->keyBy('month');

        $months = [];
        for ($m = 1; $m <= 12; $m++) {
            $months[] = [
                'month' => $m,
                'total_sales' => (float) ($monthlyData[$m]->total_sales ?? 0),
                'order_count' => (int) ($monthlyData[$m]->order_count ?? 0),
            ];
        }

        // Check if there's any data at all for this year
        $hasData = collect($months)->sum('total_sales') > 0;

        return response()->json([
            'year' => $year,
            'date_basis' => $dateColumn,
            'has_data' => $hasData,
            'data' => $months,
        ]);
    }

    private function resolveYearlyTrendDateColumn(Request $request): string
    {
        $basis = strtolower((string) $request->query('date_basis', self::YEARLY_TREND_DATE_COLUMN_CREATED));

        return match ($basis) {
            self::YEARLY_TREND_DATE_COLUMN_COMPLETED => self::YEARLY_TREND_DATE_COLUMN_COMPLETED,
            default => self::YEARLY_TREND_DATE_COLUMN_CREATED,
        };
    }

    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }
}
