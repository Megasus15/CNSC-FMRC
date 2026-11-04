<?php

namespace App\Support;

use App\Models\{CustomProductRequest, Order};
use App\Services\CustomProducts;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Stable service grouping for private designs; financial totals stay in the payment ledger. */
final class CustomProductAnalytics
{
    public static function type(?string $value = null): string
    {
        $value ??= request()->input('sales_type', 'all');
        abort_unless(in_array($value, ['all','regular','custom'],true),422,'Choose All, Regular or Custom sales.');
        return $value;
    }

    public static function filter($query, ?string $type = null, string $column = 'orders.custom_product_quote_id')
    {
        $type = self::type($type);
        if ($type === 'custom') $query->whereNotNull($column);
        if ($type === 'regular') $query->whereNull($column);
        return $query;
    }

    public static function completed(Request $request): array
    {
        if (self::type() === 'regular') return [];
        $period = AnalyticsPeriod::resolve($request->query('period','month'),$request->query('from'),$request->query('to'));
        $q = Order::with('customQuote.request')->whereNotNull('custom_product_quote_id')->where('lifecycle_status','completed')->where('is_archived',false)
            ->whereHas('payment', fn($p)=>$p->whereExists(fn($r)=>$r->selectRaw('1')->from('payment_receipts')->whereColumn('payment_receipts.payment_id','payments.id')->where('livemode',true)->whereNotNull('confirmed_at')));
        if ($period['start'] && $period['end']) $q->whereBetween(DB::raw('COALESCE(completed_at, created_at)'),[$period['start']->copy()->utc(),$period['end']->copy()->utc()]);
        $groups = [];
        foreach ($q->get() as $o) {
            $s = $o->customQuote?->snapshot['service'] ?? [];
            $id = $s['id'] ?? 'unavailable'; $name = $s['title'] ?? 'Custom fabrication';
            $key = $id.':'.$name;
            $groups[$key] ??= ['name'=>'Custom · '.$name,'product_name'=>'Custom · '.$name,'product_code'=>'CUSTOM-'.$id,
                'category'=>'Custom Products','service_id'=>$s['id'] ?? null,'service_name'=>$name,'order_type'=>'custom',
                'total_sold'=>0,'total_revenue'=>0.0,'order_count'=>0,'status'=>'Custom','status_class'=>'high'];
            $groups[$key]['total_sold'] += (int)$o->quantity;
            $groups[$key]['total_revenue'] += (float)$o->subtotal;
            $groups[$key]['order_count']++;
        }
        return array_values($groups);
    }

    public static function operational(): array
    {
        $requests = CustomProductRequest::where('status','!=','draft');
        $orders = Order::whereNotNull('custom_product_quote_id')->where('is_archived',false)->whereNotIn('lifecycle_status',['cancelled','rejected','completed']);
        $revision = hash('sha256', json_encode([
            GatewayFinancials::revision(),
            CustomProductRequest::selectRaw('COUNT(*) as records, COALESCE(SUM(revision),0) as revision')->first(),
            Order::whereNotNull('custom_product_quote_id')->selectRaw('COUNT(*) as records, MAX(updated_at) as updated, SUM(is_archived) as archived')->first(),
            (clone $orders)->selectRaw('production_status, COUNT(*) as records')->groupBy('production_status')->get(),
        ]));
        return ['revision'=>$revision, 'requests_to_review'=>(clone $requests)->whereIn('status',['submitted','under_review'])->count(),
            'needs_information'=>(clone $requests)->where('status','needs_information')->count(),
            'quotations_awaiting_payment'=>(clone $requests)->where('status','quoted')->count() + (clone $orders)->whereHas('payment',fn($q)=>$q->where('status','pending'))->count(),
            'awaiting_production'=>(clone $orders)->where('production_status','not_started')->whereHas('payment',fn($q)=>$q->where('status','paid'))->count(),
            'in_production'=>(clone $orders)->where('production_status','in_production')->count()];
    }
}
