<?php

namespace App\Support;

use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\WalkInOrder;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The money contract in one place. Every revenue figure the back office shows —
 * the dashboard's lifetime Total Revenue, the period hero, the previous-period
 * baseline behind the delta — is this same four-term sum over a different
 * window, so the numbers can never disagree with each other.
 *
 * Terms (all exclude archived rows, matching the active-books view the
 * dashboard has always taken):
 *   + completed online orders   attributed to COALESCE(completed_at, created_at)
 *   + verified GCash advances    attributed to the payment's paid_at
 *   + walk-in counter sales      attributed to COALESCE(order_date, created_at)
 *   − refunds paid back          attributed to COALESCE(refunded_at, decided_at)
 *
 * A null [start, end] means "no date predicate" — the lifetime total. Passing
 * null therefore reproduces AdminDashboardController's original Total Revenue
 * exactly, which is what keeps `period=all` equal to `counts.total_revenue`.
 */
class FinancialMetrics
{
    /**
     * @return array{collected:float,breakdown:array{online:float,gcash_advance:float,walkins:float,refunds:float}}
     */
    public static function collected(?Carbon $start, ?Carbon $end): array
    {
        $online = self::completedOrders($start, $end);
        $gcash = self::gcashAdvance($start, $end);
        $walkins = self::walkIns($start, $end);
        $refunds = self::refunds($start, $end);

        return [
            'collected' => max(0.0, $online + $gcash + $walkins - $refunds),
            'breakdown' => [
                'online' => round($online, 2),
                'gcash_advance' => round($gcash, 2),
                'walkins' => round($walkins, 2),
                'refunds' => round($refunds, 2),
            ],
        ];
    }

    private static function completedOrders(?Carbon $start, ?Carbon $end): float
    {
        $query = Order::query()
            ->where('lifecycle_status', 'completed')
            ->where('is_archived', false);
        self::between($query, 'COALESCE(orders.completed_at, orders.created_at)', $start, $end);

        return (float) $query->sum('total');
    }

    private static function gcashAdvance(?Carbon $start, ?Carbon $end): float
    {
        // GCash is money in hand the moment staff verify the reference, so the
        // collection date is the payment's paid_at, not the order's timestamps.
        $query = Order::query()->gcashAdvanceRevenue()->where('is_archived', false);
        if ($start && $end) {
            $query->whereHas('payment', fn (Builder $payment) => $payment->whereBetween('paid_at', [$start, $end]));
        }

        return (float) $query->sum('total');
    }

    private static function walkIns(?Carbon $start, ?Carbon $end): float
    {
        $query = WalkInOrder::query()
            ->where('is_archived', false)
            ->whereRaw("LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'canceled', 'archived', 'voided')");
        self::between($query, 'COALESCE(order_date, created_at)', $start, $end);

        return (float) $query->sum('total');
    }

    private static function refunds(?Carbon $start, ?Carbon $end): float
    {
        $query = OrderReturn::query()
            ->whereIn('status', OrderReturn::REVENUE_DEDUCTING_STATUSES)
            ->where('resolution', 'refund');
        self::between($query, 'COALESCE(refunded_at, decided_at)', $start, $end);

        return (float) $query->sum(DB::raw('COALESCE(refunded_amount, approved_amount, 0)'));
    }

    private static function between(Builder $query, string $dateSql, ?Carbon $start, ?Carbon $end): void
    {
        if ($start && $end) {
            $query->whereBetween(DB::raw($dateSql), [$start, $end]);
        }
    }

