<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final class Ship24Client
{
    public static function configured(): bool
    {
        return trim((string) config('ship24.api_key')) !== '' && trim((string) config('ship24.webhook_secret')) !== '';
    }

    public static function fingerprint(): string
    {
        return hash('sha256', (string) config('ship24.api_key'));
    }

    public function request(string $method, string $path, array $body = []): array
    {
        if (! self::configured()) {
            throw new Ship24Exception('not_configured');
        }
        try {
            $response = Http::acceptJson()->withToken((string) config('ship24.api_key'))
                ->connectTimeout(3)->timeout(8)->withoutRedirecting()->send($method,
                    'https://api.ship24.com/public/v1/'.$path, $method === 'GET' ? ['query' => $body] : ['json' => $body]);
        } catch (ConnectionException) {
            throw new Ship24Exception('connection_unknown');
        }
        $json = $response->json();
        $codes = array_column(is_array($json['errors'] ?? null) ? $json['errors'] : [], 'code');
        $codes[] = $json['error']['code'] ?? '';
        if (in_array('quota_limit_reached', $codes, true) || $response->status() === 402) {
            throw new Ship24Exception('quota_limit_reached', 86400);
        }
        if ($response->status() === 429) {
            $header = $response->header('Retry-After');
            $delay = is_numeric($header) ? (int) $header : ($header ? (strtotime($header) ?: time()) - time() : 0);
            $reset = (int) ($response->header('RateLimit-Reset') ?: $response->header('X-RateLimit-Reset'));
            if (! $delay && $reset) {
                $delay = $reset > time() ? $reset - time() : $reset;
            }
            throw new Ship24Exception('rate_limited', max(60, min(86400, $delay)));
        }
        if (in_array($response->status(), [401, 403], true)) {
            throw new Ship24Exception('credentials_rejected', 3600);
        }
        if ($response->status() === 404) {
            throw new Ship24Exception('not_found');
        }
        if ($response->status() === 400 || $response->status() === 422) {
            throw new Ship24Exception('details_rejected');
        }
        if (! $response->successful() || ! is_array($json) || ! is_array($json['data'] ?? null)) {
            throw new Ship24Exception('provider_unavailable');
        }

        return $json['data'];
    }

    public function couriers(): array
    {
        return $this->request('GET', 'couriers')['couriers'] ?? [];
    }

    public function create(array $payload): array
    {
        return $this->request('POST', 'trackers', $payload)['tracker'] ?? [];
    }

    public function find(string $clientId): array
    {
        return $this->request('GET', 'trackers/'.rawurlencode($clientId), ['searchBy' => 'clientTrackerId'])['tracker'] ?? [];
    }

    public function results(string $id): array
    {
        return $this->request('GET', 'trackers/'.rawurlencode($id).'/results')['trackings'] ?? [];
    }

    public function unsubscribe(string $id): void
    {
        $this->request('PATCH', 'trackers/'.rawurlencode($id), ['isSubscribed' => false]);
    }
}
