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
     * Top Selling Products based on completed order quantities + walk-in orders.
     * Supports period filter: month, week, day
     */
    public function topSelling(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        $period = $request->query('period', 'month'); // month, week, day

        $now = Carbon::now('Asia/Manila');

        // ── Determine date range based on period ──
        switch ($period) {
            case 'day':
                $startDate = $now->copy()->startOfDay();
                $endDate   = $now->copy()->endOfDay();
                break;
            case 'week':
                $startDate = $now->copy()->startOfWeek(Carbon::SUNDAY);
                $endDate   = $now->copy()->endOfWeek(Carbon::SATURDAY)->endOfDay();
                break;
            case 'month':
            default:
                $startDate = $now->copy()->startOfMonth();
                $endDate   = $now->copy()->endOfMonth()->endOfDay();
                break;
        }

        // ── Source 1: Completed online orders (from order_items + orders) ──
        // Use COALESCE(completed_at, created_at) so orders that are completed
        // but missing a completed_at timestamp still get counted.
        $onlineQuery = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->whereBetween(DB::raw('COALESCE(orders.completed_at, orders.created_at)'), [$startDate, $endDate])
            ->select(
                'order_items.product_name as product_name',
                DB::raw('SUM(order_items.quantity) as total_sold')
            )
            ->groupBy('order_items.product_name');

        // ── Source 2: Walk-in orders (from walk_in_orders) ──
        // Walk-in orders use order_item as product name and order_date for filtering.
        $walkInQuery = WalkInOrder::query()
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

        $combinedSql = "SELECT product_name as name, SUM(total_sold) as total_sold FROM ("
            . "({$onlineSql}) UNION ALL ({$walkInSql})"
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
     */
    public function salesByCategory(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        // Get category from products joined with order_items
        $categoryData = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->select(
                DB::raw("COALESCE(products.category, 'Uncategorized') as category"),
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy('category')
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
     */
    public function productPerformance(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        $performanceData = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->whereIn('orders.lifecycle_status', self::COUNTED_ORDER_STATUSES)
            ->select(
                DB::raw("COALESCE(products.code, 'N/A') as product_code"),
                'order_items.product_name',
                DB::raw("COALESCE(products.category, 'Uncategorized') as category"),
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy('product_code', 'order_items.product_name', 'category')
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
