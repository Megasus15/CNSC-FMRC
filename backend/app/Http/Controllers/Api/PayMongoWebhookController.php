<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminNotification;
use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Models\Payment;
use App\Services\PayMongoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Handles PayMongo webhook callbacks and payment status checks.
 *
 * PayMongo sends a POST to /api/webhooks/paymongo after the customer completes
 * or fails a GCash payment. This controller verifies the signature, finds the
 * matching payment record, and marks the order as paid — skipping the manual
 * "To Pay" stage entirely, just like Shopee and Lazada do.
 *
 * The endpoint is public (no auth:sanctum) because PayMongo is the caller,
 * not the customer. Security comes from the HMAC signature verification.
 */
class PayMongoWebhookController extends Controller
{
    /**
     * Handle an incoming PayMongo webhook event.
     *
     * PayMongo sends events like `checkout_session.payment.paid` when the
     * customer successfully pays through GCash. The webhook payload contains
     * the checkout session data including the metadata we attached (order_id,
     * payment_id) when we created the session.
     */
    public function handleWebhook(Request $request, PayMongoService $payMongo): JsonResponse
    {
        $payload = $request->getContent();
        $signature = $request->header('Paymongo-Signature', '');

        // Verify the webhook actually came from PayMongo
        if (!$payMongo->verifyWebhookSignature($payload, $signature)) {
            Log::warning('[PAYMONGO WEBHOOK] Invalid signature', [
                'signature' => $signature,
                'ip' => $request->ip(),
            ]);

            return response()->json(['message' => 'Invalid signature'], 403);
        }

        $data = $request->json()->all();
        $eventType = $data['data']['attributes']['type'] ?? '';

        Log::info('[PAYMONGO WEBHOOK] Received', [
            'event_type' => $eventType,
            'webhook_id' => $data['data']['id'] ?? null,
        ]);

        return match ($eventType) {
            'checkout_session.payment.paid' => $this->handlePaymentPaid($data),
            default => response()->json(['message' => 'Event ignored']),
        };
    }

    /**
     * Process a successful GCash payment.
     *
     * When this fires, the money has already been collected by PayMongo from
     * the customer's GCash wallet. We:
     *
     *  1. Find the Payment record by its paymongo_checkout_id
     *  2. Mark it as paid (status = 'paid', paid_at = now)
     *  3. Store the PayMongo payment intent ID for reconciliation
     *  4. Advance the order's customer_stage past 'to_pay'
     *  5. Create a tracking event so the customer sees "Payment confirmed"
     *  6. Notify admin/staff that payment was auto-verified
     */
    private function handlePaymentPaid(array $webhookData): JsonResponse
    {
        // Navigate the PayMongo webhook structure to find our metadata
        $checkoutData = $webhookData['data']['attributes']['data'] ?? [];
        $checkoutId = $checkoutData['id'] ?? null;
        $attributes = $checkoutData['attributes'] ?? [];
        $metadata = $attributes['metadata'] ?? [];

        // The payment intent ID from PayMongo's payments array
        $payments = $attributes['payments'] ?? [];
        $paymongoPaymentId = $payments[0]['id'] ?? null;

        if (!$checkoutId) {
            Log::warning('[PAYMONGO WEBHOOK] Payment paid event missing checkout ID', [
                'webhook_data' => $webhookData,
            ]);

            return response()->json(['message' => 'Missing checkout session ID'], 400);
        }

        // Find our payment by the checkout session ID we stored at creation
        $payment = Payment::query()
            ->where('paymongo_checkout_id', $checkoutId)
            ->first();

        if (!$payment) {
            // Fallback: try finding by metadata (order_id + payment_id)
            $orderId = $metadata['order_id'] ?? null;
            $paymentId = $metadata['payment_id'] ?? null;

            if ($paymentId) {
                $payment = Payment::query()->find($paymentId);
            } elseif ($orderId) {
                $payment = Payment::query()->where('order_id', $orderId)->first();
            }

            if (!$payment) {
                Log::error('[PAYMONGO WEBHOOK] No matching payment found', [
                    'checkout_id' => $checkoutId,
                    'metadata' => $metadata,
                ]);

                // Return 200 anyway so PayMongo does not keep retrying
                return response()->json(['message' => 'Payment record not found']);
            }
        }

        // Idempotency: if this payment is already marked as paid, skip
        if ($payment->status === 'paid') {
            Log::info('[PAYMONGO WEBHOOK] Payment already confirmed, skipping', [
                'payment_id' => $payment->id,
                'checkout_id' => $checkoutId,
            ]);

            return response()->json(['message' => 'Already processed']);
        }

        DB::transaction(function () use ($payment, $checkoutId, $paymongoPaymentId): void {
            $now = now();

            // Mark the payment as confirmed
            $payment->update([
                'status' => 'paid',
                'paid_at' => $now,
                'submitted_at' => $payment->submitted_at ?? $now,
                'reference' => $paymongoPaymentId ?? $checkoutId,
                'paymongo_payment_id' => $paymongoPaymentId,
            ]);

            // Advance the order past "To Pay"
            $order = $payment->order;
            if ($order && $order->customer_stage === 'to_pay') {
                $order->update([
                    'customer_stage' => 'to_ship',
                    'payment_reference' => $paymongoPaymentId ?? $checkoutId,
                ]);

                // Add a tracking event for the customer's timeline
                OrderTrackingEvent::query()->create([
                    'order_id' => $order->id,
                    'stage' => 'to_ship',
                    'event_type' => 'system',
                    'title' => 'GCash payment confirmed',
                    'description' => 'Your GCash payment was verified automatically. '
                        . 'Your order is now being reviewed by FMRC.',
                    'occurred_at' => $now,
                    'metadata' => json_encode([
                        'payment_status' => 'paid',
                        'gateway' => 'paymongo',
                        'paymongo_payment_id' => $paymongoPaymentId,
                    ]),
                ]);
            }

            // Notify admin/staff
            $orderNo = $order->order_no ?? "ORD-{$order->id}";
            $customerName = $order->customer_name ?? 'A customer';
            $amount = number_format((float) $payment->amount, 2, '.', ',');

            AdminNotification::query()->create([
                'type' => 'order',
                'title' => "GCash Payment Verified: {$orderNo}",
                'message' => "{$customerName}'s GCash payment of ₱{$amount} for {$orderNo} "
                    . 'was automatically confirmed via PayMongo. No manual verification needed.',
                'metadata' => json_encode([
                    'order_id' => $order->id,
                    'order_no' => $orderNo,
                    'gateway' => 'paymongo',
                ]),
            ]);
        });

        Log::info('[PAYMONGO WEBHOOK] Payment confirmed successfully', [
            'payment_id' => $payment->id,
            'order_id' => $payment->order_id,
            'checkout_id' => $checkoutId,
        ]);

        return response()->json(['message' => 'Payment confirmed']);
    }

