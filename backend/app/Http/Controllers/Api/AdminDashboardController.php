<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\WalkInOrder;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminDashboardController extends Controller
{
    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        $role = strtolower((string) ($actor->role ?? ''));
        if (!$actor || !in_array($role, ['admin', 'staff'], true)) {
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

        // ─── Total Revenue (completed orders + walk-in subtotal costs) ───
        $completedOrdersRevenue = (float) Order::query()
            ->where('lifecycle_status', 'completed')
            ->sum('total');

        $walkInRevenue = (float) WalkInOrder::query()
            ->sum('subtotal_cost');

        $totalRevenue = $completedOrdersRevenue + $walkInRevenue;

        // ─── Total Inventory Items ───
        $totalInventoryItems = InventoryItem::query()->count();

        // ─── Analytics Summary (compact, for dashboard overview card) ───
        // Top 3 selling products (this month)
        $now = now('Asia/Manila');
        $topSelling = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->whereNotIn('orders.lifecycle_status', ['rejected'])
            ->whereMonth('orders.created_at', $now->month)
            ->whereYear('orders.created_at', $now->year)
            ->select('order_items.product_name', DB::raw('SUM(order_items.quantity) as total_sold'))
            ->groupBy('order_items.product_name')
            ->orderByDesc('total_sold')
            ->limit(3)
            ->get()
            ->map(fn($item) => [
                'name' => $item->product_name,
                'total_sold' => (int) $item->total_sold,
            ]);

        // Sales by category (all time, top 3)
        $salesByCategory = OrderItem::query()
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
            ->limit(3)
            ->get()
            ->map(fn($item) => [
                'category' => $item->category,
                'total_sold' => (int) $item->total_sold,
                'total_revenue' => (float) $item->total_revenue,
            ]);

        // Top 3 performing products (all time)
        $topPerformance = OrderItem::query()
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->leftJoin('products', 'order_items.product_id', '=', 'products.id')
            ->whereNotIn('orders.lifecycle_status', ['rejected'])
            ->select(
                'order_items.product_name',
                DB::raw('SUM(order_items.quantity) as total_sold'),
                DB::raw('SUM(order_items.line_total) as total_revenue')
            )
            ->groupBy('order_items.product_name')
            ->orderByDesc('total_revenue')
            ->limit(3)
            ->get()
            ->map(fn($item) => [
                'name' => $item->product_name,
                'total_sold' => (int) $item->total_sold,
                'total_revenue' => (float) $item->total_revenue,
            ]);

        // Yearly sales trend (current year, monthly totals)
        $currentYear = $now->year;
        $monthlyData = Order::query()
            ->whereNotIn('lifecycle_status', ['rejected'])
            ->whereYear('created_at', $currentYear)
            ->select(
                DB::raw('MONTH(created_at) as month'),
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
                    $lifecycle === 'incoming' => 'Incoming',
                    $stage === 'to_ship' => 'To Ship',
                    $stage === 'to_receive' => 'To Receive',
                    default => 'To Pay',
                };

                return [
                    'id' => $order->id,
                    'order_no_display' => $order->order_no ?: ('#' . $order->id),
                    'product_name' => $order->latestItem?->product_name ?: 'Custom Order',
                    'quantity' => max(1, (int) $order->quantity),
                    'lifecycle_status' => $order->lifecycle_status,
                    'customer_stage' => $order->customer_stage,
                    'status_label' => $statusLabel,
                    'created_at' => optional($order->created_at)->toIso8601String(),
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
                'generated_at' => now()->toIso8601String(),
            ],
        ]);
    }
}
