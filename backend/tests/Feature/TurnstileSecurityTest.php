<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TurnstileSecurityTest extends TestCase
{
    private function enableTurnstile(): void
    {
        Config::set('services.turnstile.enabled', true);
        Config::set('services.turnstile.site_key', 'test-site-key');
        Config::set('services.turnstile.secret_key', 'test-secret-key');
        Config::set('services.turnstile.timeout', 5);
    }

    public function test_protected_registration_rejects_a_missing_token(): void
    {
        $this->enableTurnstile();
        Http::fake();

        $this->postJson('/api/register', [])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Please complete the security check and try again.');

        Http::assertNothingSent();
    }

    public function test_valid_token_is_verified_before_registration_validation(): void
    {
        $this->enableTurnstile();
        Http::fake([
            'https://challenges.cloudflare.com/turnstile/v0/siteverify' => Http::response([
                'success' => true,
            ]),
        ]);

        $this->postJson('/api/register', [
            'cf-turnstile-response' => 'valid-test-token',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'username', 'email', 'password']);

        Http::assertSent(function ($request) {
            return $request->url() === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
                && $request['secret'] === 'test-secret-key'
                && $request['response'] === 'valid-test-token';
        });
    }

    public function test_invalid_token_is_rejected_without_reaching_the_controller(): void
    {
        $this->enableTurnstile();
        Http::fake([
            'https://challenges.cloudflare.com/turnstile/v0/siteverify' => Http::response([
                'success' => false,
                'error-codes' => ['invalid-input-response'],
            ]),
        ]);

        $this->postJson('/api/register', [
            'cf-turnstile-response' => 'invalid-test-token',
        ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Please complete the security check and try again.');
    }

    public function test_public_security_config_returns_only_the_site_key(): void
    {
        $this->enableTurnstile();

        $this->getJson('/api/security-config')
            ->assertOk()
            ->assertJsonPath('turnstile.enabled', true)
            ->assertJsonPath('turnstile.site_key', 'test-site-key')
            ->assertJsonMissing(['secret_key' => 'test-secret-key']);
    }
}
