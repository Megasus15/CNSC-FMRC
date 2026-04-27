<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ProductAnalyticsController extends Controller
{
    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    /**
     * Top Selling Products based on actual order quantities.
     * Supports period filter: month, week, day
     */
    public function topSelling(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        $period = $request->query('period', 'month'); // month, week, day

        $query = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->whereNotIn('orders.lifecycle_status', ['rejected']);

        // Apply period filter
        $now = Carbon::now('Asia/Manila');
        switch ($period) {
            case 'day':
                $query->whereDate('orders.created_at', $now->toDateString());
                break;
            case 'week':
                $query->whereBetween('orders.created_at', [
                    $now->copy()->startOfWeek(),
                    $now->copy()->endOfWeek(),
                ]);
                break;
            case 'month':
            default:
                $query->whereMonth('orders.created_at', $now->month)
                      ->whereYear('orders.created_at', $now->year);
                break;
        }

        $topProducts = $query
            ->select(
                'order_items.product_name',
                DB::raw('SUM(order_items.quantity) as total_sold')
            )
            ->groupBy('order_items.product_name')
            ->orderByDesc('total_sold')
            ->limit(8)
            ->get();

        return response()->json([
            'data' => $topProducts->map(fn($item) => [
                'name' => $item->product_name,
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
            ->whereNotIn('orders.lifecycle_status', ['rejected'])
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
            ->whereNotIn('orders.lifecycle_status', ['rejected'])
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

        $monthlyData = Order::query()
            ->whereNotIn('lifecycle_status', ['rejected'])
            ->whereYear('created_at', $year)
            ->select(
                DB::raw('MONTH(created_at) as month'),
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
            'has_data' => $hasData,
            'data' => $months,
        ]);
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
