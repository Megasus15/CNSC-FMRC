<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\{Order, Payment};
use App\Services\{GatewayPayments, PayMongoService};
use App\Support\RefundStatus;
use App\Support\OnlineRefundArchive;
use Illuminate\Http\{Request, JsonResponse};
use Illuminate\Support\Facades\DB;

class GatewayManagementController extends Controller
{
    private function team(Request $r): void { abort_unless(in_array($r->user()?->role, ['admin','staff'], true), 403); }
    public function index(Request $r, PayMongoService $provider, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        $filter = $r->validate(['search'=>'nullable|string|max:100','refund_status'=>'nullable|in:requested,processing,failed,succeeded','order_id'=>'nullable|integer|min:1']);
        $rows = $this->paymentQuery()
            ->when(OnlineRefundArchive::available(), fn($q)=>$q->whereNull('payments.online_refund_archived_at'))
            ->whereExists(fn($f)=>$f->selectRaw('1')->from('payment_refunds')->whereColumn('payment_refunds.payment_id','payments.id'))
            ->when($r->filled('search'),fn($q)=>$q->where(fn($s)=>$s->where('orders.order_no','like','%'.$filter['search'].'%')->orWhere('orders.customer_name','like','%'.$filter['search'].'%')))
            ->when($r->filled('refund_status'),fn($q)=>$q->whereExists(fn($f)=>$f->selectRaw('1')->from('payment_refunds')->whereColumn('payment_refunds.payment_id','payments.id')
                ->whereIn('payment_refunds.status', $filter['refund_status'] === 'processing' ? ['submitting','pending','unknown'] : [$filter['refund_status']])))
            ->when($r->filled('order_id'),fn($q)=>$q->where('orders.id',$filter['order_id']))
            ->orderByDesc('payments.id')->paginate(20);
        return $this->paymentData($r, $provider, $gateway, $rows);
    }

    /** Read one online payment without adding it to the refund workspace. */
    public function show(Request $r, Order $order, PayMongoService $provider, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        abort_unless(GatewayPayments::managed($order->payment), 404, 'No online payment was found for this order.');
        $rows = $this->paymentQuery()->where('orders.id',$order->id)->paginate(20);
        return $this->paymentData($r, $provider, $gateway, $rows);
    }

    private function paymentQuery(): \Illuminate\Database\Query\Builder {
        return DB::table('payments')->join('orders','orders.id','=','payments.order_id')
            ->where('payments.method','GCash')
            ->select(['payments.id','payments.order_id','orders.order_no','orders.customer_name','orders.lifecycle_status','orders.cancel_state','orders.cancel_reason','orders.cancel_reason_detail','orders.cancel_requested_at','orders.cancel_decision_note','payments.amount','payments.status','payments.gateway','payments.reference','payments.paymongo_checkout_id','payments.paymongo_payment_id','payments.paid_at']);
    }

