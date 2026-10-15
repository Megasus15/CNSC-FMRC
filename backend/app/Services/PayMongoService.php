<?php
namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/** Secrets never leave the server. No simulator or unsigned verification path. */
class PayMongoService
{
    public function checkoutMethod(): string { return (string) config('payments.paymongo.checkout_method', 'qrph'); }
    public static function supportsMethod(string $method): bool { return in_array($method, ['gcash', 'qrph'], true); }
    public static function methodLabel(string $method): string { return $method === 'qrph' ? 'QR Ph' : 'GCash'; }
    public static function checkoutLabel(string $method): string { return $method === 'qrph' ? 'GCash / QR Ph' : 'GCash'; }
    public static function checkoutDescription(string $method): string {
        return $method === 'qrph'
            ? 'Pay with GCash or another supported app using the QR code on the secure checkout page. Your payment is confirmed automatically.'
            : 'Authorize payment through GCash on the secure checkout page. Your payment is confirmed automatically.';
    }
    public function isLive(): bool { return str_starts_with((string) config('payments.paymongo.secret_key'), 'sk_live_'); }
    public function isConfigured(): bool {
        $key = (string) config('payments.paymongo.secret_key');
        return preg_match('/^sk_(test|live)_.+$/', $key) === 1
            && (string) config('payments.paymongo.webhook_secret') !== ''
            && (!app()->environment('production') || $this->isLive());
    }
    public function acceptsNewPayments(): bool {
        return config('payments.gateway') === 'paymongo' && config('payments.paymongo.enabled', false) && $this->isConfigured() && self::supportsMethod($this->checkoutMethod());
    }
    public function request(string $method, string $path, array $attributes = [], ?string $idempotencyKey = null): ?array {
        if (!$this->isConfigured()) return null;
        try {
            $client = Http::withBasicAuth((string) config('payments.paymongo.secret_key'), '')->acceptJson()->timeout(15);
            $url = 'https://api.paymongo.com/'.$path;
            if ($idempotencyKey) $client = $client->withHeaders(['Idempotency-Key' => $idempotencyKey]);
            $response = $method === 'GET' ? $client->get($url) : $client->post($url, ['data' => ['attributes' => $attributes]]);
            // Never automatically retry money-moving POSTs. An ambiguous result is reconciled first.
            if ($response->successful()) return $response->json();
            Log::warning('Payment provider request failed', ['path' => strtok($path, '?'), 'status' => $response->status()]);
            if ($method === 'POST' && in_array($response->status(), [400,401,403,404,422], true)) return ['rejected' => true];
            return null;
        } catch (\Throwable $e) {
            Log::warning('Payment provider unavailable', ['operation' => $method]);
            return null;
        }
    }
    public function createCheckoutSession(int $amountCentavos, string $description, string $orderNo, int $orderId, int $paymentId, string $appContext = '', string $attemptToken = '', ?string $checkoutMethod = null): ?array {
        $checkoutMethod ??= $this->checkoutMethod();
        if (!self::supportsMethod($checkoutMethod)) return null;
        $base = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');
        if (app()->environment('production') && !str_starts_with($base, 'https://')) return null;
        $page = $base.($appContext === 'customer' ? '/apps/customer' : '').'/products-page/product.html';
        return $this->request('POST', 'v2/checkout_sessions', [
            'line_items' => [['currency' => 'PHP', 'amount' => $amountCentavos, 'name' => $description, 'quantity' => 1]],
            'payment_method_types' => [$checkoutMethod], 'pass_on_fees' => false,
            'send_email_receipt' => false, 'show_description' => true, 'show_line_items' => true,
            'description' => $description, 'reference_number' => $attemptToken,
            'success_url' => $page.'?payment=return&order_id='.$orderId,
            'cancel_url' => $page.'?payment=cancelled&order_id='.$orderId,
            'metadata' => ['order_id' => (string) $orderId, 'payment_id' => (string) $paymentId, 'attempt_token' => $attemptToken],
        ], $attemptToken);
    }
    // The v1 retrieval API supports both current and legacy sessions.
    public function retrieveCheckoutSession(string $id): ?array {
        if (!preg_match('/^cs_[a-zA-Z0-9]+$/', $id)) return null;
        return $this->request('GET', 'v1/checkout_sessions/'.$id);
    }
    public function verifyWebhookSignature(string $payload, string $header): bool {
        if (!$this->isConfigured()) return false;
        $parts = [];
        foreach (explode(',', $header) as $part) {
            $pair = explode('=', trim($part), 2);
            if (count($pair) === 2) $parts[$pair[0]] = $pair[1];
        }
        $timestamp = $parts['t'] ?? '';
        if (!ctype_digit($timestamp) || abs(time() - (int) $timestamp) > 300) return false;
        $signature = $parts[$this->isLive() ? 'li' : 'te'] ?? '';
        $expected = hash_hmac('sha256', $timestamp.'.'.$payload, (string) config('payments.paymongo.webhook_secret'));
        return $signature !== '' && hash_equals($expected, $signature);
    }
}
