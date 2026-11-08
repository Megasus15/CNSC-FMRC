<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final class SeventeenTrackClient
{
    public function __construct(private SeventeenTrackRateLimit $rateLimit) {}

    public static function configured(): bool
    {
        return trim((string) config('track17.api_key')) !== '';
    }

    public static function fingerprint(): string
    {
        return hash('sha256', (string) config('track17.api_key'));
    }

    private function reason(int $code): string
    {
        return match ($code) {
            -18019901 => 'already_registered', -18019902 => 'not_registered', -18019908 => 'quota_limit_reached',
            -18019907 => 'daily_limit_reached', 429 => 'rate_limited', -18010001, -18010002, -18010004, -18010005 => 'credentials_rejected',
            -18019906 => 'already_stopped', -18019909 => 'no_events', -18010003 => 'provider_unavailable',
            default => 'details_rejected',
        };
    }

    public function request(string $endpoint, array $items): array
    {
        if (! self::configured()) {
            throw new SeventeenTrackException('not_configured');
        }
        // The immediate carrier-lookup and translation endpoints are deliberately unavailable here.
        if (! in_array($endpoint, ['register', 'gettrackinfo', 'changeinfo', 'stoptrack', 'getquota'], true)) {
            throw new \InvalidArgumentException('Unsupported tracking operation.');
        }
        $this->rateLimit->beforeRequest();
        try {
            $response = Http::acceptJson()->withHeaders(['17token' => config('track17.api_key')])
                ->connectTimeout(3)->timeout(8)->withoutRedirecting()->post('https://api.17track.net/track/v2.4/'.$endpoint, $items);
        } catch (ConnectionException) {
            throw new SeventeenTrackException('connection_unknown', 60, endpoint: $endpoint);
        }
        if ($response->status() === 429) {
            $header = trim((string) $response->header('Retry-After'));
            $retry = ctype_digit($header) ? (int) $header : (($at = strtotime($header)) ? $at - now()->timestamp : 60);
            $retry = max(1, min(86400, $retry));
            $this->rateLimit->defer($retry);
            throw new SeventeenTrackException('rate_limited', $retry, 429, endpoint: $endpoint);
        }
        if (in_array($response->status(), [401, 403], true)) {
            throw new SeventeenTrackException('credentials_rejected', 3600, $response->status(), endpoint: $endpoint);
        }
        $json = $response->json();
        if (! $response->successful() || ! is_array($json) || ! is_array($json['data'] ?? null)) {
            throw new SeventeenTrackException('provider_unavailable');
        }
        $error = $json['data']['errors'][0]['code'] ?? null;
        if (($json['code'] ?? null) !== 0 || $error !== null) {
            throw $this->error((int) ($error ?? $json['code'] ?? -1), $response->status(), $endpoint);
        }

        return $json['data'];
    }

    public function item(string $endpoint, array $item): array
    {
        $data = $this->request($endpoint, [$item]);
        foreach ($data['accepted'] ?? [] as $accepted) {
            if (strtoupper((string) ($accepted['number'] ?? '')) !== $item['number'] || (int) ($accepted['carrier'] ?? 0) !== (int) $item['carrier']) {
                throw new SeventeenTrackException('response_mismatch');
            }

            return $accepted;
        }
        $rejected = $data['rejected'][0] ?? [];
        throw $this->error((int) ($rejected['error']['code'] ?? -1), 200, $endpoint);
    }

    private function error(int $code, int $http, string $endpoint): SeventeenTrackException
    {
        $reason = $this->reason($code);
        if ($reason === 'rate_limited') {
            $this->rateLimit->defer(60);
        }

        return new SeventeenTrackException($reason, $reason === 'daily_limit_reached' ? 3600 : 60, $http, $code, $endpoint);
    }

    public function couriers(): array
    {
        try {
            $response = Http::acceptJson()->connectTimeout(3)->timeout(8)->withoutRedirecting()
                ->get('https://res.17track.net/asset/carrier/info/apicarrier.all.json');
        } catch (ConnectionException) {
            throw new SeventeenTrackException('provider_unavailable');
        }
        if (! $response->successful() || ! is_array($response->json())) {
            throw new SeventeenTrackException('provider_unavailable');
        }

        return $response->json();
    }
}