    private function paymentData(Request $r, PayMongoService $provider, GatewayPayments $gateway, \Illuminate\Pagination\LengthAwarePaginator $rows): JsonResponse {
        $ids = collect($rows->items())->pluck('id');
        $gateway->refreshRefunds($ids->all());
        $currentStatuses=DB::table('payments')->whereIn('id',$ids)->pluck('status','id');
        $refunds = DB::table('payment_refunds')->whereIn('payment_id', $ids)->orderByDesc('id')->get();
        $archiveAvailable = OnlineRefundArchive::available();
        foreach($rows->items() as $row) {
            $row->status=$currentStatuses[$row->id] ?? $row->status;
            $row->cancel_reason_label=Order::CANCEL_REASON_LABELS[$row->cancel_reason] ?? $row->cancel_reason;
            $row->refund_archive_reason = $archiveAvailable
                ? OnlineRefundArchive::blockedReason($refunds->where('payment_id', $row->id), $row->cancel_state)
                : 'Refund archiving is temporarily unavailable.';
            $row->can_archive_refunds = $row->refund_archive_reason === null;
        }
        $summary = DB::table('payment_refunds')->where('livemode',$provider->isLive())
            ->where(fn($q)=>$q->whereNotIn('status',['failed','rejected'])->orWhereNotExists(fn($new)=>$new->selectRaw('1')->from('payment_refunds as newer')
                ->whereColumn('newer.payment_id','payment_refunds.payment_id')->whereColumn('newer.provider_payment_id','payment_refunds.provider_payment_id')->whereColumn('newer.id','>','payment_refunds.id')))
            ->selectRaw('status, COUNT(*) as count, SUM(amount_centavos) as amount')->groupBy('status')->get()->keyBy('status');
        return response()->json(['payments' => $rows, 'attempts' => DB::table('payment_attempts')->whereIn('payment_id', $ids)->get(),
            'receipts' => DB::table('payment_receipts')->whereIn('payment_id', $ids)->get(),
            'refunds' => RefundStatus::details($refunds),
            'can_approve' => $r->user()->role === 'admin', 'enabled' => $provider->acceptsNewPayments(),
            'refunds_awaiting_approval' => (int) ($summary->get('requested')?->count ?? 0),
            'refund_summary'=>['requested'=>(int) ($summary->get('requested')?->count ?? 0),
                'processing'=>(int) $summary->only(['submitting','pending','unknown'])->sum('count'),
                'failed'=>(int) ($summary->get('failed')?->count ?? 0), 'refunded_centavos'=>(int) ($summary->get('succeeded')?->amount ?? 0)],
            'livemode' => $provider->isLive(),
            'checkout_method' => $provider->checkoutMethod(), 'checkout_label' => $provider::checkoutLabel($provider->checkoutMethod()),
            'refund_funding' => $provider->isLive() && ($provider->checkoutMethod() === 'qrph' || DB::table('payment_receipts')->whereIn('payment_id',$ids)->where('source_type','qrph')->exists()) ? $provider->refundFunding() : null,
            'last_reconciled_at' => \Illuminate\Support\Facades\Cache::get('payments:last_reconciled_at'),
            'pending_events' => DB::table('payment_webhook_events')->where('status', 'pending')->count()]);
    }
    public function requestRefund(Request $r, Order $order, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        $v = $r->validate(['amount_centavos' => 'required|integer|min:100', 'reason' => 'required|string|max:400', 'request_key' => 'required|uuid', 'provider_payment_id' => 'nullable|string|max:100','issue'=>'nullable|boolean']);
        if($r->boolean('issue')) abort_unless($r->user()->role === 'admin',403);
        abort_if($order->hasPendingCancellation(),422,'Review the customer cancellation first. Use the cancellation action to cancel the order and handle its refund.');
        abort_unless($order->payment, 422);
        $refund=$gateway->requestRefund($order->payment, $v['amount_centavos'], $v['reason'], $r->user()->id, $v['request_key'], null, $v['provider_payment_id'] ?? null, $r->boolean('issue'));
        if($r->boolean('issue')) $gateway->approveRefund($refund->id,$r->user()->id);
        return response()->json(['data'=>RefundStatus::details(collect([DB::table('payment_refunds')->find($refund->id)]))->first()],201);
    }
    public function approve(Request $r, int $refund, GatewayPayments $gateway): JsonResponse {
        abort_unless($r->user()?->role === 'admin', 403);
        $gateway->approveRefund($refund, $r->user()->id);
        return response()->json(['data' => RefundStatus::details(collect([DB::table('payment_refunds')->find($refund)]))->first()]);
    }
    public function retry(Request $r, int $refund, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        $v = $r->validate(['request_key'=>'required|uuid','issue'=>'nullable|boolean']);
        if ($r->boolean('issue')) abort_unless($r->user()->role === 'admin',403);
        $previous = DB::table('payment_refunds')->find($refund);
        abort_unless($previous && $previous->status === 'failed',422,'Only a failed refund can be retried. Check pending refunds before making another request.');
        $next = $gateway->requestRefund(Payment::findOrFail($previous->payment_id),(int)$previous->amount_centavos,
            $previous->reason,$r->user()->id,$v['request_key'],$previous->order_return_id,$previous->provider_payment_id);
        if ($r->boolean('issue')) $gateway->approveRefund($next->id,$r->user()->id);
        return response()->json(['data'=>RefundStatus::details(collect([DB::table('payment_refunds')->find($next->id)]))->first()]);
    }
    public function checkRefund(Request $r, int $refund, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        $record = DB::table('payment_refunds')->find($refund);
        abort_unless($record,404);
        // A status check can retrieve an existing provider record, never issue money.
        if ($record->provider_refund_id && in_array($record->status,['pending','unknown','submitting'],true)) $gateway->reconcileRefund($record);
        return response()->json(['data'=>RefundStatus::details(collect([DB::table('payment_refunds')->find($refund)]))->first()]);
    }
    public function reject(Request $r, int $refund): JsonResponse {
        abort_unless($r->user()?->role === 'admin', 403);
        $v = $r->validate(['reason'=>'required|string|max:400']);
        DB::transaction(function () use ($r, $refund, $v) {
            $initial = DB::table('payment_refunds')->find($refund); abort_unless($initial,404);
            $payment = Payment::findOrFail($initial->payment_id);
            Order::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();
            $record = DB::table('payment_refunds')->where('id',$refund)->lockForUpdate()->first();
            abort_unless($record,404);
            if ($record->status !== 'requested') return;
            DB::table('payment_refunds')->where('id',$refund)->update(['status'=>'rejected','approved_by'=>$r->user()->id,'updated_at'=>now()]);
            \App\Models\OrderTrackingEvent::create(['order_id'=>$payment->order_id,'stage'=>$payment->order->customer_stage,
                'event_type'=>'system','title'=>'Refund request declined','description'=>$v['reason'].' Contact FMRC if you need assistance.','occurred_at'=>now()]);
        });
        return response()->json(['data' => DB::table('payment_refunds')->find($refund)]);
    }
    public function reconcile(Request $r, Order $order, GatewayPayments $gateway): JsonResponse {
        $this->team($r); abort_unless($order->payment, 422);
        $attempt = $gateway->attempt($order->payment);
        if ($attempt?->checkout_id) $gateway->reconcile($attempt->id, true);
        $gateway->queueClosedOrderRefunds($order->fresh(), $r->user()->id);
        // Refund reconciliation is performed by the scheduled worker. A refresh
        // must not authorize a refund or race another provider submission.
        return response()->json($gateway->state($order->fresh()));
    }

