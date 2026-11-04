<?php

namespace App\Services;

use App\Models\{CustomProductQuote, CustomProductRequest, Order};
use Illuminate\Support\Facades\DB;

/** Provider confirmation, not the browser clock, closes a payable quotation. */
final class CustomQuoteExpiry
{
    public static function close(CustomProductQuote $quote): void
    {
        // Serialize with acceptance before looking for its order. Otherwise an
        // acceptance committing during expiry could leave an unexpired session.
        $reviewStarted = false;
        $quote = DB::transaction(function () use ($quote, &$reviewStarted) {
            $r = CustomProductRequest::whereKey($quote->custom_product_request_id)->lockForUpdate()->firstOrFail();
            $q = CustomProductQuote::whereKey($quote->id)->lockForUpdate()->firstOrFail();
            if (!in_array($q->status, ['sent','accepted'], true)) return null;
            $order = $q->order;
            $closed = $order && in_array($order->lifecycle_status, ['cancelled','rejected'], true);
            if ((!$closed && $q->expires_at?->isFuture()) || $order?->payment?->status === 'paid') return null;
            if ($order && $r->status !== 'payment_review') {
                $r->update(['status'=>'payment_review', 'revision'=>$r->revision + 1]);
                $reviewStarted = true;
            }
            return $q;
        });
        if (!$quote) return;
        $order = $quote->order;
        $closedOrder = $order && in_array($order->lifecycle_status, ['cancelled', 'rejected'], true);
        if (!$closedOrder && $quote->expires_at?->isFuture()) return;
        if ($order?->payment?->status === 'paid') return;
        $unresolved = false;
        if ($order?->payment) {
            foreach (DB::table('payment_attempts')->where('payment_id', $order->payment->id)->get() as $attempt) {
                if (in_array($attempt->status, ['failed', 'expired', 'paid'], true)) continue;
                if (!$attempt->checkout_id) { $unresolved = true; continue; }
                try {
                    app(GatewayPayments::class)->reconcile($attempt->id, true);
                    if ($order->fresh()->payment?->status === 'paid') return;
                    $result = app(PayMongoService::class)->request('POST', 'v1/checkout_sessions/'.$attempt->checkout_id.'/expire');
                    if (($result['data']['attributes']['status'] ?? '') === 'expired') {
                        DB::table('payment_attempts')->where('id', $attempt->id)->whereNull('confirmed_at')->update(['status'=>'expired', 'updated_at'=>now()]);
                    } else $unresolved = true;
                } catch (\Throwable $error) { $unresolved = true; }
            }
        }
        DB::transaction(function () use ($quote, $order, $unresolved, $closedOrder, $reviewStarted) {
            // Payment callbacks and production also acquire the order first.
            $o = $order ? Order::whereKey($order->id)->lockForUpdate()->first() : null;
            $r = CustomProductRequest::whereKey($quote->custom_product_request_id)->lockForUpdate()->firstOrFail();
            $q = CustomProductQuote::whereKey($quote->id)->lockForUpdate()->firstOrFail();
            if (!in_array($q->status, ['sent','accepted'], true) || $o?->payment?->status === 'paid') return;
            $status = $unresolved ? 'payment_review' : 'expired';
            if (!$unresolved) {
                $q->update(['status'=>$closedOrder ? 'withdrawn' : 'expired']);
                if ($o && !in_array($o->lifecycle_status, ['cancelled','rejected'], true)) {
                    $o->update(['lifecycle_status'=>'cancelled', 'cancel_state'=>'approved', 'cancelled_at'=>now(), 'cancel_reason_detail'=>'Quotation expired before payment.']);
                }
            }
            if ($r->status !== $status || ($unresolved && $reviewStarted)) {
                $r->status = $status; $r->revision++; $r->save();
                $message = $unresolved ? 'Payment status is being verified before this quotation can be replaced.' : ($closedOrder ? 'The previous checkout is closed. You may request a revised quotation.' : 'Your unpaid quotation expired. Ask FMRC for a refreshed quotation.');
                DB::table('custom_product_events')->insert(['custom_product_request_id'=>$r->id, 'request_key'=>(string)\Illuminate\Support\Str::uuid(), 'action'=>'expiry', 'payload_hash'=>hash('sha256', $message), 'description'=>$message, 'created_at'=>now(), 'updated_at'=>now()]);
                CustomProducts::notify($r, $message, false);
            }
        });
    }
}
