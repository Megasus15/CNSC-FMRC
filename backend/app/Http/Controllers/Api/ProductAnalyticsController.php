<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\WalkInOrder;
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
     * Shown when order_items points at a product that has since been deleted,
     * or at one whose category was cleared. The money is real — order_items
     * keeps its own product_name and line_total snapshot — only the category is
     * gone, and the label says so instead of implying the sale is untracked.
     */
    private const CATEGORY_FALLBACK_LABEL = 'Deleted / Uncategorized';

    /**
     * The category and code expressions, written once and used in both the SELECT
     * list and the GROUP BY.
     *
     * Grouping by the *alias* is not portable. MySQL resolves `GROUP BY category`
     * to the output alias, but SQLite resolves it against the source columns
     * first — so it silently grouped by the raw `products.category`, splitting a
     * NULL category (deleted product) from an empty-string one into two buckets
     * that both render as the same label. Naming the expression means both
     * engines fold them together, which is the whole point of the COALESCE.
     */
    private const CATEGORY_EXPRESSION = "COALESCE(NULLIF(products.category, ''), '" . self::CATEGORY_FALLBACK_LABEL . "')";

    private const PRODUCT_CODE_EXPRESSION = "COALESCE(products.code, 'N/A')";

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

        // Get category from products joined with order_items
        $categoryData = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->where('orders.is_archived', false)
            ->whereBetween(DB::raw(self::ORDER_SALE_DATE), [$startDate, $endDate])
            ->select(
                DB::raw(self::CATEGORY_EXPRESSION . ' as category'),
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy(DB::raw(self::CATEGORY_EXPRESSION))
            ->orderByDesc('total_revenue')
            ->get();

        return response()->json([
            'data' => $categoryData->map(fn($item) => [
                'category' => $item->category,
                'total_sold' => (int) $item->total_sold,
                'total_revenue' => (float) $item->total_revenue,
            ]),
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

        $performanceData = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->where('orders.is_archived', false)
            ->whereBetween(DB::raw(self::ORDER_SALE_DATE), [$startDate, $endDate])
            ->select(
                DB::raw(self::PRODUCT_CODE_EXPRESSION . ' as product_code'),
                'order_items.product_name',
                DB::raw(self::CATEGORY_EXPRESSION . ' as category'),
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy(
                DB::raw(self::PRODUCT_CODE_EXPRESSION),
                'order_items.product_name',
                DB::raw(self::CATEGORY_EXPRESSION)
            )
            ->orderByDesc('total_sold')
            ->limit(20)
            ->get();

        return response()->json([
            'data' => $performanceData->map(function ($item) {
                $sold = (int) $item->total_sold;
                $status = 'Low';
                $statusClass = 'low';
                if ($sold >= 100) {
                    $status = 'Top Seller';
                    $statusClass = 'top';
                } elseif ($sold >= 50) {
                    $status = 'High';
                    $statusClass = 'high';
                }

                return [
                    'product_code' => $item->product_code,
                    'product_name' => $item->product_name,
                    'category' => $item->category,
                    'total_sold' => $sold,
                    'total_revenue' => (float) $item->total_revenue,
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
