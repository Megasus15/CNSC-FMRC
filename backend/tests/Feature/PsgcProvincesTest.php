<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PsgcProvincesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Http::preventStrayRequests();
    }

    public function test_nationwide_provinces_come_from_the_api_are_sorted_and_cached(): void
    {
        Http::fake(['https://psgc.cloud/api/provinces' => Http::response([
            ['code' => '0501600000', 'name' => 'Camarines Norte'],
            ['code' => '0307100000', 'name' => 'Zambales'],
            ['code' => '0500500000', 'name' => 'Albay'],
        ])]);
        $expected = [['code' => '0500500000', 'name' => 'Albay'], ['code' => '0501600000', 'name' => 'Camarines Norte'], ['code' => '0307100000', 'name' => 'Zambales']];
        $this->getJson('/api/psgc/provinces')->assertOk()->assertExactJson($expected);
        $this->getJson('/api/psgc/provinces')->assertOk()->assertExactJson($expected);
        Http::assertSentCount(1);
    }

    public function test_provider_failure_is_readable_and_can_be_retried_without_a_hardcoded_fallback(): void
    {
        Http::fake(['https://psgc.cloud/api/provinces' => Http::sequence()->push([], 503)->push([['code' => '0501600000', 'name' => 'Camarines Norte']])]);
        $this->getJson('/api/psgc/provinces')->assertStatus(502)->assertExactJson(['message' => 'The province list is temporarily unavailable. Please try again.']);
        $this->getJson('/api/psgc/provinces')->assertOk()->assertJsonCount(1);
        Http::assertSentCount(2);
    }

    public function test_malformed_or_empty_provider_data_is_not_kept_as_a_valid_catalog(): void
    {
        Http::fake(['https://psgc.cloud/api/provinces' => Http::sequence()
            ->push(['error' => 'Provider maintenance'])
            ->push([])
            ->push([['code' => 'bad', 'name' => 'Invalid place']])
            ->push([['code' => '0501600000', 'name' => 'Camarines Norte']])]);
        for ($i = 0; $i < 3; $i++) {
            $this->getJson('/api/psgc/provinces')->assertStatus(502);
        }
        $this->getJson('/api/psgc/provinces')->assertOk()->assertJsonPath('0.name', 'Camarines Norte');
        Http::assertSentCount(4);
    }
}
