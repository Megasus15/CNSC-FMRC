<?php

namespace App\Services;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

final class NinjaVanClient
{
    public static function environment(): string
    {
        return (string) config('ninjavan.environment', 'sandbox');
    }

    public static function ready(): bool
    {
        $mode = self::environment();
        $from = config('ninjavan.from', []);

        return (bool) config('ninjavan.enabled') && in_array($mode, ['sandbox', 'production'], true)
            && ($mode !== 'production' || config('ninjavan.production_approved'))
            && filled(config('ninjavan.client_id')) && filled(config('ninjavan.client_secret'))
            && filled($from['name'] ?? null) && filled($from['phone_number'] ?? null)
            && filled($from['address']['address1'] ?? null) && filled($from['address']['city'] ?? null)
            && filled($from['address']['state'] ?? null) && filled($from['address']['postcode'] ?? null)
            && filled(config('ninjavan.delivery_start')) && filled(config('ninjavan.delivery_end'));
    }

    public static function base(): string
    {
        return self::environment() === 'production' ? 'https://api.ninjavan.co/ph' : 'https://api-sandbox.ninjavan.co/sg';
    }

    private function cacheKey(): string
    {
        return 'ninjavan-token:'.hash('sha256', self::environment().'|'.config('ninjavan.client_id'));
    }

    private function token(bool $renew = false): string
    {
        $key = $this->cacheKey();
        if ($renew) {
            Cache::forget($key);
        }
        if ($token = Cache::get($key)) {
            return $token;
        }
        try {
            return Cache::lock($key.':lock', 30)->block(5, function () use ($key) {
                if ($cached = Cache::get($key)) {
                    return $cached;
                }
                try {
                    $response = Http::acceptJson()->connectTimeout(8)->timeout(20)->post(self::base().'/2.0/oauth/access_token', [
                        'client_id' => config('ninjavan.client_id'), 'client_secret' => config('ninjavan.client_secret'), 'grant_type' => 'client_credentials']);
                } catch (ConnectionException) {
                    throw new NinjaVanException(0, 'authentication_unavailable', false);
                }
                $token = $response->json('access_token');
                if (! $response->successful() || ! is_string($token) || $token === '') {
                    throw new NinjaVanException($response->status(), 'authentication_unavailable', false);
                }
                $seconds = max(1, (int) $response->json('expires_in', 300));
                Cache::put($key, $token, max(1, $seconds - ($seconds > 300 ? 300 : 10)));

                return $token;
            });
        } catch (LockTimeoutException) {
            throw new NinjaVanException(0, 'authentication_busy', false);
        }
    }

    private function request(string $method, string $path, ?array $payload = null): array
    {
        abort_unless(self::ready(), 503, 'Courier booking is not yet available. You can continue using manual tracking.');
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $token = $this->token($attempt > 0);
            try {
                $response = Http::withToken($token)->acceptJson()->connectTimeout(8)->timeout(20)->send($method, self::base().$path, $payload === null ? [] : ['json' => $payload]);
            } catch (ConnectionException) {
                throw new NinjaVanException(0, 'connection_uncertain', true);
            }
            if ($response->status() === 401 && $attempt === 0) {
                continue;
            }
            if (! $response->successful()) {
                $code = (string) $response->json('error.code', $response->status());
                $code = preg_replace('/[^a-zA-Z0-9_-]/', '', $code);
                throw new NinjaVanException($response->status(), substr($code, 0, 80), $response->serverError() || $response->status() === 429 || $code === '109201');
            }
            if ($method === 'DELETE' && ($response->status() === 204 || trim($response->body()) === '')) {
                return [];
            }
            $json = $response->json();
            if (! is_array($json)) {
                throw new NinjaVanException($response->status(), 'invalid_response', true);
            }

            return $json;
        }
        throw new NinjaVanException(401, 'authentication_unavailable', false);
    }

    public function book(array $payload): array
    {
        return $this->request('POST', '/4.2/orders', $payload);
    }

    public function cancel(string $tracking): array
    {
        return $this->request('DELETE','/2.2/orders/'.rawurlencode($tracking));
    }
}
