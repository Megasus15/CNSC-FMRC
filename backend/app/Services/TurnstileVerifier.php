<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TurnstileVerifier
{
    private const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    public function isEnabled(): bool
    {
        return (bool) config('services.turnstile.enabled', false)
            && trim((string) config('services.turnstile.site_key', '')) !== ''
            && trim((string) config('services.turnstile.secret_key', '')) !== '';
    }

    public function verify(?string $token, ?string $remoteIp = null): bool
    {
        if (!$this->isEnabled()) {
            return true;
        }

        $token = trim((string) $token);
        if ($token === '') {
            return false;
        }

        try {
            $payload = [
                'secret' => (string) config('services.turnstile.secret_key'),
                'response' => $token,
            ];

            if ($remoteIp) {
                $payload['remoteip'] = $remoteIp;
            }

            $response = Http::asForm()
                ->acceptJson()
                ->timeout(max(1, (int) config('services.turnstile.timeout', 5)))
                ->post(self::SITEVERIFY_URL, $payload);

            return $response->successful() && $response->json('success') === true;
        } catch (\Throwable $exception) {
            Log::warning('Cloudflare Turnstile verification failed to complete.', [
                'exception' => $exception->getMessage(),
            ]);

            return false;
        }
    }
}