    /**
     * A per-bucket "collected" trend for the hero sparkline. Four grouped reads
     * (one per term) merged in PHP, so the query count stays fixed no matter how
     * many buckets the window holds.
     *
     * The GCash slice is bucketed by the order's created_at here (not the
     * payment's paid_at as in collected()) so the series needs no join — a
     * visual trend can carry that approximation; the headline figure cannot, and
     * does not.
     *
     * @return array<int, array{label:string,amount:float}>
     */
    public static function series(Carbon $from, Carbon $to, string $granularity): array
    {
        $granularity = $granularity === 'month' ? 'month' : 'day';

        $online = self::bucketSums(
            Order::query()->where('lifecycle_status', 'completed')->where('is_archived', false),
            'COALESCE(orders.completed_at, orders.created_at)', 'total', $from, $to, $granularity
        );
        $gcash = self::bucketSums(
            Order::query()->gcashAdvanceRevenue()->where('is_archived', false),
            'orders.created_at', 'total', $from, $to, $granularity
        );
        $walkins = self::bucketSums(
            WalkInOrder::query()->where('is_archived', false)
                ->whereRaw("LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'canceled', 'archived', 'voided')"),
            'COALESCE(order_date, created_at)', 'total', $from, $to, $granularity
        );
        $refunds = self::bucketSums(
            OrderReturn::query()->whereIn('status', OrderReturn::REVENUE_DEDUCTING_STATUSES)->where('resolution', 'refund'),
            'COALESCE(refunded_at, decided_at)', 'COALESCE(refunded_amount, approved_amount, 0)', $from, $to, $granularity
        );

        $series = [];
        foreach (self::buckets($from, $to, $granularity) as $bucket) {
            $key = $bucket['key'];
            $amount = ($online[$key] ?? 0) + ($gcash[$key] ?? 0) + ($walkins[$key] ?? 0) - ($refunds[$key] ?? 0);
            $series[] = ['label' => $bucket['label'], 'amount' => round(max(0.0, $amount), 2)];
        }

        return $series;
    }

    /**
     * @return array<string, float>  bucket string => summed amount
     */
    private static function bucketSums(Builder $query, string $dateSql, string $sumSql, Carbon $from, Carbon $to, string $granularity): array
    {
        $bucketExpr = self::bucketExpr($dateSql, $granularity);

        return $query->whereBetween(DB::raw($dateSql), [$from, $to])
            ->groupBy(DB::raw($bucketExpr))
            ->select(DB::raw("{$bucketExpr} as bucket"), DB::raw("SUM({$sumSql}) as amount"))
            ->pluck('amount', 'bucket')
            ->map(fn ($value) => (float) $value)
            ->toArray();
    }

    /**
     * The bucket key expression. GROUP BY binds to the expression, never the
     * alias — SQLite and MySQL disagree on grouping by a SELECT alias, so both
     * the SELECT and the GROUP BY use this same raw string.
     */
    private static function bucketExpr(string $dateSql, string $granularity): string
    {
        $isSqlite = DB::connection()->getDriverName() === 'sqlite';

        if ($granularity === 'month') {
            return $isSqlite
                ? "strftime('%Y-%m', {$dateSql})"
                : "DATE_FORMAT({$dateSql}, '%Y-%m')";
        }

        // DATE() yields 'YYYY-MM-DD' on both engines.
        return "DATE({$dateSql})";
    }

    /**
     * The full ordered bucket list for the window, so empty days/months still
     * draw a point at zero instead of collapsing the sparkline.
     *
     * @return array<int, array{key:string,label:string}>
     */
    private static function buckets(Carbon $from, Carbon $to, string $granularity): array
    {
        $buckets = [];

        if ($granularity === 'month') {
            $cursor = $from->copy()->startOfMonth();
            while ($cursor->lessThanOrEqualTo($to)) {
                $buckets[] = ['key' => $cursor->format('Y-m'), 'label' => $cursor->format('M Y')];
                $cursor->addMonthNoOverflow();
            }

            return $buckets;
        }

        $cursor = $from->copy()->startOfDay();
        while ($cursor->lessThanOrEqualTo($to)) {
            $buckets[] = ['key' => $cursor->format('Y-m-d'), 'label' => $cursor->format('M j')];
            $cursor->addDay();
        }

        return $buckets;
    }
}
