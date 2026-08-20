<?php

namespace Tests\Feature;

use App\Http\Middleware\VerifyTurnstile;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
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

    private function postRouteMiddleware(string $uri): array
    {
        foreach (Route::getRoutes() as $route) {
            if ($route->uri() === $uri && in_array('POST', $route->methods(), true)) {
                return $route->gatherMiddleware();
            }
        }

        $this->fail("No POST route registered for [{$uri}].");
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

    /*
     * Admin/staff sign-in requires all three of email/username, password and a
     * completed challenge. These two tests prove the third: the credentials are
     * never even looked at while the token is missing or unverified.
     */
    public function test_admin_staff_login_rejects_a_missing_token(): void
    {
        $this->enableTurnstile();
        Http::fake();

        $this->postJson('/api/login', [
            'login' => 'admin',
            'password' => 'correct-horse-battery-staple',
        ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Please complete the security check and try again.')
            ->assertJsonValidationErrors(['cf-turnstile-response']);

        Http::assertNothingSent();
    }

    public function test_admin_staff_login_rejects_a_token_cloudflare_does_not_accept(): void
    {
        $this->enableTurnstile();
        Http::fake([
            'https://challenges.cloudflare.com/turnstile/v0/siteverify' => Http::response([
                'success' => false,
                'error-codes' => ['timeout-or-duplicate'],
            ]),
        ]);

        $this->postJson('/api/login', [
            'login' => 'admin',
            'password' => 'correct-horse-battery-staple',
            'cf-turnstile-response' => 'stale-test-token',
        ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Please complete the security check and try again.');

        Http::assertSent(fn ($request) => $request['response'] === 'stale-test-token');
    }

    public function test_every_guarded_form_including_the_admin_login_is_enforced(): void
    {
        $uris = ['api/login', 'api/customer/login', 'api/register', 'api/appointments'];

        foreach ($uris as $uri) {
            $middleware = $this->postRouteMiddleware($uri);

            $this->assertContains(VerifyTurnstile::class, $middleware, "[{$uri}] lost its Turnstile guard.");

            // A middleware parameter would mean a relaxed mode had been
            // reintroduced; every guarded route must reject an unsolved check.
            foreach ($middleware as $entry) {
                $this->assertStringStartsNotWith(
                    VerifyTurnstile::class . ':',
                    $entry,
                    "[{$uri}] must not weaken the Turnstile guard with a mode parameter.",
                );
            }
        }
    }
}
