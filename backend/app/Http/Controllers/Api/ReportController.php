<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\ReportGeneration;
use App\Models\SiteSetting;
use App\Models\WalkInOrder;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

class ReportController extends Controller
{
    private const REPORT_TIME_ZONE = 'Asia/Manila';

    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    private const CATEGORIES = [
        'sales',
        'completed_orders',
        'processing_orders',
        'appointments',
        'inventory',
    ];

    private const CATEGORY_CODES = [
        'sales' => 'SALES',
        'completed_orders' => 'COMPLETED',
        'processing_orders' => 'PROCESSING',
        'appointments' => 'APPOINTMENTS',
        'inventory' => 'INVENTORY',
    ];

    private const PERIODS = ['monthly', 'quarterly', 'yearly'];

    private const STOCK_RULES_KEY = 'inventory_stock_rules';

    private const STOCK_RULE_MODES = ['fixed', 'percent'];

    private ?array $cachedStockRules = null;

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $this->validateReportRequest($request);

        return $this->reportResponse($this->buildReportData($request, $validated));
    }

    public function generate(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $this->validateReportRequest($request, true);

        $actor = $request->user();
        $generationKey = (string) $validated['generation_key'];
        $data = $this->buildReportData($request, $validated);

        // When the report_generations table is available, persist an audit
        // trail record.  When it is not (migration has not run yet), the
        // report is still generated and returned — only the tracking row
        // is skipped so the operator is never blocked. ensureSchema() creates
        // the table on first use so a build that reaches the server before its
        // migration is run by hand still counts its generations.
        if (ReportGeneration::ensureSchema()) {
            $existing = ReportGeneration::query()
                ->where('generation_key', $generationKey)
                ->first();

            if ($existing && ! $this->generationMatches($existing, $actor->id, $validated)) {
                return $this->generationKeyConflict();
            }

            if (! $existing) {
                $descriptor = $data['report'];
                $existing = ReportGeneration::query()->firstOrCreate(
                    ['generation_key' => $generationKey],
                    [
                        'generated_by_user_id' => $actor->id,
                        'generated_by_name' => $descriptor['generated_by'],
                        'generated_by_role' => $descriptor['generated_by_role'],
                        'report_code' => $this->generationReportCode(
                            $validated['category'],
                            $generationKey,
                        ),
                        'category' => $validated['category'],
                        'period' => $validated['period'],
                        'year' => $validated['year'],
                        'month' => $validated['month'],
                        'quarter' => $validated['quarter'],
                    ],
                );

                // A concurrent request can win the unique-key insert between the
                // initial lookup and firstOrCreate. Recheck ownership and filters
                // before returning any persisted report metadata.
                if (! $this->generationMatches($existing, $actor->id, $validated)) {
                    return $this->generationKeyConflict();
                }
            }

            $data['report']['id'] = $existing->report_code;
            $data['report']['generated_at'] = $existing->created_at
                ->copy()
                ->setTimezone(self::REPORT_TIME_ZONE)
                ->toIso8601String();
            $data['report']['generated_by'] = $existing->generated_by_name;
            $data['report']['generated_by_role'] = $existing->generated_by_role;
        }

        return $this->reportResponse($data);
    }

    /** @return array<string, mixed> */
    private function validateReportRequest(Request $request, bool $withGenerationKey = false): array
    {
        $currentYear = Carbon::now(self::REPORT_TIME_ZONE)->year;
        $rules = [
            'category' => ['required', 'string', Rule::in(self::CATEGORIES)],
            'period' => ['required', 'string', Rule::in(self::PERIODS)],
            'year' => ['required', 'integer', 'between:2000,'.($currentYear + 1)],
            'month' => ['nullable', 'integer', 'between:1,12', 'required_if:period,monthly'],
            'quarter' => ['nullable', 'integer', 'between:1,4', 'required_if:period,quarterly'],
        ];

        if ($withGenerationKey) {
            $rules['generation_key'] = ['required', 'string', 'max:100'];
        }

        $validated = $request->validate($rules);
        $validated['category'] = (string) $validated['category'];
        $validated['period'] = (string) $validated['period'];
        $validated['year'] = (int) $validated['year'];
        $validated['month'] = $validated['period'] === 'monthly'
            ? (int) $validated['month']
            : null;
        $validated['quarter'] = $validated['period'] === 'quarterly'
            ? (int) $validated['quarter']
            : null;

        return $validated;
    }

    /** @param array<string, mixed> $validated */
    private function buildReportData(Request $request, array $validated): array
    {

        $period = $this->resolvePeriod(
            $validated['period'],
            $validated['year'],
            $validated['month'],
            $validated['quarter'],
        );

        $category = $validated['category'];
        $content = match ($category) {
            'sales' => $this->salesReport($period),
            'completed_orders' => $this->completedOrdersReport($period),
            'processing_orders' => $this->processingOrdersReport($period),
            'appointments' => $this->appointmentsReport($period),
            'inventory' => $this->inventoryReport($period),
        };

        return [
            'report' => $this->reportDescriptor($request, $category, $period),
            'metrics' => $content['metrics'],
            'chart' => $content['chart'],
            'breakdown' => $content['breakdown'],
            'table' => $content['table'],
        ];
    }

    private function reportResponse(array $data): JsonResponse
    {
        return $this->noStoreResponse(['data' => $data]);
    }

    private function noStoreResponse(array $payload, int $status = 200): JsonResponse
    {
        return response()->json($payload, $status)
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
            ->header('Pragma', 'no-cache')
            ->header('Expires', '0');
    }

    /** @param array<string, mixed> $validated */
    private function generationMatches(
        ReportGeneration $generation,
        int $actorId,
        array $validated,
    ): bool {
        return (int) $generation->generated_by_user_id === $actorId
            && $generation->category === $validated['category']
            && $generation->period === $validated['period']
            && (int) $generation->year === $validated['year']
            && $generation->month === $validated['month']
            && $generation->quarter === $validated['quarter'];
    }

    private function generationKeyConflict(): JsonResponse
    {
        return $this->noStoreResponse([
            'message' => 'This generation key was already used by another report request. Create a new key and try again.',
            'code' => 'REPORT_GENERATION_KEY_CONFLICT',
        ], 409);
    }

    private function generationReportCode(string $category, string $generationKey): string
    {
        return 'RPT-'.self::CATEGORY_CODES[$category].'-'.strtoupper(hash('sha256', $generationKey));
    }

    private function salesReport(array $period): array
    {
        $onlineQuery = Order::query()
            ->with(['payment:id,order_id,method,status'])
            ->where('lifecycle_status', 'completed');
        $this->applyFallbackTimestampRange(
            $onlineQuery,
            'completed_at',
            'created_at',
            $period['start_utc'],
            $period['end_utc'],
        );
        $onlineOrders = $onlineQuery->get();

        // GCash is collected up front, so an approved GCash order is recognised
        // revenue even before fulfilment completes. Mirrors the dashboard
        // Total Revenue card; 'pending' and 'completed' are mutually exclusive
        // lifecycle states, so nothing is counted twice.
        $advanceQuery = Order::query()
            ->with(['payment:id,order_id,method,status'])
            ->where('lifecycle_status', 'pending')
            ->where('payment_method', 'GCash')
            ->whereNotNull('approved_at');
        $this->applyFallbackTimestampRange(
            $advanceQuery,
            'approved_at',
            'created_at',
            $period['start_utc'],
            $period['end_utc'],
        );
        $advanceOrders = $advanceQuery->get();

        $walkInQuery = WalkInOrder::query();
        $this->applyWalkInTimestampRange(
            $walkInQuery,
            $period['start_local'],
            $period['end_local'],
            $period['start_utc'],
            $period['end_utc'],
        );
        $walkInOrders = $walkInQuery->get();

        // Money is committed back to the customer from 'approved' onward, and
        // only 'refund' resolutions actually return money. Keep this in step
        // with AdminDashboardController::summary() via the shared constant so
        // Net Sales and the dashboard Total Revenue card cannot drift.
        $refundQuery = OrderReturn::query()
            ->with(['order:id,order_no,customer_name,is_archived'])
            ->whereIn('status', OrderReturn::REVENUE_DEDUCTING_STATUSES)
            ->where('resolution', 'refund');
        $this->applyFallbackTimestampRange(
            $refundQuery,
            'refunded_at',
            'decided_at',
            $period['start_utc'],
            $period['end_utc'],
        );
        $refunds = $refundQuery
            ->orderByRaw('COALESCE(refunded_at, decided_at) asc')
            ->get();

        [$labels, $bucketKeys] = $this->chartBuckets($period);
        $onlineSeries = array_fill(0, count($labels), 0.0);
        $walkInSeries = array_fill(0, count($labels), 0.0);
        $refundSeries = array_fill(0, count($labels), 0.0);
        $rows = [];
        $onlineSales = 0.0;
        $advanceSales = 0.0;
        $walkInSales = 0.0;
        $refundsIssued = 0.0;

        foreach ($onlineOrders as $order) {
            $transactionDate = $order->completed_at ?? $order->created_at;
            $amount = (float) $order->total;
            $onlineSales += $amount;
            $this->addToBucket($onlineSeries, $bucketKeys, $transactionDate, $amount, $period['period']);

            $rows[] = [
                'source' => 'Online Order',
                'transaction_no' => $order->order_no ?: ('ORD-'.$order->id),
                'transaction_date' => $this->formatReportTimestamp($transactionDate),
                'customer' => $order->customer_name ?: 'Unknown Customer',
                'status' => 'Completed',
                'payment_method' => $order->payment?->method ?: ($order->payment_method ?: 'Not specified'),
                'amount' => round($amount, 2),
                'archived' => (bool) $order->is_archived,
                '_sort_at' => $this->timestampValue($transactionDate),
            ];
        }

        foreach ($advanceOrders as $order) {
            $transactionDate = $order->approved_at ?? $order->created_at;
            $amount = (float) $order->total;
            $advanceSales += $amount;
            $this->addToBucket($onlineSeries, $bucketKeys, $transactionDate, $amount, $period['period']);

            $rows[] = [
                'source' => 'Online Order (GCash Paid)',
                'transaction_no' => $order->order_no ?: ('ORD-'.$order->id),
                'transaction_date' => $this->formatReportTimestamp($transactionDate),
                'customer' => $order->customer_name ?: 'Unknown Customer',
                'status' => 'Approved',
                'payment_method' => $order->payment?->method ?: ($order->payment_method ?: 'GCash'),
                'amount' => round($amount, 2),
                'archived' => (bool) $order->is_archived,
                '_sort_at' => $this->timestampValue($transactionDate),
            ];
        }

        foreach ($walkInOrders as $order) {
            $transactionDate = $this->walkInTransactionDate($order);
            $amount = (float) $order->total;
            $walkInSales += $amount;
            $this->addToBucket($walkInSeries, $bucketKeys, $transactionDate, $amount, $period['period']);

            $rows[] = [
                'source' => 'Walk-in Order',
                'transaction_no' => $order->order_no ?: ('WALKIN-'.$order->id),
                'transaction_date' => $this->formatReportTimestamp($transactionDate),
                'customer' => $order->customer_name ?: ($order->customer ?: 'Walk-in Customer'),
                'status' => $order->status ?: 'Pending',
                'payment_method' => $order->payment_method ?: 'WALKIN VIA CASHIER',
                'amount' => round($amount, 2),
                'archived' => (bool) ($order->is_archived ?? false),
                '_sort_at' => $this->timestampValue($transactionDate),
            ];
        }

        foreach ($refunds as $refund) {
            $transactionDate = $refund->refunded_at ?? $refund->decided_at;
            $amount = max(0.0, (float) ($refund->refunded_amount ?? $refund->approved_amount ?? 0));
            $refundsIssued += $amount;
            $this->addToBucket($refundSeries, $bucketKeys, $transactionDate, -$amount, $period['period']);

            $rows[] = [
                'source' => 'Order Refund',
                'transaction_no' => $refund->return_no ?: ('RETURN-'.$refund->id),
                'transaction_date' => $this->formatReportTimestamp($transactionDate),
                'customer' => $refund->order?->customer_name ?: 'Unknown Customer',
                'status' => OrderReturn::STATUS_LABELS[$refund->status] ?? 'Refunded',
                'payment_method' => $refund->refundMethodLabel() ?: 'Not specified',
                'amount' => round(-$amount, 2),
                'archived' => (bool) $refund->is_archived,
                '_sort_at' => $this->timestampValue($transactionDate),
            ];
        }

        $rows = $this->sortAndCleanRows($rows);
        $grossSales = $onlineSales + $advanceSales + $walkInSales;
        $netSales = $grossSales - $refundsIssued;

        return [
            'metrics' => [
                $this->metric('gross_sales', 'Gross Sales', round($grossSales, 2), 'currency'),
                $this->metric('refunds_issued', 'Refunds (Approved & Released)', round($refundsIssued, 2), 'currency'),
                $this->metric('net_sales', 'Net Sales', round($netSales, 2), 'currency'),
                $this->metric('online_sales', 'Online Sales', round($onlineSales + $advanceSales, 2), 'currency'),
                $this->metric('walk_in_sales', 'Walk-in Sales', round($walkInSales, 2), 'currency'),
                $this->metric('total_transactions', 'Transactions', count($rows), 'integer'),
            ],
            'chart' => [
                'title' => 'Sales Trend',
                'value_type' => 'currency',
                'labels' => $labels,
                'series' => [
                    ['name' => 'Online Sales', 'values' => $this->roundSeries($onlineSeries)],
                    ['name' => 'Walk-in Sales', 'values' => $this->roundSeries($walkInSeries)],
                    ['name' => 'Refunds', 'values' => $this->roundSeries($refundSeries)],
                ],
            ],
            'breakdown' => [
                'title' => 'Sales and Refunds',
                'value_type' => 'currency',
                'items' => [
                    ['label' => 'Completed Online Orders', 'value' => round($onlineSales, 2)],
                    ['label' => 'Approved GCash Orders', 'value' => round($advanceSales, 2)],
                    ['label' => 'Walk-in Orders', 'value' => round($walkInSales, 2)],
                    ['label' => 'Refunds (Approved & Released)', 'value' => round(-$refundsIssued, 2)],
                    ['label' => 'Net Sales', 'value' => round($netSales, 2)],
                ],
            ],
            'table' => [
                'title' => 'Sales & Refund Transactions',
                'columns' => [
                    $this->column('source', 'Source'),
                    $this->column('transaction_no', 'Transaction No.'),
                    $this->column('transaction_date', 'Date', 'datetime'),
                    $this->column('customer', 'Customer'),
                    $this->column('status', 'Status', 'status'),
                    $this->column('payment_method', 'Payment Method'),
                    $this->column('amount', 'Amount', 'currency'),
                    $this->column('archived', 'Archived', 'boolean'),
                ],
                'rows' => $rows,
            ],
        ];
    }

    private function completedOrdersReport(array $period): array
    {
        $query = Order::query()
            ->with([
                'payment:id,order_id,method,status',
                'items:id,order_id,quantity',
            ])
            ->where('lifecycle_status', 'completed');
        $this->applyFallbackTimestampRange(
            $query,
            'completed_at',
            'created_at',
            $period['start_utc'],
            $period['end_utc'],
        );
        $orders = $query->get();

        [$labels, $bucketKeys] = $this->chartBuckets($period);
        $series = array_fill(0, count($labels), 0);
        $rows = [];
        $totalValue = 0.0;
        $totalItems = 0;
        $paymentCounts = [];

        foreach ($orders as $order) {
            $completedAt = $order->completed_at ?? $order->created_at;
            $amount = (float) $order->total;
            $itemQuantity = (int) $order->items->sum('quantity');
            if ($itemQuantity < 1) {
                $itemQuantity = max(1, (int) $order->quantity);
            }

            $paymentStatus = strtolower(trim((string) ($order->payment?->status ?: 'pending')));
            $paymentStatus = $paymentStatus !== '' ? $paymentStatus : 'pending';
            $paymentCounts[$paymentStatus] = ($paymentCounts[$paymentStatus] ?? 0) + 1;
            $totalValue += $amount;
            $totalItems += $itemQuantity;
            $this->addToBucket($series, $bucketKeys, $completedAt, 1, $period['period']);

            $rows[] = [
                'order_no' => $order->order_no ?: ('ORD-'.$order->id),
                'completed_at' => $this->formatReportTimestamp($completedAt),
                'customer' => $order->customer_name ?: 'Unknown Customer',
                'items' => $itemQuantity,
                'payment_method' => $order->payment?->method ?: ($order->payment_method ?: 'Not specified'),
                'payment_status' => ucfirst($paymentStatus),
                'amount' => round($amount, 2),
                'archived' => (bool) $order->is_archived,
                '_sort_at' => $this->timestampValue($completedAt),
            ];
        }

        $rows = $this->sortAndCleanRows($rows);
        $orderCount = count($rows);
        ksort($paymentCounts);

        return [
            'metrics' => [
                $this->metric('total_orders', 'Completed Orders', $orderCount, 'integer'),
                $this->metric('total_value', 'Order Value', round($totalValue, 2), 'currency'),
                $this->metric(
                    'average_order_value',
                    'Average Order Value',
                    $orderCount > 0 ? round($totalValue / $orderCount, 2) : 0.0,
                    'currency',
                ),
                $this->metric('total_items', 'Items Sold', $totalItems, 'integer'),
            ],
            'chart' => [
                'title' => 'Completed Orders Trend',
                'value_type' => 'integer',
                'labels' => $labels,
                'series' => [
                    ['name' => 'Completed Orders', 'values' => array_values($series)],
                ],
            ],
            'breakdown' => [
                'title' => 'Completed Orders by Payment Status',
                'value_type' => 'integer',
                'items' => collect($paymentCounts)
                    ->map(fn (int $value, string $label) => [
                        'label' => ucfirst($label),
                        'value' => $value,
                    ])
                    ->values()
                    ->all(),
            ],
            'table' => [
                'title' => 'Completed Orders',
                'columns' => [
                    $this->column('order_no', 'Order No.'),
                    $this->column('completed_at', 'Completed', 'datetime'),
                    $this->column('customer', 'Customer'),
                    $this->column('items', 'Items', 'integer'),
                    $this->column('payment_method', 'Payment Method'),
                    $this->column('payment_status', 'Payment Status', 'status'),
                    $this->column('amount', 'Amount', 'currency'),
                    $this->column('archived', 'Archived', 'boolean'),
                ],
                'rows' => $rows,
            ],
        ];
    }

    private function processingOrdersReport(array $period): array
    {
        $orders = Order::query()
            ->with(['payment:id,order_id,status'])
            ->whereIn('lifecycle_status', ['incoming', 'pending'])
            ->where('is_archived', false)
            ->where('created_at', '>=', $period['start_utc'])
            ->where('created_at', '<', $period['end_utc'])
            ->get();

        [$labels, $bucketKeys] = $this->chartBuckets($period);
        $series = array_fill(0, count($labels), 0);
        $rows = [];
        $incomingCount = 0;
        $pendingCount = 0;
        $totalValue = 0.0;

        foreach ($orders as $order) {
            $lifecycle = strtolower(trim((string) $order->lifecycle_status));
            if ($lifecycle === 'incoming') {
                $incomingCount++;
            } else {
                $pendingCount++;
            }

            $amount = (float) $order->total;
            $totalValue += $amount;
            $this->addToBucket($series, $bucketKeys, $order->created_at, 1, $period['period']);

            $rows[] = [
                'order_no' => $order->order_no ?: ('ORD-'.$order->id),
                'created_at' => $this->formatReportTimestamp($order->created_at),
                'customer' => $order->customer_name ?: 'Unknown Customer',
                'lifecycle_status' => ucfirst($lifecycle ?: 'pending'),
                'customer_stage' => $this->stageLabel((string) $order->customer_stage),
                'payment_status' => ucfirst((string) ($order->payment?->status ?: 'pending')),
                'amount' => round($amount, 2),
                'archived' => (bool) $order->is_archived,
                '_sort_at' => $this->timestampValue($order->created_at),
            ];
        }

        $rows = $this->sortAndCleanRows($rows);

        return [
            'metrics' => [
                $this->metric('total_orders', 'Processing Orders', count($rows), 'integer'),
                $this->metric('incoming_orders', 'Incoming Orders', $incomingCount, 'integer'),
                $this->metric('pending_orders', 'Pending Orders', $pendingCount, 'integer'),
                $this->metric('total_value', 'Processing Value', round($totalValue, 2), 'currency'),
            ],
            'chart' => [
                'title' => 'Processing Orders Trend',
                'value_type' => 'integer',
                'labels' => $labels,
                'series' => [
                    ['name' => 'Processing Orders', 'values' => array_values($series)],
                ],
            ],
            'breakdown' => [
                'title' => 'Processing Orders by Status',
                'value_type' => 'integer',
                'items' => [
                    ['label' => 'Incoming', 'value' => $incomingCount],
                    ['label' => 'Pending', 'value' => $pendingCount],
                ],
            ],
            'table' => [
                'title' => 'Processing Orders',
                'columns' => [
                    $this->column('order_no', 'Order No.'),
                    $this->column('created_at', 'Created', 'datetime'),
                    $this->column('customer', 'Customer'),
                    $this->column('lifecycle_status', 'Status', 'status'),
                    $this->column('customer_stage', 'Customer Stage', 'status'),
                    $this->column('payment_status', 'Payment Status', 'status'),
                    $this->column('amount', 'Amount', 'currency'),
                    $this->column('archived', 'Archived', 'boolean'),
                ],
                'rows' => $rows,
            ],
        ];
    }

    private function appointmentsReport(array $period): array
    {
        $appointments = Appointment::query()
            ->where('appointment_date', '>=', $period['start_date'])
            ->where('appointment_date', '<', $period['end_date_exclusive'])
            ->orderByDesc('appointment_date')
            ->orderByDesc('id')
            ->get();

        [$labels, $bucketKeys] = $this->chartBuckets($period);
        $series = array_fill(0, count($labels), 0);
        $rows = [];
        $completedCount = 0;
        $scheduledCount = 0;
        $pendingCount = 0;
        $cancelledCount = 0;

        foreach ($appointments as $appointment) {
            $rawStatus = trim((string) $appointment->status);
            $status = strtolower($rawStatus);
            if (in_array($status, ['completed', 'archived'], true)) {
                $completedCount++;
            } elseif ($status === 'cancelled') {
                $cancelledCount++;
            } elseif ($status === 'pending') {
                $pendingCount++;
            } else {
                $scheduledCount++;
            }

            $this->addToBucket($series, $bucketKeys, $appointment->appointment_date, 1, $period['period']);

            $middleInitial = trim((string) $appointment->middle_initial);
            $middleInitial = $middleInitial !== '' ? rtrim($middleInitial, '.').'.' : '';
            $clientName = trim(implode(' ', array_filter([
                trim((string) $appointment->first_name),
                $middleInitial,
                trim((string) $appointment->last_name),
            ])));

            $rows[] = [
                'reference_no' => $appointment->reference_no ?: ('APT-'.$appointment->id),
                'appointment_date' => $appointment->appointment_date?->format('Y-m-d'),
                'appointment_time' => $appointment->appointment_time ?: 'Not specified',
                'client_name' => $clientName !== '' ? $clientName : 'Unknown Client',
                'purpose' => $appointment->purpose ?: 'Not specified',
                'status' => $rawStatus !== '' ? $rawStatus : 'Scheduled',
            ];
        }

        return [
            'metrics' => [
                $this->metric('total_appointments', 'Appointments', count($rows), 'integer'),
                $this->metric('completed_appointments', 'Completed', $completedCount, 'integer'),
                $this->metric('scheduled_appointments', 'Scheduled', $scheduledCount, 'integer'),
                $this->metric('pending_appointments', 'Pending', $pendingCount, 'integer'),
                $this->metric('cancelled_appointments', 'Cancelled', $cancelledCount, 'integer'),
            ],
            'chart' => [
                'title' => 'Appointment Schedule Trend',
                'value_type' => 'integer',
                'labels' => $labels,
                'series' => [
                    ['name' => 'Appointments', 'values' => array_values($series)],
                ],
            ],
            'breakdown' => [
                'title' => 'Appointments by Status',
                'value_type' => 'integer',
                'items' => [
                    ['label' => 'Completed', 'value' => $completedCount],
                    ['label' => 'Scheduled', 'value' => $scheduledCount],
                    ['label' => 'Pending', 'value' => $pendingCount],
                    ['label' => 'Cancelled', 'value' => $cancelledCount],
                ],
            ],
            'table' => [
                'title' => 'Appointments',
                'columns' => [
                    $this->column('reference_no', 'Reference No.'),
                    $this->column('appointment_date', 'Date', 'date'),
                    $this->column('appointment_time', 'Time'),
                    $this->column('client_name', 'Client'),
                    $this->column('purpose', 'Purpose'),
                    $this->column('status', 'Status', 'status'),
                ],
                'rows' => $rows,
            ],
        ];
    }

    private function inventoryReport(array $period): array
    {
        $items = InventoryItem::query()
            ->where('is_archived', false)
            ->orderBy('category')
            ->orderBy('item_name')
            ->get();

        $transactions = InventoryTransaction::query()
            ->whereIn('inventory_item_id', $items->pluck('id'))
            ->where('created_at', '>=', $period['start_utc'])
            ->where('created_at', '<', $period['end_utc'])
            ->orderBy('created_at')
            ->get();

        [$labels, $bucketKeys] = $this->chartBuckets($period);
        $stockInSeries = array_fill(0, count($labels), 0);
        $stockOutSeries = array_fill(0, count($labels), 0);
        $movementByStock = [];
        $totalStockIn = 0;
        $totalStockOut = 0;

        foreach ($transactions as $transaction) {
            $amount = max(0, (int) $transaction->amount);
            $variantId = $transaction->variant_id ? (int) $transaction->variant_id : 0;
            $stockKey = $this->inventoryStockKey((int) $transaction->inventory_item_id, $variantId);
            $movementByStock[$stockKey] ??= ['in' => 0, 'out' => 0];

            if ($transaction->type === 'out') {
                $movementByStock[$stockKey]['out'] += $amount;
                $totalStockOut += $amount;
                $this->addToBucket($stockOutSeries, $bucketKeys, $transaction->created_at, $amount, $period['period']);
            } else {
                $movementByStock[$stockKey]['in'] += $amount;
                $totalStockIn += $amount;
                $this->addToBucket($stockInSeries, $bucketKeys, $transaction->created_at, $amount, $period['period']);
            }
        }

        $rows = [];
        $unitsOnHand = 0;
        $statusCounts = [
            'Good' => 0,
            'Low Stock' => 0,
            'Out of Stock' => 0,
        ];

        foreach ($items as $item) {
            $variants = array_values(array_filter(
                is_array($item->variants) ? $item->variants : [],
                fn ($variant) => is_array($variant),
            ));

            if ($variants !== []) {
                foreach ($variants as $index => $variant) {
                    $variantId = max(1, (int) ($variant['id'] ?? ($index + 1)));
                    $onHand = max(0, (int) ($variant['on_hand'] ?? 0));
                    $baseline = (int) ($variant['initial_on_hand'] ?? $onHand);
                    $rule = $this->resolveStockRule(
                        $item->category,
                        (int) $item->id,
                        $variantId,
                    );
                    $status = $this->inventoryStatus($onHand, $baseline, $rule);
                    $movement = $movementByStock[$this->inventoryStockKey((int) $item->id, $variantId)]
                        ?? ['in' => 0, 'out' => 0];

                    $unitsOnHand += $onHand;
                    $statusCounts[$status]++;
                    $rows[] = $this->inventoryRow(
                        $item,
                        $variantId,
                        trim((string) ($variant['name'] ?? '')) ?: ('Variant '.$variantId),
                        trim((string) ($variant['unit'] ?? '')) ?: ($item->unit ?: 'pcs'),
                        $onHand,
                        $status,
                        $movement,
                    );
                }

                continue;
            }

            $onHand = max(0, (int) $item->on_hand);
            $baseline = (int) ($item->last_invent ?: $onHand);
            $rule = $this->resolveStockRule($item->category, (int) $item->id, null);
            $status = $this->inventoryStatus($onHand, $baseline, $rule);
            $movement = $movementByStock[$this->inventoryStockKey((int) $item->id, 0)]
                ?? ['in' => 0, 'out' => 0];
            $unitsOnHand += $onHand;
            $statusCounts[$status]++;
            $rows[] = $this->inventoryRow(
                $item,
                null,
                null,
                $item->unit ?: 'pcs',
                $onHand,
                $status,
                $movement,
            );
        }

        return [
            'metrics' => [
                $this->metric('stock_entries', 'Current Stock Entries', count($rows), 'integer'),
                $this->metric('units_on_hand', 'Current Units on Hand', $unitsOnHand, 'integer'),
                $this->metric('stock_in', 'Selected-Period Stock In', $totalStockIn, 'integer'),
                $this->metric('stock_out', 'Selected-Period Stock Out', $totalStockOut, 'integer'),
            ],
            'chart' => [
                'title' => 'Selected-Period Inventory Movements',
                'value_type' => 'integer',
                'labels' => $labels,
                'series' => [
                    ['name' => 'Stock In', 'values' => array_values($stockInSeries)],
                    ['name' => 'Stock Out', 'values' => array_values($stockOutSeries)],
                ],
            ],
            'breakdown' => [
                'title' => 'Current Stock Status',
                'value_type' => 'integer',
                'items' => collect($statusCounts)
                    ->map(fn (int $value, string $label) => [
                        'label' => $label,
                        'value' => $value,
                    ])
                    ->values()
                    ->all(),
            ],
            'table' => [
                'title' => 'Current Stock Snapshot with Selected-Period Movements',
                'columns' => [
                    $this->column('category', 'Category'),
                    $this->column('item_name', 'Item'),
                    $this->column('variant', 'Variant'),
                    $this->column('unit', 'Unit'),
                    $this->column('on_hand', 'On Hand', 'integer'),
                    $this->column('status', 'Status', 'status'),
                    $this->column('stock_in', 'Period Stock In', 'integer'),
                    $this->column('stock_out', 'Period Stock Out', 'integer'),
                    $this->column('net_movement', 'Period Net Movement', 'integer'),
                    $this->column('updated_at', 'Last Updated', 'datetime'),
                ],
                'rows' => $rows,
            ],
        ];
    }

    private function resolvePeriod(
        string $period,
        int $year,
        ?int $month,
        ?int $quarter,
    ): array {
        if ($period === 'monthly') {
            $startLocal = Carbon::create($year, $month, 1, 0, 0, 0, self::REPORT_TIME_ZONE);
            $endLocal = $startLocal->copy()->addMonth();
            $label = $startLocal->format('F Y');
        } elseif ($period === 'quarterly') {
            $firstMonth = (((int) $quarter - 1) * 3) + 1;
            $startLocal = Carbon::create($year, $firstMonth, 1, 0, 0, 0, self::REPORT_TIME_ZONE);
            $endLocal = $startLocal->copy()->addMonths(3);
            $label = 'Q'.$quarter.' '.$year;
        } else {
            $startLocal = Carbon::create($year, 1, 1, 0, 0, 0, self::REPORT_TIME_ZONE);
            $endLocal = $startLocal->copy()->addYear();
            $label = (string) $year;
        }

        return [
            'period' => $period,
            'year' => $year,
            'month' => $month,
            'quarter' => $quarter,
            'label' => $label,
            'start_local' => $startLocal,
            'end_local' => $endLocal,
            'start_utc' => $startLocal->copy()->utc(),
            'end_utc' => $endLocal->copy()->utc(),
            'start_date' => $startLocal->format('Y-m-d'),
            'end_date' => $endLocal->copy()->subDay()->format('Y-m-d'),
            'end_date_exclusive' => $endLocal->format('Y-m-d'),
        ];
    }

    private function reportDescriptor(Request $request, string $category, array $period): array
    {
        $generatedAt = Carbon::now(self::REPORT_TIME_ZONE);
        $titles = [
            'sales' => 'Overall Sales Report',
            'completed_orders' => 'Completed Orders Report',
            'processing_orders' => 'Processing Orders Report',
            'appointments' => 'Appointments Report',
            'inventory' => 'Current Stock Snapshot & Selected-Period Movements',
        ];
        $user = $request->user();
        $generatedBy = trim((string) ($user?->name ?? ''))
            ?: trim((string) ($user?->username ?? ''))
            ?: trim((string) ($user?->email ?? ''))
            ?: 'Admin/Staff';
        $generatedByRole = strtolower(trim((string) ($user?->role ?? '')));

        return [
            'id' => 'RPT-'.self::CATEGORY_CODES[$category].'-'.$generatedAt->format('Ymd-His-v'),
            'title' => $titles[$category],
            'category' => $category,
            'period' => $period['period'],
            'period_label' => $period['label'],
            'start_date' => $period['start_date'],
            'end_date' => $period['end_date'],
            'timezone' => self::REPORT_TIME_ZONE,
            'generated_at' => $generatedAt->toIso8601String(),
            'generated_by' => $generatedBy,
            'generated_by_role' => $generatedByRole !== '' ? $generatedByRole : 'admin/staff',
        ];
    }

    private function applyFallbackTimestampRange(
        Builder $query,
        string $primaryColumn,
        string $fallbackColumn,
        Carbon $startUtc,
        Carbon $endUtc,
    ): void {
        $query->where(function (Builder $dateQuery) use (
            $primaryColumn,
            $fallbackColumn,
            $startUtc,
            $endUtc,
        ) {
            $dateQuery
                ->where(function (Builder $primaryQuery) use ($primaryColumn, $startUtc, $endUtc) {
                    $primaryQuery
                        ->whereNotNull($primaryColumn)
                        ->where($primaryColumn, '>=', $startUtc)
                        ->where($primaryColumn, '<', $endUtc);
                })
                ->orWhere(function (Builder $fallbackQuery) use (
                    $primaryColumn,
                    $fallbackColumn,
                    $startUtc,
                    $endUtc,
                ) {
                    $fallbackQuery
                        ->whereNull($primaryColumn)
                        ->where($fallbackColumn, '>=', $startUtc)
                        ->where($fallbackColumn, '<', $endUtc);
                });
        });
    }

    private function applyWalkInTimestampRange(
        Builder $query,
        Carbon $startLocal,
        Carbon $endLocal,
        Carbon $startUtc,
        Carbon $endUtc,
    ): void {
        $query->where(function (Builder $dateQuery) use ($startLocal, $endLocal, $startUtc, $endUtc) {
            $dateQuery
                ->where(function (Builder $orderDateQuery) use ($startLocal, $endLocal) {
                    $orderDateQuery
                        ->whereNotNull('order_date')
                        ->where('order_date', '>=', $startLocal->format('Y-m-d H:i:s'))
                        ->where('order_date', '<', $endLocal->format('Y-m-d H:i:s'));
                })
                ->orWhere(function (Builder $createdAtQuery) use ($startUtc, $endUtc) {
                    $createdAtQuery
                        ->whereNull('order_date')
                        ->where('created_at', '>=', $startUtc)
                        ->where('created_at', '<', $endUtc);
                });
        });
    }

    private function chartBuckets(array $period): array
    {
        $labels = [];
        $keys = [];
        $cursor = $period['start_local']->copy();

        if ($period['period'] === 'monthly') {
            while ($cursor->lt($period['end_local'])) {
                $labels[] = $cursor->format('M j');
                $keys[] = $cursor->format('Y-m-d');
                $cursor->addDay();
            }
        } else {
            while ($cursor->lt($period['end_local'])) {
                $labels[] = $cursor->format('M');
                $keys[] = $cursor->format('Y-m');
                $cursor->addMonth();
            }
        }

        return [$labels, $keys];
    }

    private function addToBucket(
        array &$series,
        array $bucketKeys,
        mixed $dateTime,
        int|float $value,
        string $period,
    ): void {
        $date = $this->asReportTime($dateTime);
        if (! $date) {
            return;
        }

        $key = $period === 'monthly' ? $date->format('Y-m-d') : $date->format('Y-m');
        $index = array_search($key, $bucketKeys, true);
        if ($index !== false) {
            $series[$index] += $value;
        }
    }

    private function asReportTime(mixed $dateTime): ?Carbon
    {
        if (! $dateTime) {
            return null;
        }

        if ($dateTime instanceof DateTimeInterface) {
            return Carbon::instance($dateTime)->timezone(self::REPORT_TIME_ZONE);
        }

        return Carbon::parse((string) $dateTime, 'UTC')->timezone(self::REPORT_TIME_ZONE);
    }

    private function walkInTransactionDate(WalkInOrder $order): ?Carbon
    {
        $rawOrderDate = $order->getRawOriginal('order_date');
        if ($rawOrderDate !== null && trim((string) $rawOrderDate) !== '') {
            return Carbon::parse((string) $rawOrderDate, self::REPORT_TIME_ZONE);
        }

        return $this->asReportTime($order->created_at);
    }

    private function formatReportTimestamp(mixed $dateTime): ?string
    {
        return $this->asReportTime($dateTime)?->toIso8601String();
    }

    private function timestampValue(mixed $dateTime): int
    {
        return $this->asReportTime($dateTime)?->getTimestamp() ?? 0;
    }

    private function sortAndCleanRows(array $rows): array
    {
        usort($rows, fn (array $left, array $right) => ($right['_sort_at'] ?? 0) <=> ($left['_sort_at'] ?? 0));

        return array_map(function (array $row) {
            unset($row['_sort_at']);

            return $row;
        }, $rows);
    }

    private function roundSeries(array $series): array
    {
        return array_map(fn ($value) => round((float) $value, 2), array_values($series));
    }

    private function inventoryStockKey(int $itemId, int $variantId): string
    {
        return $itemId.':'.$variantId;
    }

    private function inventoryStatus(int $onHand, int $baseline, array $rule): string
    {
        if ($onHand <= 0) {
            return 'Out of Stock';
        }

        return $onHand <= $this->resolveLowThreshold($rule, $baseline)
            ? 'Low Stock'
            : 'Good';
    }

    private function defaultStockRule(): array
    {
        return [
            'mode' => 'fixed',
            'threshold' => 5,
        ];
    }

    private function stockRules(): array
    {
        if ($this->cachedStockRules !== null) {
            return $this->cachedStockRules;
        }

        $raw = SiteSetting::get(self::STOCK_RULES_KEY);
        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);
        if (! is_array($decoded)) {
            $decoded = [];
        }

        $this->cachedStockRules = [
            'global' => $this->sanitizeStockRule($decoded['global'] ?? null) ?? $this->defaultStockRule(),
            'categories' => $this->sanitizeStockRuleMap($decoded['categories'] ?? []),
            'items' => $this->sanitizeStockRuleMap($decoded['items'] ?? []),
            'variants' => $this->sanitizeStockRuleMap($decoded['variants'] ?? []),
        ];

        return $this->cachedStockRules;
    }

    private function sanitizeStockRuleMap(mixed $map): array
    {
        if (! is_array($map)) {
            return [];
        }

        $clean = [];
        foreach ($map as $key => $value) {
            $rule = $this->sanitizeStockRule($value);
            if ($rule !== null) {
                $clean[(string) $key] = $rule;
            }
        }

        return $clean;
    }

    private function sanitizeStockRule(mixed $rule): ?array
    {
        if (! is_array($rule)) {
            return null;
        }

        $mode = strtolower(trim((string) ($rule['mode'] ?? 'fixed')));
        if (! in_array($mode, self::STOCK_RULE_MODES, true)) {
            $mode = 'fixed';
        }

        if (! array_key_exists('threshold', $rule) || $rule['threshold'] === null || $rule['threshold'] === '') {
            return null;
        }

        $threshold = max(0, (int) $rule['threshold']);
        if ($mode === 'percent') {
            $threshold = min(100, $threshold);
        }

        return compact('mode', 'threshold');
    }

    private function resolveStockRule(?string $category, int $itemId, ?int $variantId): array
    {
        $rules = $this->stockRules();

        if ($variantId) {
            $variantKey = $itemId.':'.$variantId;
            if (isset($rules['variants'][$variantKey])) {
                return $rules['variants'][$variantKey] + ['scope' => 'variant'];
            }
        }

        if ($itemId && isset($rules['items'][(string) $itemId])) {
            return $rules['items'][(string) $itemId] + ['scope' => 'item'];
        }

        $categoryKey = trim((string) $category);
        if ($categoryKey !== '' && isset($rules['categories'][$categoryKey])) {
            return $rules['categories'][$categoryKey] + ['scope' => 'category'];
        }

        return $rules['global'] + ['scope' => 'global'];
    }

    private function resolveLowThreshold(array $rule, int $baseline): int
    {
        $threshold = (int) ($rule['threshold'] ?? 0);

        if (($rule['mode'] ?? 'fixed') === 'percent') {
            return (int) floor((max(0, $baseline) * $threshold) / 100);
        }

        return max(0, $threshold);
    }

    private function inventoryRow(
        InventoryItem $item,
        ?int $variantId,
        ?string $variantName,
        string $unit,
        int $onHand,
        string $status,
        array $movement,
    ): array {
        $stockIn = (int) ($movement['in'] ?? 0);
        $stockOut = (int) ($movement['out'] ?? 0);

        return [
            'item_id' => (int) $item->id,
            'variant_id' => $variantId,
            'category' => $item->category,
            'item_name' => $item->item_name,
            'variant' => $variantName,
            'unit' => $unit,
            'on_hand' => $onHand,
            'status' => $status,
            'stock_in' => $stockIn,
            'stock_out' => $stockOut,
            'net_movement' => $stockIn - $stockOut,
            'updated_at' => $this->formatReportTimestamp($item->updated_at ?? $item->created_at),
        ];
    }

    private function stageLabel(string $stage): string
    {
        return match (strtolower(trim($stage))) {
            'to_ship' => 'To Ship',
            'to_receive' => 'To Receive',
            'completed' => 'Completed',
            default => 'To Pay',
        };
    }

    private function metric(string $key, string $label, int|float $value, string $format): array
    {
        return compact('key', 'label', 'value', 'format');
    }

    private function column(string $key, string $label, string $type = 'text'): array
    {
        return compact('key', 'label', 'type');
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $role = strtolower(trim((string) ($request->user()?->role ?? '')));
        if (! in_array($role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }
}
