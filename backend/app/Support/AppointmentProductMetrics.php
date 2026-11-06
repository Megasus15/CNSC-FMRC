<?php

namespace App\Support;

use App\Services\AppointmentProducts;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Classification comes from the order link, never from a missing catalog ID. */
final class AppointmentProductMetrics
{
    public static function regular($query)
    {
        if (Schema::hasColumn('orders', 'appointment_product_job_id')) {
            $query->whereNull('orders.appointment_product_job_id');
        }

        return $query;
    }

    public static function cashReady(): bool
    {
        return Schema::hasTable('appointment_cash_entries') && Schema::hasColumn('orders','appointment_product_job_id');
    }

    public static function cash(bool $includeService = true)
    {
        $query=DB::table('appointment_cash_entries')->join('payments','payments.id','=','appointment_cash_entries.payment_id')
            ->join('orders','orders.id','=','payments.order_id');
        return $includeService ? $query->join('appointment_product_jobs as product_job','product_job.id','=','orders.appointment_product_job_id') : $query;
    }

    public static function cashTotal(string $kind, $start = null, $end = null): float
    {
        if (! self::cashReady()) {
            return 0;
        }
        $q = self::cash(false)->where('orders.is_archived', false);
        if ($start && $end) {
            $q->whereBetween('appointment_cash_entries.confirmed_at', [$start->copy()->utc(), $end->copy()->utc()]);
        }
        if ($kind === 'refunds') {
            $q->where('kind', 'refund');
        } else {
            $q->whereIn('kind', ['receipt', 'reversal']);
        }

        return (float) $q->selectRaw("COALESCE(SUM(CASE WHEN kind = 'reversal' THEN -amount_centavos ELSE amount_centavos END),0) as total")->value('total') / 100;
    }

    public static function sales($start = null, $end = null): array
    {
        if (!Schema::hasColumn('orders','appointment_product_job_id')||!Schema::hasColumn('appointment_product_jobs','service_name')) {
            return [];
        }
        $q = DB::table('orders')->join('order_items', 'order_items.order_id', '=', 'orders.id')
            ->join('appointment_product_jobs as product_job', 'product_job.id', '=', 'orders.appointment_product_job_id')
            ->where('orders.lifecycle_status', 'completed')->where('orders.is_archived', false);
        if ($start && $end) {
            $q->whereBetween('orders.completed_at', [$start->copy()->utc(), $end->copy()->utc()]);
        }

        return $q->groupBy('product_job.service_name')->select('product_job.service_name as service')
            ->selectRaw('SUM(order_items.quantity) as total_sold, SUM(order_items.line_total) as total_revenue, COUNT(DISTINCT orders.id) as order_count')->get()->map(fn ($row) => [
                'name' => 'Custom · '.$row->service, 'service' => $row->service, 'category' => 'Custom Products · '.$row->service, 'product_code' => 'CUSTOM',
                'product_name' => 'Custom · '.$row->service, 'total_sold' => (int) $row->total_sold, 'total_revenue' => (float) $row->total_revenue, 'order_type' => 'custom', 'order_count' => (int) $row->order_count])->all();
    }

    public static function workload(): array
    {
        if (! AppointmentProducts::installed()) {
            return ['available' => false];
        }

        return ['available' => true, 'enabled' => AppointmentProducts::enabled(),
            'awaiting_review' => DB::table('appointment_product_jobs')->whereIn('state', ['awaiting_consultation', 'needs_information', 'ready_for_quote'])->count(),
            'quotations_awaiting_payment' => DB::table('appointment_product_quotes')->whereIn('state', ['sent', 'accepted'])->where('expires_at', '>', now())->whereNotExists(function ($q) {
                $q->selectRaw('1')->from('orders')->join('payments', 'payments.order_id', '=', 'orders.id')->whereColumn('orders.appointment_product_quote_id', 'appointment_product_quotes.id')->where('payments.status', 'paid');
            })->count(),
            'awaiting_production' => DB::table('orders')->join('payments', 'payments.order_id', '=', 'orders.id')->whereNotNull('appointment_product_job_id')->where('orders.is_archived', false)->where('orders.lifecycle_status', 'incoming')->where('payments.status', 'paid')->count(),
            'in_production' => DB::table('orders')->whereNotNull('appointment_product_job_id')->where('is_archived',false)->where('lifecycle_status','pending')->where('appointment_production_status','in_production')->count()];
    }
}
