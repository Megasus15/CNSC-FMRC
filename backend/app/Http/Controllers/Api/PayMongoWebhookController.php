<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\{PayMongoService, GatewayPayments};
use Illuminate\Http\{Request, JsonResponse};
use Illuminate\Support\Facades\DB;

class PayMongoWebhookController extends Controller
{
    public function handleWebhook(Request $request, PayMongoService $provider): JsonResponse {
        abort_unless($provider->verifyWebhookSignature($request->getContent(), $request->header('Paymongo-Signature', '')), 403);
        $body = $request->json()->all();
        $envelope = $body['data']['attributes'] ?? $body['data'] ?? [];
        $type = $envelope['type'] ?? '';
        $resource = $envelope['data'] ?? [];
        $mode = $envelope['livemode'] ?? $resource['attributes']['livemode'] ?? null;
        abort_unless(is_bool($mode) && $mode === $provider->isLive(), 422);
        $supported = ['checkout_session.payment.paid','payment.refunded','payment.refund.updated','refund.succeeded','refund.updated','refund.failed'];
        if (!in_array($type, $supported, true)) return response()->json(['received' => true]);
        abort_unless(is_string($resource['id'] ?? null), 422);
        // Store only identifiers; billing data and signatures are not retained.
        DB::table('payment_webhook_events')->insertOrIgnore([
            'event_key' => $body['data']['id'] ?? hash('sha256', $request->getContent()), 'event_type' => $type,
            'resource_id' => $resource['id'], 'attempt_token' => $resource['attributes']['metadata']['attempt_token'] ?? null,
            'livemode' => $mode, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);
        // Verify supported confirmations immediately; the durable inbox and worker
        // remain the fallback when the provider cannot be reached.
        if ($type === 'checkout_session.payment.paid' || str_contains($type,'refund')) {
            $event = DB::table('payment_webhook_events')->where('event_key', $body['data']['id'] ?? hash('sha256', $request->getContent()))->first();
            if ($event && $event->status === 'pending') {
                try { app(GatewayPayments::class)->processEvent($event); } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('Payment event queued for recovery', ['event_id' => $event->id]);
                }
            }
        }
        // Acknowledge only after durable persistence. Scheduler owns retries.
        return response()->json(['received' => true]);
    }
    public function checkPaymentStatus(Request $request, Order $order, GatewayPayments $gateway): JsonResponse {
        abort_unless($request->user() && (int) $order->customer_id === (int) $request->user()->id, 403);
        if ($order->payment && GatewayPayments::managed($order->payment)) {
            $a = $gateway->attempt($order->payment);
            if ($a?->checkout_id && !$a->confirmed_at) $gateway->reconcile($a->id);
            $gateway->refreshRefunds([$order->payment->id]);
        }
        return response()->json($gateway->state($order->fresh()));
    }
    public function retry(Request $request, Order $order, GatewayPayments $gateway): JsonResponse {
        abort_unless($request->user() && (int) $order->customer_id === (int) $request->user()->id, 403);
        return response()->json($gateway->checkout($order, $request->input('app_context') === 'customer' ? 'customer' : ''));
    }
}
