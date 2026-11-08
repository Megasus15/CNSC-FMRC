<?php

namespace Tests\Feature;

use App\Services\SeventeenTrackClient;
use App\Services\SeventeenTrackException;
use App\Services\SeventeenTrackRateLimit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SeventeenTrackRateLimitTest extends TestCase
{
    private float $clock;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-08T09:00:00Z');
        $this->clock = (float) now()->timestamp;
        config(['track17.api_key' => 'request-pacing-fixture']);
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function client(): SeventeenTrackClient
    {
        return new SeventeenTrackClient(new SeventeenTrackRateLimit(fn () => $this->clock, function ($seconds) {
            $this->clock += $seconds;
        }));
    }

    public function test_independent_clients_share_request_spacing_for_the_same_account(): void
    {
        $starts = [];
        Http::fake(function () use (&$starts) {
            $starts[] = $this->clock;
            return Http::response(['code' => 0, 'data' => ['quota_remain' => 198]]);
        });
        for ($i = 0; $i < 6; $i++) {
            $this->assertSame(198, $this->client()->request('getquota', [])['quota_remain']);
        }
        foreach (array_slice($starts, 1) as $i => $start) {
            $this->assertGreaterThanOrEqual(0.399, $start - $starts[$i]);
        }
        $this->assertGreaterThanOrEqual(1.199, $starts[3] - $starts[0]);
        Http::assertSentCount(6);
    }

    public function test_http_429_cooldown_is_shared_and_recovery_requires_no_new_registration(): void
    {
        $calls = 0;
        Http::fake(function () use (&$calls) {
            return ++$calls === 1 ? Http::response([], 429, ['Retry-After' => '90'])
                : Http::response(['code' => 0, 'data' => ['quota_remain' => 198]]);
        });
        for ($i = 0; $i < 2; $i++) {
            try {
                $this->client()->request('getquota', []);
                $this->fail('The provider cooldown must be respected.');
            } catch (SeventeenTrackException $error) {
                $this->assertSame('rate_limited', $error->reason);
                $this->assertSame(429, $error->httpStatus);
                $this->assertSame(90, $error->retryAfter);
            }
        }
        Http::assertSentCount(1);
        $this->clock += 91;
        Carbon::setTestNow(now()->addSeconds(91));
        $this->assertSame(198, $this->client()->request('getquota', [])['quota_remain']);
        Http::assertSentCount(2);
        Http::assertNotSent(fn ($request) => str_ends_with($request->url(), '/register'));
    }

    public function test_retry_after_http_date_is_parsed_as_a_duration(): void
    {
        Http::fake(fn () => Http::response([], 429, ['Retry-After' => now()->addSeconds(120)->toRfc7231String()]));
        try {
            $this->client()->request('getquota', []);
            $this->fail('Expected HTTP 429.');
        } catch (SeventeenTrackException $error) {
            $this->assertSame('rate_limited', $error->reason);
            $this->assertSame(120, $error->retryAfter);
        }
    }

    public function test_daily_allowance_error_keeps_its_numeric_provider_code_and_does_not_disable_quota_reads(): void
    {
        Http::fake([
            '*/register' => Http::response(['code' => 0, 'data' => ['accepted' => [], 'rejected' => [[
                'number' => 'JT-LIMIT-FIXTURE', 'carrier' => 100240, 'error' => ['code' => -18019907],
            ]]]]),
            '*/getquota' => Http::response(['code' => 0, 'data' => ['quota_remain' => 198, 'max_track_daily' => 2]]),
        ]);
        try {
            $this->client()->item('register', ['number' => 'JT-LIMIT-FIXTURE', 'carrier' => 100240]);
            $this->fail('Expected a daily tracking allowance error.');
        } catch (SeventeenTrackException $error) {
            $this->assertSame('daily_limit_reached', $error->reason);
            $this->assertSame(-18019907, $error->providerCode);
            $this->assertSame(200, $error->httpStatus);
            $this->assertSame('register', $error->endpoint);
            $this->assertSame(3600, $error->retryAfter);
        }
        $this->assertSame(2, $this->client()->request('getquota', [])['max_track_daily']);
    }
}
