<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final class SeventeenTrackClient
{
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
            -18019907 => 'rate_limited', -18010001, -18010002, -18010004, -18010005 => 'credentials_rejected',
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
        if (! in_array($endpoint, ['register', 'gettrackinfo', 'changeinfo', 'stoptrack'], true)) {
            throw new \InvalidArgumentException('Unsupported tracking operation.');
        }
        try {
            $response = Http::acceptJson()->withHeaders(['17token' => config('track17.api_key')])
                ->connectTimeout(3)->timeout(8)->withoutRedirecting()->post('https://api.17track.net/track/v2.4/'.$endpoint, $items);
        } catch (ConnectionException) {
            throw new SeventeenTrackException('connection_unknown');
        }
        if ($response->status() === 429) {
            throw new SeventeenTrackException('rate_limited', max(60, min(86400, (int) $response->header('Retry-After'))));
        }
        if (in_array($response->status(), [401, 403], true)) {
            throw new SeventeenTrackException('credentials_rejected', 3600);
        }
        $json = $response->json();
        if (! $response->successful() || ! is_array($json) || ! is_array($json['data'] ?? null)) {
            throw new SeventeenTrackException('provider_unavailable');
        }
        $error = $json['data']['errors'][0]['code'] ?? null;
        if (($json['code'] ?? null) !== 0 || $error !== null) {
            throw new SeventeenTrackException($this->reason((int) ($error ?? $json['code'] ?? -1)));
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
        throw new SeventeenTrackException($this->reason((int) ($rejected['error']['code'] ?? -1)));
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