    /** One explicit check for the payment and all known, approved refund references. */
    public function checkStatus(Request $r, Order $order, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        abort_unless(GatewayPayments::managed($order->payment), 422, 'No online payment was found for this order.');
        $this->reconcile($r, $order, $gateway);
        foreach (DB::table('payment_refunds')->where('payment_id', $order->payment->id)
            ->whereNotNull('provider_refund_id')->whereNotNull('approved_by')
            ->whereIn('status', ['pending','unknown','submitting'])->get() as $refund) {
            // Never call reconciliation without a provider ID: that can retry submission.
            $gateway->reconcileRefund($refund);
        }
        return response()->json($gateway->state($order->fresh()));
    }

    public function archiveRefunds(Request $r, Order $order): JsonResponse {
        $this->team($r);
        abort_unless(OnlineRefundArchive::available(), 503, 'Refund archiving is temporarily unavailable.');
        DB::transaction(function () use ($r, $order) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $payment = Payment::where('order_id', $order->id)->lockForUpdate()->firstOrFail();
            abort_unless(GatewayPayments::managed($payment), 422, 'No online payment was found for this order.');
            $refunds = DB::table('payment_refunds')->where('payment_id', $payment->id)->lockForUpdate()->get();
            $reason = OnlineRefundArchive::blockedReason($refunds, $order->cancel_state);
            abort_if($reason !== null, 422, $reason ?? 'Refund cannot be archived.');
            DB::table('payments')->where('id', $payment->id)->whereNull('online_refund_archived_at')->update([
                'online_refund_archived_at' => now(), 'online_refund_archived_by' => $r->user()->id,
            ]);
        });
        return response()->json(['message' => 'Refund moved to Archives > Online refunds.']);
    }
    /** Attach only a provider record whose immutable association matches this attempt. */
    public function recoverCheckout(Request $r, Order $order, GatewayPayments $gateway, PayMongoService $provider): JsonResponse {
        abort_unless($r->user()?->role === 'admin', 403);
        $v = $r->validate(['provider_id' => ['required','regex:/^cs_[A-Za-z0-9]+$/']]);
        $attempt = $order->payment ? $gateway->attempt($order->payment) : null;
        abort_unless($attempt && !$attempt->checkout_id, 422, 'This checkout already has a provider reference. Use Reconcile.');
        $response = $provider->retrieveCheckoutSession($v['provider_id']);
        $a = $response['data']['attributes'] ?? []; $m = $a['metadata'] ?? [];
        abort_unless(($m['attempt_token'] ?? '') === $attempt->token && (string) ($m['payment_id'] ?? '') === (string) $attempt->payment_id
            && (string) ($m['order_id'] ?? '') === (string) $order->id && ($a['livemode'] ?? null) === (bool) $attempt->livemode, 422, 'This provider record does not match the payment request.');
        DB::table('payment_attempts')->where('id', $attempt->id)->whereNull('checkout_id')->update([
            'checkout_id' => $v['provider_id'], 'checkout_url' => $gateway->safeUrl($a['checkout_url'] ?? null) ? $a['checkout_url'] : null,
            'exception' => null, 'updated_at' => now()]);
        $gateway->reconcile($attempt->id, true);
        return response()->json($gateway->state($order->fresh()));
    }
    public function recoverRefund(Request $r, int $refund, GatewayPayments $gateway, PayMongoService $provider): JsonResponse {
        abort_unless($r->user()?->role === 'admin', 403);
        $v = $r->validate(['provider_id' => ['required','regex:/^ref_[A-Za-z0-9]+$/']]);
        $record = DB::table('payment_refunds')->find($refund);
        abort_unless($record && $record->approved_by && !$record->provider_refund_id && in_array($record->status,['unknown','submitting'],true), 422);
        $payment = Payment::findOrFail($record->payment_id);
        $qrph=DB::table('payment_receipts')->where('payment_id',$payment->id)->where('provider_payment_id',$record->provider_payment_id)->value('source_type') === 'qrph';
        $response = $provider->retrieveRefund($v['provider_id'],$qrph,$record->provider_payment_id); $a = $response['data']['attributes'] ?? [];
        abort_unless(($a['payment_id'] ?? '') === $record->provider_payment_id && (int) ($a['amount'] ?? -1) === (int) $record->amount_centavos
            && ($a['livemode'] ?? null) === (bool) $record->livemode && str_contains($a['notes'] ?? '', '[FMRC '.$record->token.']'), 422, 'This provider refund does not match the approved request.');
        DB::table('payment_refunds')->where('id',$record->id)->whereNull('provider_refund_id')->update(['provider_refund_id'=>$v['provider_id']]);
        $gateway->reconcileRefund(DB::table('payment_refunds')->find($record->id));
        return response()->json(['data'=>DB::table('payment_refunds')->find($record->id)]);
    }

}
