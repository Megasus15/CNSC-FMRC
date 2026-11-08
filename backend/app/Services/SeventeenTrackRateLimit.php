<?php

namespace App\Services;

use Closure;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;

/** Share request spacing and HTTP 429 cooldowns across workers using the same API key. */
final class SeventeenTrackRateLimit
{
    public function __construct(private ?Closure $clock = null, private ?Closure $sleep = null) {}

    private function time(): float
    {
        return $this->clock ? ($this->clock)() : microtime(true);
    }

    private function key(): string
    {
        return '17track:requests:'.SeventeenTrackClient::fingerprint();
    }

    public function beforeRequest(): void
    {
        try {
            Cache::lock($this->key().':lock', 5)->block(2, function () {
                $now = $this->time();
                $until = (float) Cache::get($this->key().':cooldown', 0);
                if ($until > $now) {
                    throw new SeventeenTrackException('rate_limited', (int) ceil($until - $now), 429);
                }
                // 400 ms between starts stays below the documented 3 requests/s.
                $wait = max(0, (float) Cache::get($this->key().':last', 0) + 0.4 - $now);
                if ($wait > 0) {
                    $this->sleep ? ($this->sleep)($wait) : usleep((int) ceil($wait * 1000000));
                }
                Cache::put($this->key().':last', $this->time(), 30);
            });
        } catch (LockTimeoutException) {
            throw new SeventeenTrackException('request_deferred', 5);
        }
    }

    public function defer(int $seconds): void
    {
        Cache::lock($this->key().':lock', 5)->block(2, function () use ($seconds) {
            $seconds = max(1, min(86400, $seconds));
            $until = max((float) Cache::get($this->key().':cooldown', 0), $this->time() + $seconds);
            Cache::put($this->key().':cooldown', $until, (int) ceil($until - $this->time()));
        });
    }
}
