<?php
namespace App\Services;

use App\Models\{Order, Payment, OrderTrackingEvent, AdminNotification};
use Illuminate\Support\Facades\DB;
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
        return ['payment_checkout_method' => $method,
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
            return true;
        });
    }
    public function state(Order $order): array {
        $payment = $order->payment;
        $a = $payment ? $this->attempt($payment) : null;
        $method = $a?->checkout_method ?? $this->provider->checkoutMethod();
        $closed = in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true);
        $payable = $payment?->status === 'pending' && !$closed && !$a?->exception && (!$a || (bool) $a->livemode === $this->provider->isLive()) && $this->provider->acceptsNewPayments();
        return ['status' => $payment?->status ?? 'pending', 'attempt_status' => $a?->status,
            'checkout_method' => $method, 'method_label' => PayMongoService::methodLabel($method),
            'checkout_label' => PayMongoService::checkoutLabel($method), 'checkout_description' => PayMongoService::checkoutDescription($method),
            'confirmed_at' => $payment?->paid_at?->toIso8601String(), 'expires_at' => $a?->expires_at,
            'exception' => $a?->exception, 'retry_allowed' => $payable && (!$a || in_array($a->status, ['expired','failed'], true)),
            'checkout_url' => $payable && $a?->status === 'pending' && $this->safeUrl($a?->checkout_url) ? $a->checkout_url : null,
            'refunds' => $payment ? DB::table('payment_refunds')->where('payment_id', $payment->id)->get(['id','amount_centavos','status','confirmed_at']) : [],
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
    public function requestRefund(Payment $payment, int $amount, string $reason, int $actor, string $token, ?int $returnId = null, ?string $providerPaymentId = null): object {
        return DB::transaction(function () use ($payment, $amount, $reason, $actor, $token, $returnId, $providerPaymentId) {
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
            return DB::table('payment_refunds')->find($id);
        });
    }
    public function approveRefund(int $id, int $actor): void {
        $refund = DB::transaction(function () use ($id, $actor) {
            $r = DB::table('payment_refunds')->where('id', $id)->lockForUpdate()->first();
            abort_unless($r, 404); if ($r->status !== 'requested') return null;
            abort_unless($this->provider->isConfigured() && (bool) $r->livemode === $this->provider->isLive(), 422, 'The payment provider is unavailable.');
            DB::table('payment_refunds')->where('id', $id)->update(['approved_by' => $actor, 'status' => 'submitting', 'updated_at' => now()]);
            return DB::table('payment_refunds')->find($id);
        });
        if ($refund) $this->reconcileRefund($refund);
    }
    public function reconcileRefund(object $r): void {
        if ((bool) $r->livemode !== $this->provider->isLive() || !$r->approved_by) return;
        DB::table('payment_refunds')->where('id', $r->id)->update(['checked_at' => now()]);
        $payment = Payment::findOrFail($r->payment_id);
        if ($r->provider_refund_id) $result = $this->provider->request('GET', 'v1/refunds/'.$r->provider_refund_id);
        else {
            // updated_at is approval time and is not changed on ambiguous retries.
            if (Carbon::parse($r->updated_at)->lt(now()->subHours(23))) return;
            $result = $this->provider->request('POST', 'v1/refunds', ['amount' => (int) $r->amount_centavos,
                'payment_id' => $r->provider_payment_id, 'reason' => 'others', 'notes' => mb_substr($r->reason, 0, 200).' [FMRC '.$r->token.']'], $r->token);
        }
        if ($result['rejected'] ?? false) { DB::table('payment_refunds')->where('id', $r->id)->whereIn('status', ['submitting','unknown','pending'])->update(['status' => 'failed']); return; }
        if (!$result) { DB::table('payment_refunds')->where('id', $r->id)->whereIn('status', ['submitting','unknown','pending'])->update(['status' => 'unknown']); return; }
        $data = $result['data'] ?? []; $a = $data['attributes'] ?? [];
        if (($a['payment_id'] ?? '') !== $r->provider_payment_id || (int) ($a['amount'] ?? -1) !== (int) $r->amount_centavos
            || ($a['currency'] ?? '') !== 'PHP' || ($a['livemode'] ?? null) !== (bool) $r->livemode || !str_starts_with($data['id'] ?? '', 'ref_')) return;
        $status = $a['status'] ?? 'pending';
        if (!in_array($status, ['succeeded','failed','pending'], true)) $status = 'pending';
        DB::transaction(function () use ($r, $data, $status, $payment) {
            $payment = Payment::whereKey($payment->id)->lockForUpdate()->firstOrFail();
            $current = DB::table('payment_refunds')->where('id', $r->id)->lockForUpdate()->first();
            if (in_array($current->status, ['succeeded','failed'], true)) return;
            DB::table('payment_refunds')->where('id', $r->id)->update(['provider_refund_id' => $data['id'], 'status' => $status,
                'confirmed_at' => $status === 'succeeded' ? now() : null]);
            $sum = DB::table('payment_refunds')->where('payment_id', $payment->id)->where('provider_payment_id', $payment->paymongo_payment_id)->where('status', 'succeeded')->sum('amount_centavos');
            if ($sum >= self::centavos($payment->amount)) $payment->update(['status' => 'refunded', 'refunded_at' => now(), 'refund_reference' => $data['id']]);
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
            }
        });
    }
}
