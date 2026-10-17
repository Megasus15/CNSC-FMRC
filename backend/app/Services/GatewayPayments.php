<?php
namespace App\Services;

use App\Models\{Order, Payment, OrderTrackingEvent, AdminNotification};
use Illuminate\Support\Facades\{DB, Cache};
use Illuminate\Support\Str;
use Illuminate\Support\Carbon;

class GatewayPayments
{
    public function __construct(private PayMongoService $provider) {}
    public static function centavos(mixed $amount): int {
        $value = number_format((float) $amount, 2, '.', '');
        return (int) str_replace('.', '', $value);
    }
    public static function managed(?Payment $payment): bool {
        return $payment && ($payment->gateway === 'paymongo' || $payment->paymongo_checkout_id || $payment->paymongo_payment_id);
    }
    /** The original receipt decides the label; QR Ph does not identify the payer's wallet. */
    public static function displayFields(?Payment $payment, ?string $fallback = 'GCash'): array {
        $method = null;
        if (self::managed($payment)) {
            if ($payment->paymongo_payment_id) $method = DB::table('payment_receipts')->where('payment_id', $payment->id)
                ->where('provider_payment_id', $payment->paymongo_payment_id)->value('source_type');
            $method ??= DB::table('payment_attempts')->where('payment_id', $payment->id)->latest('id')->value('checkout_method');
            $method ??= $payment->paymongo_checkout_id || $payment->paymongo_payment_id ? 'gcash' : app(PayMongoService::class)->checkoutMethod();
        }
        $refunds = self::managed($payment) ? DB::table('payment_refunds')->where('payment_id', $payment->id)->get(['status','amount_centavos']) : collect();
        $refundStatus = $refunds->contains(fn($r) => in_array($r->status, ['submitting','pending','unknown'], true)) ? 'processing'
            : ($refunds->contains('status','requested') ? 'requested'
            : ($payment?->status === 'refunded' ? 'succeeded' : ($refunds->contains('status','failed') || $refunds->contains('status','rejected') ? 'needs_review'
            : ($refunds->contains('status','succeeded') ? 'succeeded' : null))));
        return ['payment_refund_status' => $refundStatus,
            'payment_refunded_amount' => $refunds->where('status','succeeded')->sum('amount_centavos') / 100,
            'payment_checkout_method' => $method,
            'payment_method_label' => $method ? PayMongoService::methodLabel($method) : ($payment?->method ?? $fallback)];
    }
    public function attempt(Payment $payment): ?object {
        $attempt = DB::table('payment_attempts')->where('payment_id', $payment->id)->latest('id')->first();
        if (!$attempt && $payment->paymongo_checkout_id && !str_starts_with($payment->paymongo_checkout_id, 'cs_sim_')) {
            DB::table('payment_attempts')->insertOrIgnore([
                'payment_id' => $payment->id, 'token' => (string) Str::uuid(), 'checkout_id' => $payment->paymongo_checkout_id,
                'api_version' => 'v1', 'checkout_method' => 'gcash', 'livemode' => $this->provider->isLive(), 'amount_centavos' => self::centavos($payment->amount),
                'currency' => 'PHP', 'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
            ]);
            $attempt = DB::table('payment_attempts')->where('payment_id', $payment->id)->latest('id')->first();
        }
        return $attempt;
    }
    public function checkout(Order $order, string $context = ''): array {
        abort_unless($order->payment_method === 'GCash' && self::managed($order->payment), 422, 'This order does not use automatic GCash checkout.');
        $attempt = $this->attempt($order->payment);
        if ($attempt?->checkout_id) $this->reconcile($attempt->id);
        $order->refresh();
        if ($order->payment?->status !== 'pending' || in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true)) return $this->state($order);
        abort_unless($this->provider->acceptsNewPayments(), 422, 'GCash is temporarily unavailable. Please try again later.');
        $attempt = DB::transaction(function () use ($order, $context) {
            Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $payment = Payment::query()->where('order_id', $order->id)->lockForUpdate()->firstOrFail();
            if ($payment->status !== 'pending') return null;
            $last = DB::table('payment_attempts')->where('payment_id', $payment->id)->latest('id')->first();
            if ($last && !in_array($last->status, ['expired','failed'], true)) return $last;
            $id = DB::table('payment_attempts')->insertGetId([
                'payment_id' => $payment->id, 'token' => (string) Str::uuid(), 'livemode' => $this->provider->isLive(),
                'amount_centavos' => self::centavos($payment->amount), 'currency' => 'PHP', 'app_context' => $context,
                'checkout_method' => $this->provider->checkoutMethod(),
                'status' => 'creating', 'created_at' => now(), 'updated_at' => now(),
            ]);
            return DB::table('payment_attempts')->find($id);
        });
        if ($attempt && !$attempt->checkout_id) $this->createSession($attempt);
        return $this->state($order->fresh());
    }
    public function createSession(object $attempt): void {
        if ((bool) $attempt->livemode !== $this->provider->isLive() || !$this->provider->acceptsNewPayments() || !PayMongoService::supportsMethod($attempt->checkout_method)) return;
        // Provider keys expire at 24h. Never repeat an unresolved POST after that boundary.
        if (Carbon::parse($attempt->created_at)->lt(now()->subHours(23))) {
            DB::table('payment_attempts')->where('id', $attempt->id)->update(['exception' => 'checkout_requires_reconciliation']); return;
        }
        $payment = Payment::findOrFail($attempt->payment_id); $order = $payment->order;
        if ($payment->status !== 'pending' || in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true)) return;
        $session = $this->provider->createCheckoutSession((int) $attempt->amount_centavos, 'FMRC Order '.$order->order_no, $order->order_no, $order->id, $payment->id, $attempt->app_context, $attempt->token, $attempt->checkout_method);
        if ($session['rejected'] ?? false) { DB::table('payment_attempts')->where('id', $attempt->id)->whereNull('checkout_id')->update(['status' => 'failed', 'updated_at' => now()]); return; }
        $id = $session['data']['id'] ?? null; $attrs = $session['data']['attributes'] ?? [];
        if (!$id || !$this->safeUrl($attrs['checkout_url'] ?? null) || ($attrs['livemode'] ?? null) !== (bool) $attempt->livemode) {
            DB::table('payment_attempts')->where('id', $attempt->id)->whereNull('checkout_id')->update(['status' => 'unknown', 'updated_at' => now()]); return;
        }
        DB::transaction(function () use ($attempt, $id, $attrs, $payment) {
            Order::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();
            Payment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            $row = DB::table('payment_attempts')->where('id', $attempt->id)->lockForUpdate()->first();
            if ($row->checkout_id && $row->checkout_id !== $id) throw new \RuntimeException('Checkout association mismatch.');
            DB::table('payment_attempts')->where('id', $row->id)->update([
                'checkout_id' => $id, 'checkout_url' => $attrs['checkout_url'],
                'status' => $row->confirmed_at ? 'paid' : 'pending', 'updated_at' => now(),
            ]);
            Payment::whereKey($payment->id)->update(['paymongo_checkout_id' => $id]);
        });
    }
    public function safeUrl(?string $url): bool {
        return $url && parse_url($url, PHP_URL_SCHEME) === 'https' && parse_url($url, PHP_URL_HOST) === 'checkout.paymongo.com';
    }
    public function reconcile(int $attemptId, bool $force = false): bool {
        $attempt = DB::table('payment_attempts')->find($attemptId);
        if (!$attempt || !$attempt->checkout_id || (bool) $attempt->livemode !== $this->provider->isLive()) return false;
        if (!$force && $attempt->checked_at && Carbon::parse($attempt->checked_at)->gt(now()->subSeconds(15))) return false;
        DB::table('payment_attempts')->where('id', $attemptId)->update(['checked_at' => now()]);
        $session = $this->provider->retrieveCheckoutSession($attempt->checkout_id);
        if (!$session) return false;
        $applied = $this->applySession($attemptId, $session['data'] ?? []);
        $payment = Payment::find($attempt->payment_id);
        if ($applied && !$attempt->confirmed_at && in_array($payment?->order?->lifecycle_status, ['cancelled','rejected'], true)
            && ($session['data']['attributes']['status'] ?? '') === 'active') {
            $this->provider->request('POST', 'v1/checkout_sessions/'.$attempt->checkout_id.'/expire');
        }
        return $applied;
    }
    public function applySession(int $attemptId, array $session): bool {
        $initial = DB::table('payment_attempts')->find($attemptId);
        if (!$initial) return false;
        $payment = Payment::findOrFail($initial->payment_id);
        return DB::transaction(function () use ($initial, $payment, $session) {
            $order = Order::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();
            $payment = Payment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            $a = DB::table('payment_attempts')->where('id', $initial->id)->lockForUpdate()->first();
            $attrs = $session['attributes'] ?? []; $meta = $attrs['metadata'] ?? [];
            $valid = ($session['id'] ?? null) === $a->checkout_id
                && ($attrs['livemode'] ?? null) === (bool) $a->livemode
                && (bool) $a->livemode === $this->provider->isLive()
                && self::centavos($payment->amount) === (int) $a->amount_centavos
                && PayMongoService::supportsMethod($a->checkout_method);
            if ($a->api_version === 'v2') $valid = $valid && ($meta['attempt_token'] ?? null) === $a->token
                && (string) ($meta['order_id'] ?? '') === (string) $order->id && (string) ($meta['payment_id'] ?? '') === (string) $payment->id;
            if (!$valid) { DB::table('payment_attempts')->where('id', $a->id)->update(['exception' => 'provider_mismatch']); return false; }
            $paid = array_values(array_filter($attrs['payments'] ?? [], fn($p) => ($p['attributes']['status'] ?? '') === 'paid'));
            if (!$paid) {
                if (!$a->confirmed_at) DB::table('payment_attempts')->where('id', $a->id)->update([
                    'status' => ($attrs['status'] ?? '') === 'expired' ? 'expired' : 'pending', 'updated_at' => now(),
                ]);
                return true;
            }
            foreach ($paid as $receipt) {
                $pa = $receipt['attributes'] ?? [];
                if (!preg_match('/^pay_[A-Za-z0-9]+$/', $receipt['id'] ?? '') || (int) ($pa['amount'] ?? -1) !== (int) $a->amount_centavos
                    || ($pa['currency'] ?? '') !== 'PHP' || ($pa['livemode'] ?? null) !== (bool) $a->livemode || ($pa['source']['type'] ?? '') !== $a->checkout_method) {
                    DB::table('payment_attempts')->where('id', $a->id)->update(['exception' => 'payment_mismatch']); return false;
                }
                $existing = DB::table('payment_receipts')->where('provider_payment_id', $receipt['id'])->first();
                if ($existing && (int) $existing->attempt_id !== (int) $a->id) return false;
            }
            foreach ($paid as $receipt) DB::table('payment_receipts')->insertOrIgnore([
                'payment_id' => $payment->id, 'attempt_id' => $a->id, 'provider_payment_id' => $receipt['id'],
                'source_type' => $a->checkout_method,
                'amount_centavos' => $a->amount_centavos, 'livemode' => $a->livemode, 'confirmed_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
            $p = $paid[0];
            if ($a->confirmed_at) {
                if (count($paid) > 1) DB::table('payment_attempts')->where('id', $a->id)->update(['exception' => 'duplicate_payment_review']);
                return true;
            }
            $duplicate = $payment->paid_at !== null && $payment->paymongo_payment_id !== $p['id'];
            $closed = in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true);
            DB::table('payment_attempts')->where('id', $a->id)->update([
                'status' => 'paid', 'provider_payment_id' => $p['id'], 'confirmed_at' => now(), 'updated_at' => now(),
                'exception' => $duplicate || count($paid) > 1 ? 'duplicate_payment_review' : ($closed ? 'late_payment_refund_review' : null),
            ]);
            if (!$duplicate && $payment->status !== 'refunded') {
                $payment->update(['status' => 'paid', 'paid_at' => now(), 'reference' => $p['id'], 'paymongo_payment_id' => $p['id']]);
                $order->payment_reference = $p['id'];
                if ($order->lifecycle_status === 'pending' && $order->customer_stage === 'to_pay') $order->customer_stage = 'to_ship';
                $order->save();
            }
            OrderTrackingEvent::create(['order_id' => $order->id, 'stage' => $order->customer_stage, 'event_type' => 'system',
                'title' => PayMongoService::methodLabel($a->checkout_method).' payment confirmed', 'description' => $closed ? 'Payment received after the order closed. The team will review the refund.' : 'Payment received. Order preparation requires team approval.', 'occurred_at' => now()]);
            AdminNotification::create(['type' => 'order', 'title' => PayMongoService::methodLabel($a->checkout_method).' payment: '.$order->order_no,
                'message' => $closed || $duplicate ? 'Payment needs refund review.' : 'Payment confirmed automatically. Review this order for approval.',
                'metadata' => json_encode(['order_id' => $order->id])]);
            if (in_array($order->lifecycle_status, ['cancelled','rejected'], true)) $this->queueClosedOrderRefunds($order, $order->customer_id);
            return true;
        });
    }
    /** Reserve unpaid refund balances on closed orders; never sends money without Admin approval. */
    public function queueClosedOrderRefunds(Order $order, int $actor, bool $issuing = false): void {
        DB::transaction(function () use ($order, $actor, $issuing) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (!in_array($order->lifecycle_status, ['cancelled','rejected'], true)) return;
            $payment = Payment::where('order_id', $order->id)->lockForUpdate()->first();
            if (!self::managed($payment) || !in_array($payment->status, ['paid','refunded'], true)) return;
            $reason = 'Order closed before fulfillment: '.$order->order_no;
            foreach (DB::table('payment_receipts')->where('payment_id', $payment->id)->whereNotNull('confirmed_at')->get() as $receipt) {
                if ((bool) $receipt->livemode !== $this->provider->isLive()) continue;
                $refunds = DB::table('payment_refunds')->where('payment_id', $payment->id)->where('provider_payment_id', $receipt->provider_payment_id);
                // Do not silently recreate an explicitly declined or failed automatic request.
                if ((clone $refunds)->where('reason', $reason)->exists()) continue;
                $remaining = (int) $receipt->amount_centavos - (int) (clone $refunds)->whereNotIn('status', ['failed','rejected'])->sum('amount_centavos');
                if ($remaining >= 100) $this->requestRefund($payment, $remaining, $reason, $actor, (string) Str::uuid(), null, $receipt->provider_payment_id, $issuing);
            }
        });
    }
    public function state(Order $order): array {
        $payment = $order->payment;
        $a = $payment ? $this->attempt($payment) : null;
        $method = $a?->checkout_method ?? $this->provider->checkoutMethod();
        $closed = in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true);
        $payable = $payment?->status === 'pending' && !$closed && !$a?->exception && (!$a || (bool) $a->livemode === $this->provider->isLive()) && $this->provider->acceptsNewPayments();
        return ['status' => $payment?->status ?? 'pending', 'attempt_status' => $a?->status, 'order_status' => $order->lifecycle_status,
            'checkout_method' => $method, 'method_label' => PayMongoService::methodLabel($method),
            'checkout_label' => PayMongoService::checkoutLabel($method), 'checkout_description' => PayMongoService::checkoutDescription($method),
            'confirmed_at' => $payment?->paid_at?->toIso8601String(), 'expires_at' => $a?->expires_at,
            'exception' => $a?->exception, 'retry_allowed' => $payable && (!$a || in_array($a->status, ['expired','failed'], true)),
            'checkout_url' => $payable && $a?->status === 'pending' && $this->safeUrl($a?->checkout_url) ? $a->checkout_url : null,
            'refunds' => $payment ? \App\Support\RefundStatus::claims(DB::table('payment_refunds')->where('payment_id', $payment->id)->get(['id','amount_centavos','status','confirmed_at','livemode'])) : [],
        ];
    }
    public function processEvent(object $event): bool {
        if ((bool) $event->livemode !== $this->provider->isLive()) return false;
        DB::table('payment_webhook_events')->where('id', $event->id)->increment('tries');
        if ($event->event_type === 'checkout_session.payment.paid') {
            $attempt = DB::table('payment_attempts')->where('checkout_id', $event->resource_id)->first();
            if (!$attempt && $event->attempt_token) {
                $attempt = DB::table('payment_attempts')->where('token', $event->attempt_token)->first();
                if ($attempt && !$attempt->checkout_id) {
                    // An early event may precede the create response. Retrieve then verify full association.
                    $session = $this->provider->retrieveCheckoutSession($event->resource_id);
                    $meta = $session['data']['attributes']['metadata'] ?? [];
                    if (($meta['attempt_token'] ?? null) !== $attempt->token) return false;
                    DB::table('payment_attempts')->where('id', $attempt->id)->whereNull('checkout_id')->update(['checkout_id' => $event->resource_id]);
                }
            }
            if (!$attempt) {
                $payment = Payment::where('paymongo_checkout_id', $event->resource_id)->first();
                $attempt = $payment ? $this->attempt($payment) : null;
            }
            if (!$attempt || !$this->reconcile($attempt->id, true)) return false;
        } elseif (str_contains($event->event_type, 'refund')) {
            // Query known refunds rather than trusting callback amounts/status.
            foreach (DB::table('payment_refunds')->where('provider_refund_id', $event->resource_id)->whereIn('status', ['submitting','unknown','pending'])->limit(1)->get() as $refund) $this->reconcileRefund($refund);
        }
        DB::table('payment_webhook_events')->where('id', $event->id)->update(['status' => 'processed', 'processed_at' => now()]);
        return true;
    }
    public function requestRefund(Payment $payment, int $amount, string $reason, int $actor, string $token, ?int $returnId = null, ?string $providerPaymentId = null, bool $issuing = false): object {
        return DB::transaction(function () use ($payment, $amount, $reason, $actor, $token, $returnId, $providerPaymentId, $issuing) {
            $order=Order::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();
            abort_if($order->hasPendingCancellation(),422,'Review the cancellation before issuing a refund.');
            $payment = Payment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            $providerPaymentId ??= $payment->paymongo_payment_id;
            $receipt = DB::table('payment_receipts')->where('payment_id', $payment->id)->where('provider_payment_id', $providerPaymentId)->first();
            $existing = DB::table('payment_refunds')->where('token', $token)->first();
            if ($existing) {
                abort_unless($existing->payment_id === $payment->id && (int) $existing->amount_centavos === $amount && $existing->reason === $reason && $existing->provider_payment_id === $providerPaymentId, 409, 'This request key has already been used.'); return $existing;
            }
            abort_unless(self::managed($payment) && $receipt && in_array($payment->status, ['paid','refunded'], true), 422, 'A confirmed online payment is required.');
            if ($returnId) {
                $return = \App\Models\OrderReturn::whereKey($returnId)->where('order_id', $payment->order_id)->firstOrFail();
                abort_unless($return->resolution === 'refund' && in_array($return->status, ['approved','item_received','refund_processing'], true), 422, 'Approve this return for a refund first.');
                $returnReserved = DB::table('payment_refunds')->where('order_return_id',$returnId)->whereNotIn('status',['failed','rejected'])->sum('amount_centavos');
                abort_unless($returnReserved + $amount <= self::centavos($return->approved_amount ?? $return->requested_amount), 422, 'This exceeds the approved return amount.');
            }
            $reserved = DB::table('payment_refunds')->where('payment_id', $payment->id)->where('provider_payment_id', $providerPaymentId)->whereNotIn('status', ['failed','rejected'])->sum('amount_centavos');
            abort_unless($amount >= 100 && $amount + $reserved <= (int) $receipt->amount_centavos, 422, 'The refund exceeds the remaining refundable amount.');
            $attempt = DB::table('payment_attempts')->find($receipt->attempt_id);
            abort_unless($attempt && $attempt->confirmed_at && (bool) $attempt->livemode === $this->provider->isLive(), 422, 'Reconcile this payment before requesting a refund.');
            $id = DB::table('payment_refunds')->insertGetId(['payment_id' => $payment->id, 'token' => $token, 'requested_by' => $actor,
                'provider_payment_id' => $providerPaymentId, 'order_return_id' => $returnId, 'amount_centavos' => $amount, 'reason' => $reason, 'livemode' => $attempt->livemode, 'status' => 'requested', 'created_at' => now(), 'updated_at' => now()]);
            $title=$issuing ? 'Refund being prepared' : 'Refund requested';
            $progress=$issuing ? 'FMRC is preparing the refund for submission to PayMongo.' : 'The refund is awaiting Admin approval.';
            OrderTrackingEvent::create(['order_id'=>$payment->order_id, 'stage'=>$payment->order->customer_stage, 'event_type'=>'system',
                'title'=>$title, 'description'=>'Refund of PHP '.number_format($amount / 100, 2).'. '.$progress.' No money has been returned yet.', 'occurred_at'=>now()]);
            if (!$issuing) AdminNotification::create(['type'=>'order','title'=>'Refund approval needed: '.$payment->order->order_no,
                'message'=>'Review the refund request in Orders > Online refunds.', 'metadata'=>json_encode(['order_id'=>$payment->order_id,'refund_id'=>$id])]);
            $this->notifyRefundCustomer($payment->order, $title, 'Refund of PHP '.number_format($amount / 100, 2).'. '.$progress.' No money has been returned yet. Open My Orders > Payment details to follow its progress.');
            if ($returnId) \App\Models\OrderReturnEvent::create(['order_return_id'=>$returnId,'created_by_user_id'=>$actor,
                'status'=>'refund_processing','actor_role'=>'system','title'=>$title,'description'=>$progress.' No money has been returned yet.','occurred_at'=>now()]);
            return DB::table('payment_refunds')->find($id);
        });
    }
    public function approveRefund(int $id, int $actor): void {
        $lock = Cache::lock('payment-refund:'.$id,30);
        if (!$lock->get()) return;
        try {
        $candidate = DB::table('payment_refunds')->find($id);
        abort_unless($candidate, 404);
        if ($candidate->status !== 'requested') return;
        abort_unless($this->provider->isConfigured() && (bool) $candidate->livemode === $this->provider->isLive(), 422, 'The payment provider is unavailable.');
        $source = DB::table('payment_receipts')->where('payment_id',$candidate->payment_id)->where('provider_payment_id',$candidate->provider_payment_id)->value('source_type');
        if ($candidate->livemode && $source === 'qrph') {
            // Keep the request awaiting approval when funding is blocked. No refund
            // POST or failed provider attempt is created by this check.
            $funding = $this->provider->refundFunding(true);
            abort_if($funding['available_centavos'] === null, 422, $funding['message']);
            abort_if($funding['available_centavos'] < (int) $candidate->amount_centavos, 422,
                'Top up the PayMongo wallet to cover this refund, then issue it again. Scheduled payouts are not available funds.');
        }
        $refund = DB::transaction(function () use ($id, $actor) {
            $r = DB::table('payment_refunds')->where('id', $id)->lockForUpdate()->first();
            abort_unless($r, 404); if ($r->status !== 'requested') return null;
            abort_unless($this->provider->isConfigured() && (bool) $r->livemode === $this->provider->isLive(), 422, 'The payment provider is unavailable.');
            $payment = Payment::findOrFail($r->payment_id);
            $source = DB::table('payment_receipts')->where('payment_id',$payment->id)->where('provider_payment_id',$r->provider_payment_id)->value('source_type');
            OrderTrackingEvent::create(['order_id'=>$payment->order_id,'stage'=>$payment->order->customer_stage,'event_type'=>'system',
                'title'=>'Refund approved','description'=>'FMRC approved the refund for submission to the payment provider.','occurred_at'=>now(),
                'metadata'=>['refund_id'=>$r->id,'refund_api'=>$source === 'qrph' && $r->livemode ? 'qrph' : 'standard']]);
            DB::table('payment_refunds')->where('id', $id)->update(['approved_by' => $actor, 'status' => 'submitting', 'updated_at' => now()]);
            return DB::table('payment_refunds')->find($id);
        });
        if ($refund) $this->reconcileRefundOnce($refund, true);
        } finally { $lock->release(); }
    }
    /** Retrieve one due refund per visible page/order; never creates a refund. */
    public function refreshRefunds(array $paymentIds): void {
        $r = DB::table('payment_refunds')->whereIn('payment_id',$paymentIds)->whereNotNull('provider_refund_id')
            ->where('livemode',$this->provider->isLive())->whereNotNull('approved_by')->whereIn('status',['pending','unknown','submitting'])
            ->where(fn($q)=>$q->whereNull('checked_at')->orWhere('checked_at','<=',now()->subSeconds(10)))
            ->orderBy('checked_at')->first();
        if ($r) $this->reconcileRefund($r);
    }
    public function reconcileRefund(object $r, bool $initialSubmission = false): void {
        $lock = Cache::lock('payment-refund:'.$r->id,30);
        if (!$lock->get()) return;
        try {
            $fresh = DB::table('payment_refunds')->find($r->id);
            if (!$fresh || !in_array($fresh->status,['submitting','unknown','pending'],true)) return;
            $this->reconcileRefundOnce($fresh,$initialSubmission);
        } finally { $lock->release(); }
    }
    private function reconcileRefundOnce(object $r, bool $initialSubmission): void {
        if ((bool) $r->livemode !== $this->provider->isLive() || !$r->approved_by) return;
        DB::table('payment_refunds')->where('id', $r->id)->update(['checked_at' => now()]);
        $payment = Payment::findOrFail($r->payment_id);
        $approval = OrderTrackingEvent::where('metadata->refund_id',$r->id)->where('title','Refund approved')->latest('id')->first();
        $qrph = ($approval?->metadata['refund_api'] ?? 'standard') === 'qrph';
        $qrphReceipt = DB::table('payment_receipts')->where('payment_id',$payment->id)->where('provider_payment_id',$r->provider_payment_id)->value('source_type') === 'qrph';
        if ($r->provider_refund_id) $result = $this->provider->retrieveRefund($r->provider_refund_id,$qrphReceipt,$r->provider_payment_id);
        else {
            // Never resend an ambiguous QR Ph transfer creation. Its reference must
            // be recovered first; a new endpoint must not retry an older standard POST.
            if ($qrph && !$initialSubmission) return;
            // updated_at is approval time and is not changed on ambiguous retries.
            if (Carbon::parse($r->updated_at)->lt(now()->subHours(23))) return;
            $result = $this->provider->request('POST', 'v1/refunds', ['amount' => (int) $r->amount_centavos,
                'payment_id' => $r->provider_payment_id, 'reason' => 'others', 'notes' => mb_substr($r->reason, 0, 200).' [FMRC '.$r->token.']'], $r->token, $qrph);
        }
        if ($result['rejected'] ?? false) { $this->recordRefundProblem($r, $payment, 'failed', $result); return; }
        if (!$result) { $this->recordRefundProblem($r, $payment, 'unknown'); return; }
        $data = $result['data'] ?? []; $a = $data['attributes'] ?? [];
        if (($a['payment_id'] ?? '') !== $r->provider_payment_id || (int) ($a['amount'] ?? -1) !== (int) $r->amount_centavos
            || ($a['currency'] ?? '') !== 'PHP' || ($a['livemode'] ?? null) !== (bool) $r->livemode || !str_starts_with($data['id'] ?? '', 'ref_')) return;
        $status = $a['status'] ?? 'pending';
        if (!in_array($status, ['succeeded','failed','pending'], true)) $status = 'pending';
        DB::transaction(function () use ($r, $data, $a, $status, $payment, $qrphReceipt) {
            Order::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();
            $payment = Payment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            $current = DB::table('payment_refunds')->where('id', $r->id)->lockForUpdate()->first();
            if (in_array($current->status, ['succeeded','failed'], true)) return;
            DB::table('payment_refunds')->where('id', $r->id)->update(['provider_refund_id' => $data['id'], 'status' => $status,
                'confirmed_at' => $status === 'succeeded' ? now() : null]);
            $link = $qrphReceipt ? \App\Support\RefundStatus::safeTransferLink($a['transfer_link'] ?? null,(bool)$r->livemode) : null;
            if ($link && $status === 'pending' && !OrderTrackingEvent::where('metadata->refund_id',$r->id)->where('title','Refund ready to claim')->exists()) {
                $created = is_numeric($a['created_at'] ?? null) ? Carbon::createFromTimestamp((int)$a['created_at'],'UTC') : now();
                OrderTrackingEvent::create(['order_id'=>$payment->order_id,'stage'=>$payment->order->customer_stage,'event_type'=>'system',
                    'title'=>'Refund ready to claim','description'=>'Open My Orders > Payment details and choose Claim refund. Complete PayMongo\'s form to receive the funds in your chosen bank or e-wallet. Claim within 3 days.','occurred_at'=>now(),
                    'metadata'=>['refund_id'=>$r->id,'transfer_link'=>$link,'claim_expires_at'=>$created->addDays(3)->toIso8601String()]]);
                $this->notifyRefundCustomer($payment->order,'Claim your QR Ph refund','Your refund of PHP '.number_format($r->amount_centavos/100,2).' is ready to claim. Sign in to FMRC, open My Orders > Payment details, and choose Claim refund. Complete the secure PayMongo form within 3 days. The refund is not completed until the transfer succeeds.');
            }
            $sum = DB::table('payment_refunds')->where('payment_id', $payment->id)->where('provider_payment_id', $payment->paymongo_payment_id)->where('status', 'succeeded')->sum('amount_centavos');
            if ($sum >= self::centavos($payment->amount)) {
                $payment->update(['status' => 'refunded', 'refunded_at' => now(), 'refund_reference' => $data['id']]);
                Order::whereKey($payment->order_id)->update(['cancel_refund_due' => false]);
            }
            if ($status === 'succeeded' && $r->order_return_id) {
                $return = \App\Models\OrderReturn::find($r->order_return_id);
                if ($return) {
                    $returnSum = DB::table('payment_refunds')->where('order_return_id',$return->id)->where('status','succeeded')->sum('amount_centavos');
                    $return->update(['status' => $returnSum >= self::centavos($return->approved_amount ?? $return->requested_amount) ? 'refunded' : 'refund_processing',
                        'refunded_amount' => $returnSum / 100, 'refunded_at' => now(), 'refund_reference' => $data['id'], 'handled_by_user_id' => $r->approved_by]);
                }
            }
            if ($status === 'succeeded') {
                $source = DB::table('payment_receipts')->where('provider_payment_id', $r->provider_payment_id)->value('source_type');
                OrderTrackingEvent::create(['order_id' => $payment->order_id, 'stage' => $payment->order->customer_stage,
                    'event_type' => 'system', 'title' => PayMongoService::methodLabel($source ?? 'gcash').' refund confirmed', 'description' => '₱'.number_format($r->amount_centavos / 100, 2).' returned through the payment provider.', 'occurred_at' => now()]);
                $this->notifyRefundCustomer($payment->order, 'Refund confirmed', 'The payment provider confirmed your refund of PHP '.number_format($r->amount_centavos / 100, 2).'. Reference: '.$data['id'].'. Check your receiving wallet or bank transaction history.');
                if ($r->order_return_id) \App\Models\OrderReturnEvent::create(['order_return_id'=>$r->order_return_id,
                    'created_by_user_id'=>$r->approved_by,'status'=>$return?->status ?? 'refund_processing','actor_role'=>'system',
                    'title'=>'Refund confirmed','description'=>'PHP '.number_format($r->amount_centavos / 100, 2).' returned through the payment provider. Reference: '.$data['id'],'occurred_at'=>now()]);
            } elseif ($current->status !== $status) {
                OrderTrackingEvent::create(['order_id'=>$payment->order_id, 'stage'=>$payment->order->customer_stage,
                    'event_type'=>'system', 'title'=>$status === 'failed' ? 'Refund needs attention' : 'Refund processing',
                    'description'=>$status === 'failed' ? 'The refund could not be completed. FMRC needs to review it; your payment has not been marked refunded.' : 'The payment provider is processing your refund. Open Payment details for any claim instructions. Confirmation will appear here.', 'occurred_at'=>now(),
                    'metadata'=>['refund_id'=>$r->id] + ($status === 'failed' ? ['failure_message'=>'PayMongo could not complete this refund.', 'failure_action'=>'Check the refund in PayMongo. For QR Ph, an expired or declined claim can fail. Confirm its final status before approving another attempt.'] : [])]);
                if($status === 'failed') AdminNotification::create(['type'=>'order','title'=>'Refund needs attention: '.$payment->order->order_no,
                    'message'=>'PayMongo could not complete the refund. Review the refund in Orders > Online refunds.',
                    'metadata'=>json_encode(['order_id'=>$payment->order_id,'refund_id'=>$r->id])]);
            }
        });
    }
    private function recordRefundProblem(object $refund, Payment $payment, string $status, array $failure = []): void {
        DB::transaction(function () use ($refund, $payment, $status, $failure) {
            Order::whereKey($payment->order_id)->lockForUpdate()->firstOrFail();
            $current = DB::table('payment_refunds')->where('id',$refund->id)->lockForUpdate()->first();
            if (!$current || !in_array($current->status,['submitting','unknown','pending'],true) || $current->status === $status) return;
            DB::table('payment_refunds')->where('id',$refund->id)->update(['status'=>$status]);
            $title = $status === 'failed' ? 'Refund needs attention' : 'Refund confirmation pending';
            $message = $status === 'failed' ? 'The refund was not accepted by the payment provider. FMRC must review it and arrange the refund. Your payment has not been marked refunded.'
                : 'FMRC is checking the refund with the payment provider. Confirmation will appear here. Do not submit another payment.';
            OrderTrackingEvent::create(['order_id'=>$payment->order_id,'stage'=>$payment->order->customer_stage,'event_type'=>'system',
                'title'=>$title,'description'=>$message,'occurred_at'=>now(),
                'metadata'=>['refund_id'=>$refund->id] + array_intersect_key($failure,array_flip(['error_code','error_field','http_status','failure_version','failure_message','failure_action']))]);
            if ($status === 'failed') AdminNotification::create(['type'=>'order','title'=>$title.': '.$payment->order->order_no,
                'message'=>'Review the failed refund in Orders > Online payments & refunds. Do not mark it completed manually.',
                'metadata'=>json_encode(['order_id'=>$payment->order_id,'refund_id'=>$refund->id])]);
        });
    }
    private function notifyRefundCustomer(Order $order, string $title, string $message): void {
        DB::afterCommit(function () use ($order, $title, $message) {
            try {
                $html = \App\Support\OrderNotifier::buildEmailHtml($order, $title, $message, '#782235', $title);
                \App\Support\OrderNotifier::emailCustomer($order, $title.' - '.$order->order_no, $html);
            } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('Refund email could not be prepared', ['order_id'=>$order->id]); }
        });
    }
}
