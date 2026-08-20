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

    private function registerProbeRoutes(): void
    {
        Route::post('/_turnstile-probe/enforced', fn () => response()->json(['reached' => true]))
            ->middleware(VerifyTurnstile::class);

        Route::post('/_turnstile-probe/advisory', fn () => response()->json(['reached' => true]))
            ->middleware(VerifyTurnstile::class . ':advisory');
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

    public function test_enforced_route_still_rejects_a_missing_token(): void
    {
        $this->enableTurnstile();
        $this->registerProbeRoutes();
        Http::fake();

        $this->postJson('/_turnstile-probe/enforced', [])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Please complete the security check and try again.');

        Http::assertNothingSent();
    }

    public function test_advisory_route_allows_a_missing_token_without_calling_cloudflare(): void
    {
        $this->enableTurnstile();
        $this->registerProbeRoutes();
        Http::fake();

        $this->postJson('/_turnstile-probe/advisory', [])
            ->assertOk()
            ->assertJsonPath('reached', true);

        Http::assertNothingSent();
    }

    public function test_advisory_route_allows_a_token_cloudflare_rejects(): void
    {
        $this->enableTurnstile();
        $this->registerProbeRoutes();
        Http::fake([
            'https://challenges.cloudflare.com/turnstile/v0/siteverify' => Http::response([
                'success' => false,
                'error-codes' => ['invalid-input-response'],
            ]),
        ]);

        $this->postJson('/_turnstile-probe/advisory', [
            'cf-turnstile-response' => 'rejected-test-token',
        ])
            ->assertOk()
            ->assertJsonPath('reached', true);

        Http::assertSent(fn ($request) => $request['response'] === 'rejected-test-token');
    }

    public function test_advisory_route_still_verifies_a_token_that_is_present(): void
    {
        $this->enableTurnstile();
        $this->registerProbeRoutes();
        Http::fake([
            'https://challenges.cloudflare.com/turnstile/v0/siteverify' => Http::response([
                'success' => true,
            ]),
        ]);

        $this->postJson('/_turnstile-probe/advisory', [
            'cf-turnstile-response' => 'valid-test-token',
        ])->assertOk();

        Http::assertSent(fn ($request) => $request['secret'] === 'test-secret-key'
            && $request['response'] === 'valid-test-token');
    }

    public function test_admin_staff_login_is_wired_as_advisory_and_customer_forms_stay_enforced(): void
    {
        $this->assertContains(
            VerifyTurnstile::class . ':advisory',
            $this->postRouteMiddleware('api/login'),
            'The admin/staff login must keep Turnstile advisory so a failed challenge cannot lock staff out.',
        );

        foreach (['api/customer/login', 'api/register', 'api/appointments'] as $uri) {
            $middleware = $this->postRouteMiddleware($uri);

            $this->assertContains(VerifyTurnstile::class, $middleware, "[{$uri}] lost its Turnstile guard.");
            $this->assertNotContains(
                VerifyTurnstile::class . ':advisory',
                $middleware,
                "[{$uri}] must stay enforced.",
            );
        }
    }
}
