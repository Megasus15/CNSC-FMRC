<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\{Order, Payment};
use App\Services\{GatewayPayments, PayMongoService};
use Illuminate\Http\{Request, JsonResponse};
use Illuminate\Support\Facades\DB;

class GatewayManagementController extends Controller
{
    private function team(Request $r): void { abort_unless(in_array($r->user()?->role, ['admin','staff'], true), 403); }
    public function index(Request $r, PayMongoService $provider): JsonResponse {
        $this->team($r);
        $rows = DB::table('payments')->join('orders', 'orders.id', '=', 'payments.order_id')
            ->where('payments.method', 'GCash')
            ->when($r->boolean('review'), fn($q) => $q->where(function($q) {
                $q->where('payments.reference', 'like', 'GCASH-%')->orWhere('payments.paymongo_checkout_id','like','cs_sim_%')
                  ->orWhereExists(fn($a) => $a->selectRaw('1')->from('payment_attempts')->whereColumn('payment_attempts.payment_id','payments.id')->whereNotNull('exception'));
            }))->orderByDesc('payments.id')
            ->select(['payments.id','payments.order_id','orders.order_no','orders.lifecycle_status','payments.amount','payments.status','payments.gateway','payments.reference','payments.paymongo_checkout_id','payments.paymongo_payment_id','payments.paid_at'])->paginate(30);
        $ids = collect($rows->items())->pluck('id');
        return response()->json(['payments' => $rows, 'attempts' => DB::table('payment_attempts')->whereIn('payment_id', $ids)->get(),
            'receipts' => DB::table('payment_receipts')->whereIn('payment_id', $ids)->get(),
            'refunds' => DB::table('payment_refunds')->whereIn('payment_id', $ids)->get(),
            'can_approve' => $r->user()->role === 'admin', 'enabled' => $provider->acceptsNewPayments(),
            'livemode' => $provider->isLive(),
            'checkout_method' => $provider->checkoutMethod(), 'checkout_label' => $provider::checkoutLabel($provider->checkoutMethod()),
            'last_reconciled_at' => \Illuminate\Support\Facades\Cache::get('payments:last_reconciled_at'),
            'pending_events' => DB::table('payment_webhook_events')->where('status', 'pending')->count()]);
    }
    public function requestRefund(Request $r, Order $order, GatewayPayments $gateway): JsonResponse {
        $this->team($r);
        $v = $r->validate(['amount_centavos' => 'required|integer|min:100', 'reason' => 'required|string|max:400', 'request_key' => 'required|uuid', 'provider_payment_id' => 'nullable|string|max:100']);
        abort_unless($order->payment, 422);
        return response()->json(['data' => $gateway->requestRefund($order->payment, $v['amount_centavos'], $v['reason'], $r->user()->id, $v['request_key'], null, $v['provider_payment_id'] ?? null)], 201);
    }
    public function approve(Request $r, int $refund, GatewayPayments $gateway): JsonResponse {
        abort_unless($r->user()?->role === 'admin', 403);
        $gateway->approveRefund($refund, $r->user()->id);
        return response()->json(['data' => DB::table('payment_refunds')->find($refund)]);
    }
    public function reject(Request $r, int $refund): JsonResponse {
        abort_unless($r->user()?->role === 'admin', 403);
        DB::table('payment_refunds')->where('id', $refund)->where('status', 'requested')->update(['status' => 'rejected', 'approved_by' => $r->user()->id, 'updated_at' => now()]);
        return response()->json(['data' => DB::table('payment_refunds')->find($refund)]);
    }
    public function reconcile(Request $r, Order $order, GatewayPayments $gateway): JsonResponse {
        $this->team($r); abort_unless($order->payment, 422);
        $attempt = $gateway->attempt($order->payment);
        if ($attempt?->checkout_id) $gateway->reconcile($attempt->id, true);
        return response()->json($gateway->state($order->fresh()));
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
        $response = $provider->request('GET', 'v1/refunds/'.$v['provider_id']); $a = $response['data']['attributes'] ?? [];
        abort_unless(($a['payment_id'] ?? '') === $record->provider_payment_id && (int) ($a['amount'] ?? -1) === (int) $record->amount_centavos
            && ($a['livemode'] ?? null) === (bool) $record->livemode && str_contains($a['notes'] ?? '', '[FMRC '.$record->token.']'), 422, 'This provider refund does not match the approved request.');
        DB::table('payment_refunds')->where('id',$record->id)->whereNull('provider_refund_id')->update(['provider_refund_id'=>$v['provider_id']]);
        $gateway->reconcileRefund(DB::table('payment_refunds')->find($record->id));
        return response()->json(['data'=>DB::table('payment_refunds')->find($record->id)]);
    }

}
