<?php
namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

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
    /** Read only. Scheduled payouts cannot fund a QR Ph refund before settlement. */
    public function refundFunding(bool $refresh = false): array {
        $unavailable = ['status'=>'unavailable','available_centavos'=>null,
            'message'=>'Wallet balance unavailable. Check PayMongo before issuing a refund.'];
        if (!$this->isConfigured() || !$this->isLive()) return $unavailable;
        $key = 'paymongo:refund-funding:'.hash('sha256', (string) config('payments.paymongo.secret_key'));
        if (!$refresh && ($cached = Cache::get($key))) return $cached;
        $result = $this->request('GET', 'v2/wallets?fields=balance', timeout: 5);
        $wallets = $result['data'] ?? null;
        $funding = $unavailable;
        if (is_array($wallets)) {
            // QR Ph creation uses the default wallet; do not add other wallets or pending funds.
            $wallet = collect($wallets)->first(fn($w)=>is_array($w) && ($w['is_default'] ?? false) === true && ($w['livemode'] ?? null) === true);
            $available = $wallet['balance']['available'] ?? null;
            if ($wallet && ($wallet['status'] ?? '') !== 'activated') {
                $funding = ['status'=>'inactive','available_centavos'=>null,'message'=>'Activate the PayMongo wallet before issuing a refund.'];
            } elseif ($wallet && is_int($available) && $available >= 0) {
                $funding = ['status'=>$available > 0 ? 'available' : 'empty','available_centavos'=>$available,
                    'message'=>$available > 0 ? 'QR Ph refunds use the available wallet balance.' : 'Top up the PayMongo wallet to issue QR Ph refunds. Scheduled payouts are not available funds.'];
            }
        }
        Cache::put($key, $funding, now()->addSeconds(15));
        return $funding;
    }
    public function request(string $method, string $path, array $attributes = [], ?string $idempotencyKey = null, bool $qrphRefund = false, int $timeout = 15): ?array {
        if (!$this->isConfigured()) return null;
        // Separate QR Ph creation API; never accept a caller-supplied host.
        if ($qrphRefund && !(($method === 'POST' && $path === 'v1/refunds') || ($method === 'GET' && preg_match('/^v1\/refunds\/ref_[A-Za-z0-9]+$/',$path)))) return null;
        try {
            $client = Http::withBasicAuth((string) config('payments.paymongo.secret_key'), '')->acceptJson()->timeout($timeout);
            $url = ($qrphRefund ? 'https://refunds-api.paymongo.com/' : 'https://api.paymongo.com/').$path;
            if ($idempotencyKey) $client = $client->withHeaders(['Idempotency-Key' => $idempotencyKey]);
            $response = $method === 'GET' ? $client->get($url) : $client->post($url, ['data' => ['attributes' => $attributes]]);
            // Never automatically retry money-moving POSTs. An ambiguous result is reconciled first.
            if ($response->successful()) return $response->json();
            if ($method === 'GET' && $response->status() === 404 && preg_match('/^v1\/refunds\/ref_[A-Za-z0-9]+$/',$path)) return ['not_found'=>true];
            Log::warning('Payment provider request failed', ['path' => strtok($path, '?'), 'status' => $response->status()]);
            if ($method === 'POST' && in_array($response->status(), [400,401,403,404,422], true)) {
                $error = $response->json('errors.0') ?? [];
                $failure = \App\Support\RefundStatus::failure(is_string($error['code'] ?? null) ? $error['code'] : null,
                    is_string($error['detail'] ?? null) ? $error['detail'] : '', $response->status(), $error['source'] ?? []);
                return ['rejected' => true] + $failure;
            }
            return null;
        } catch (\Throwable $e) {
            Log::warning('Payment provider unavailable', ['operation' => $method]);
            return null;
        }
    }
    public function retrieveRefund(string $id, bool $qrph = false, ?string $paymentId = null): ?array {
        if (!preg_match('/^ref_[A-Za-z0-9]+$/',$id)) return null;
        // Use the standard retrieval resource first. A QR Ph record absent there
        // can be looked up on its creation service; this fallback is GET-only.
        $result = $this->request('GET','v1/refunds/'.$id);
        if ($qrph && ($result['not_found'] ?? false)) $result = $this->request('GET','v1/refunds/'.$id,[],null,true);
        // Some live QR Ph refunds are exposed only inside their original
        // payment, while both individual refund lookup endpoints return 404.
        // Read that exact payment; never recreate a refund to recover its status.
        if ($qrph && ($result['not_found'] ?? false) && preg_match('/^pay_[A-Za-z0-9]+$/', $paymentId ?? '')) {
            $payment = $this->request('GET', 'v1/payments/'.$paymentId);
            $data = $payment['data'] ?? [];
            $attributes = $data['attributes'] ?? [];
            if (($data['id'] ?? null) !== $paymentId || ($attributes['livemode'] ?? null) !== $this->isLive()) return null;
            foreach (($attributes['refunds'] ?? []) as $refund) {
                if (!is_array($refund) || ($refund['id'] ?? null) !== $id) continue;
                $a = $refund['attributes'] ?? [];
                if (($a['payment_id'] ?? null) !== $paymentId || ($a['livemode'] ?? null) !== $this->isLive()) return null;
                return ['data' => $refund];
            }
            return null;
        }
        return ($result['not_found'] ?? false) ? null : $result;
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
