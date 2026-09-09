<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper around the PayMongo REST API.
 *
 * Only the two endpoints FMRC actually needs are implemented:
 *
 *  1. Create a Checkout Session — called at order placement to get a URL
 *     the customer's browser is redirected to so GCash can collect the money.
 *
 *  2. Verify a webhook signature — called when PayMongo POSTs back to tell
 *     us the payment succeeded or failed.
 *
 * Everything goes over PayMongo's v1 JSON API, authenticated with the secret
 * key from config/payments.php (which reads .env). No third-party SDK is
 * needed: Laravel's HTTP client handles the request and the response.
 */
class PayMongoService
{
    private string $baseUrl;

    private string $secretKey;

    public function __construct()
    {
        $this->baseUrl = rtrim((string) config('payments.paymongo.base_url', 'https://api.paymongo.com/v1'), '/');
        $this->secretKey = (string) config('payments.paymongo.secret_key', '');
    }

    /**
     * Whether the PayMongo gateway has usable credentials.
     *
     * A half-configured .env (key present but empty) falls back to manual
     * GCash rather than breaking the checkout with a 401 from PayMongo.
     */
    public function isConfigured(): bool
    {
        return $this->secretKey !== ''
            && str_starts_with($this->secretKey, 'sk_');
    }

    /**
     * Create a PayMongo Checkout Session for a GCash payment.
     *
     * Returns the full API response as an array on success, or null on failure.
     * The caller reads `data.attributes.checkout_url` from the response to get
     * the URL the customer's browser should be redirected to.
     *
     * @param  int     $amountCentavos  Total in centavos (₱150.00 = 15000)
     * @param  string  $description     What the customer sees on the GCash page
     * @param  string  $orderNo         FMRC order number for reference
     * @param  int     $orderId         Internal order ID for the metadata
     * @param  int     $paymentId       Internal payment ID for webhook matching
     * @return array|null
     */
    public function createCheckoutSession(
        int $amountCentavos,
        string $description,
        string $orderNo,
        int $orderId,
        int $paymentId,
    ): ?array {
        $defaultBase = rtrim((string) (config('app.frontend_url') ?: config('app.url', 'https://ucn-fabmanlab.com')), '/');
        $successUrl = config('payments.paymongo.success_url') ?: "{$defaultBase}/products-page/product.html?payment=success";
        $failedUrl = config('payments.paymongo.failed_url') ?: "{$defaultBase}/products-page/product.html?payment=failed";

        // Append order identification to the redirect URLs so the frontend
        // can show meaningful feedback after the customer returns.
        $successUrl .= (str_contains($successUrl, '?') ? '&' : '?') . 'order_id=' . $orderId;
        $failedUrl .= (str_contains($failedUrl, '?') ? '&' : '?') . 'order_id=' . $orderId;

        $payload = [
            'data' => [
                'attributes' => [
                    'send_email_receipt' => false,
                    'show_description' => true,
                    'show_line_items' => true,
                    'description' => $description,
                    'line_items' => [
                        [
                            'currency' => 'PHP',
                            'amount' => $amountCentavos,
                            'name' => $description,
                            'quantity' => 1,
                        ],
                    ],
                    'payment_method_types' => ['gcash'],
                    'success_url' => $successUrl,
                    'cancel_url' => $failedUrl,
                    'metadata' => [
                        'order_id' => $orderId,
                        'order_no' => $orderNo,
                        'payment_id' => $paymentId,
                    ],
                ],
            ],
        ];

        try {
            $response = Http::withBasicAuth($this->secretKey, '')
                ->timeout(15)
                ->post("{$this->baseUrl}/checkout_sessions", $payload);

            if ($response->successful()) {
                return $response->json();
            }

            Log::error('[PAYMONGO] Checkout session creation failed', [
                'status' => $response->status(),
                'body' => $response->body(),
                'order_id' => $orderId,
            ]);

            return null;
        } catch (\Throwable $e) {
            Log::error('[PAYMONGO] Checkout session request exception', [
                'message' => $e->getMessage(),
                'order_id' => $orderId,
            ]);

            return null;
        }
    }

    /**
     * Retrieve a checkout session by its ID.
     *
     * Used to check the payment status when the customer returns from PayMongo,
     * as a fallback in case the webhook has not arrived yet.
     *
     * @return array|null
     */
    public function retrieveCheckoutSession(string $checkoutSessionId): ?array
    {
        try {
            $response = Http::withBasicAuth($this->secretKey, '')
                ->timeout(10)
                ->get("{$this->baseUrl}/checkout_sessions/{$checkoutSessionId}");

            if ($response->successful()) {
                return $response->json();
            }

            Log::warning('[PAYMONGO] Checkout session retrieval failed', [
                'status' => $response->status(),
                'checkout_session_id' => $checkoutSessionId,
            ]);

            return null;
        } catch (\Throwable $e) {
            Log::warning('[PAYMONGO] Checkout session retrieval exception', [
                'message' => $e->getMessage(),
                'checkout_session_id' => $checkoutSessionId,
            ]);

            return null;
        }
    }

    /**
     * Verify that a webhook payload actually came from PayMongo.
     *
     * PayMongo signs every webhook with the secret from the webhook
     * registration. The signature is in the `Paymongo-Signature` header
     * as `t=<timestamp>,te=<test_signature>,li=<live_signature>`.
     *
     * We recompute the HMAC and compare it to the one in the header.
     */
    public function verifyWebhookSignature(string $payload, string $signatureHeader): bool
    {
        $webhookSecret = (string) config('payments.paymongo.webhook_secret', '');

        if ($webhookSecret === '') {
            // No webhook secret configured — accept everything in test mode
            // to avoid blocking development. In production this should always
            // be set.
            Log::warning('[PAYMONGO] Webhook secret not configured, skipping signature verification');
            return true;
        }

        // Parse the signature header: t=timestamp,te=test_sig,li=live_sig
        $parts = [];
        foreach (explode(',', $signatureHeader) as $part) {
            [$key, $value] = explode('=', $part, 2) + [null, null];
            if ($key !== null && $value !== null) {
                $parts[trim($key)] = trim($value);
            }
        }

        $timestamp = $parts['t'] ?? '';

        // In test mode, use the 'te' (test environment) signature.
        // In live mode, use the 'li' (live) signature.
        $signature = $parts['te'] ?? $parts['li'] ?? '';

        if ($timestamp === '' || $signature === '') {
            return false;
        }

        // Recompute: HMAC-SHA256 of "timestamp.payload" using the webhook secret
        $expectedSignature = hash_hmac('sha256', "{$timestamp}.{$payload}", $webhookSecret);

        return hash_equals($expectedSignature, $signature);
    }
}