    /**
     * Check the payment status of a PayMongo checkout session.
     *
     * Called by the frontend when the customer returns from the PayMongo
     * checkout page, as a fallback if the webhook has not arrived yet.
     * This gives the frontend an immediate answer rather than waiting for
     * the webhook to fire asynchronously.
     */
    public function checkPaymentStatus(Request $request, Order $order, PayMongoService $payMongo): JsonResponse
    {
        $customer = $request->user();
        if (!$customer || (int) $order->customer_id !== (int) $customer->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $payment = $order->payment;
        if (!$payment) {
            return response()->json(['status' => 'not_found'], 404);
        }

        // If already confirmed locally, return immediately
        if ($payment->status === 'paid') {
            return response()->json([
                'status' => 'paid',
                'message' => 'Payment has been confirmed.',
            ]);
        }

        // If there's a PayMongo checkout ID, poll PayMongo for the latest status
        if ($payment->paymongo_checkout_id && $payMongo->isConfigured()) {
            $session = $payMongo->retrieveCheckoutSession($payment->paymongo_checkout_id);
            $sessionStatus = $session['data']['attributes']['payment_intent']['attributes']['status'] ?? null;
            $payments = $session['data']['attributes']['payments'] ?? [];

            if ($sessionStatus === 'succeeded' || count($payments) > 0) {
                // Payment went through but webhook hasn't arrived yet — confirm it now
                $paymongoPaymentId = $payments[0]['id'] ?? null;

                DB::transaction(function () use ($payment, $order, $paymongoPaymentId): void {
                    $now = now();

                    $payment->update([
                        'status' => 'paid',
                        'paid_at' => $now,
                        'submitted_at' => $payment->submitted_at ?? $now,
                        'paymongo_payment_id' => $paymongoPaymentId,
                        'reference' => $paymongoPaymentId ?? $payment->reference,
                    ]);

                    if ($order->customer_stage === 'to_pay') {
                        $order->update(['customer_stage' => 'to_ship']);

                        OrderTrackingEvent::query()->create([
                            'order_id' => $order->id,
                            'stage' => 'to_ship',
                            'event_type' => 'system',
                            'title' => 'GCash payment confirmed',
                            'description' => 'Your GCash payment was verified automatically. '
                                . 'Your order is now being reviewed by FMRC.',
                            'occurred_at' => $now,
                            'metadata' => json_encode([
                                'payment_status' => 'paid',
                                'gateway' => 'paymongo',
                            ]),
                        ]);
                    }
                });

                return response()->json([
                    'status' => 'paid',
                    'message' => 'Payment has been confirmed.',
                ]);
            }
        }

        return response()->json([
            'status' => $payment->status,
            'message' => 'Payment is still pending.',
        ]);
    }
}
