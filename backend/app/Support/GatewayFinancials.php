<?php
namespace App\Support;
use Illuminate\Support\Facades\DB;

/** Real provider receipts/refunds, independent of order approval and fulfillment. */
final class GatewayFinancials {
    public static function receipts() {
        return DB::table('payment_receipts')->join('payments','payments.id','=','payment_receipts.payment_id')
            ->join('orders','orders.id','=','payments.order_id')
            ->where('payment_receipts.livemode', true)->whereNotNull('payment_receipts.confirmed_at');
    }
    public static function refunds() {
        return DB::table('payment_refunds')->join('payments','payments.id','=','payment_refunds.payment_id')
            ->join('orders','orders.id','=','payments.order_id')
            ->where('payment_refunds.livemode',true)->where('payment_refunds.status','succeeded');
    }
    public static function total(string $kind, $start = null, $end = null): float {
        $table = $kind === 'receipts' ? 'payment_receipts' : 'payment_refunds';
        $q = $kind === 'receipts' ? self::receipts() : self::refunds();
        $q->where('orders.is_archived',false);
        if ($start && $end) $q->whereBetween($table.'.confirmed_at',[$start,$end]);
        return (float) $q->sum($table.'.amount_centavos') / 100;
    }
}
