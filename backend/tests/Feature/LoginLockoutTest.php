<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class LoginLockoutTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'username' => 'portal_member',
            'email' => 'portal.member@gmail.com',
            'role' => 'customer',
        ]);
    }

    private function attempt(string $route, string $identifier, string $password = 'incorrect'): \Illuminate\Testing\TestResponse
    {
        return $this->postJson($route, [
            'login' => $identifier,
            'password' => $password,
        ]);
    }

    public function test_ten_failures_across_both_aliases_and_portals_lock_the_account_for_five_minutes(): void
    {
        $this->travelTo(Carbon::parse('2026-09-25 02:00:00 UTC'));
        $user = $this->user();

        for ($number = 1; $number <= 9; $number++) {
            $route = $number % 2 ? '/api/login' : '/api/customer/login';
            $alias = $number % 2 ? $user->username : $user->email;
            $this->withServerVariables(['REMOTE_ADDR' => $number % 2 ? '192.0.2.30' : '192.0.2.31']);
            $this->attempt($route, $alias)->assertUnauthorized()
                ->assertJsonPath('message', 'Invalid login credentials');
        }

        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.31']);
        $locked = $this->attempt('/api/customer/login', $user->email)->assertStatus(429)
            ->assertJsonPath('code', 'LOGIN_LOCKED')
            ->assertJsonPath('locked', true)
            ->assertJsonPath('retry_after', 300);
        $ticket = $locked->json('ticket');
        $this->assertIsString($ticket);
        $this->assertSame('300', $locked->headers->get('Retry-After'));

        $this->postJson('/api/login-lockout/status', ['ticket' => $ticket])
            ->assertOk()
            ->assertJsonPath('locked', true)
            ->assertJsonPath('retry_after', 300);
        $this->postJson('/api/login-lockout/status', ['ticket' => str_repeat('x', 64)])
            ->assertOk()->assertJsonPath('locked', false);

        // The right password, a different route, and a fresh browser/IP cannot
        // bypass the account state, nor does a blocked request add a failure.
        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.32'])
            ->attempt('/api/login', $user->username, 'password')
            ->assertStatus(429)
            ->assertJsonPath('ticket', $ticket);
        $this->assertDatabaseHas('login_failure_states', [
            'user_id' => $user->id,
            'failed_attempts' => 10,
        ]);

        $this->travelTo(Carbon::parse($locked->json('locked_until'))->subSecond());
        $this->attempt('/api/login', $user->username, 'password')->assertStatus(429);
        $this->travelTo(Carbon::parse($locked->json('locked_until')));
        $this->attempt('/api/customer/login', $user->email, 'password')->assertOk();
        $this->assertDatabaseHas('login_failure_states', [
            'user_id' => $user->id,
            'failed_attempts' => 0,
            'lockout_count' => 0,
            'locked_until' => null,
        ]);
        $this->postJson('/api/login-lockout/status', ['ticket' => $ticket])
            ->assertOk()->assertJsonPath('locked', false);
    }

    public function test_ten_breaks_cap_at_twenty_five_minutes_and_the_next_group_locks_for_a_day(): void
    {
        $this->travelTo(Carbon::parse('2026-09-25 02:00:00 UTC'));
        $user = $this->user();

        for ($group = 1; $group <= 11; $group++) {
            for ($attempt = 1; $attempt <= 9; $attempt++) {
                $this->attempt('/api/login', $user->username)->assertUnauthorized();
            }

            $locked = $this->attempt('/api/login', $user->username)
                ->assertStatus(429)->assertJsonPath('code', 'LOGIN_LOCKED');
            $expectedSeconds = $group === 11 ? 86400 : min($group * 5, 25) * 60;
            $locked->assertJsonPath('retry_after', $expectedSeconds);
            $this->assertDatabaseHas('login_failure_states', [
                'user_id' => $user->id,
                'failed_attempts' => $group * 10,
                'lockout_count' => $group,
            ]);

            if ($group < 11) {
                $this->travelTo(Carbon::parse($locked->json('locked_until'))->addSecond());
            }
        }

        $this->attempt('/api/customer/login', $user->email, 'password')
            ->assertStatus(429)->assertJsonPath('retry_after', 86400);
        $this->travelTo(Carbon::parse($locked->json('locked_until')));
        $this->attempt('/api/login', $user->username)->assertUnauthorized();
        $this->assertDatabaseHas('login_failure_states', [
            'user_id' => $user->id,
            'failed_attempts' => 1,
            'lockout_count' => 0,
        ]);
    }

    public function test_unknown_names_are_scoped_to_identifier_and_ip_and_expire_after_inactivity(): void
    {
        $this->travelTo(Carbon::parse('2026-09-25 02:00:00 UTC'));

        for ($attempt = 1; $attempt <= 9; $attempt++) {
            $this->attempt('/api/login', 'missing-person')->assertUnauthorized();
        }
        $this->attempt('/api/login', 'missing-person')->assertStatus(429)
            ->assertJsonPath('code', 'LOGIN_LOCKED');

        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.32'])
            ->attempt('/api/customer/login', 'missing-person')->assertUnauthorized();
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1']);
        $this->travel(61)->minutes();
        $this->attempt('/api/login', 'missing-person')->assertUnauthorized();

        $this->assertDatabaseHas('login_failure_states', ['user_id' => null, 'failed_attempts' => 1]);
    }

    public function test_verified_google_sign_in_cannot_bypass_lockout_and_then_clears_the_streak(): void
    {
        $this->travelTo(Carbon::parse('2026-09-25 02:00:00 UTC'));
        $user = $this->user();
        Http::fake([
            'https://www.googleapis.com/oauth2/v3/userinfo' => Http::response([
                'email' => $user->email,
                'email_verified' => true,
                'name' => 'Portal Member',
                'given_name' => 'Portal',
            ]),
        ]);

        for ($attempt = 1; $attempt <= 9; $attempt++) {
            $this->attempt('/api/customer/login', $user->email)->assertUnauthorized();
        }
        $locked = $this->attempt('/api/login', $user->username)->assertStatus(429);

        $this->postJson('/api/auth/google', ['access_token' => 'verified-google-token'])
            ->assertStatus(429)->assertJsonPath('code', 'LOGIN_LOCKED');
        $this->travelTo(Carbon::parse($locked->json('locked_until')));
        $this->postJson('/api/auth/google', ['access_token' => 'verified-google-token'])
            ->assertOk()->assertJsonPath('user.id', $user->id);
        $this->assertDatabaseHas('login_failure_states', [
            'user_id' => $user->id,
            'failed_attempts' => 0,
            'lockout_count' => 0,
            'locked_until' => null,
        ]);
    }

    public function test_invalid_turnstile_is_not_counted_as_a_bad_password(): void
    {
        $this->user();
        Config::set('services.turnstile.enabled', true);
        Config::set('services.turnstile.site_key', 'test-site-key');
        Config::set('services.turnstile.secret_key', 'test-secret-key');
        Http::fake([
            'https://challenges.cloudflare.com/turnstile/v0/siteverify' => Http::response(['success' => false]),
        ]);

        $this->postJson('/api/login', [
            'login' => 'portal_member',
            'password' => 'incorrect',
            'cf-turnstile-response' => 'invalid-challenge',
        ])->assertUnprocessable();

        $this->assertDatabaseCount('login_failure_states', 0);
    }

    public function test_coarse_ip_limit_stops_identifier_spraying(): void
    {
        for ($attempt = 1; $attempt <= 120; $attempt++) {
            $this->attempt('/api/login', 'missing-'.$attempt)->assertUnauthorized();
        }

        $this->attempt('/api/customer/login', 'new-identifier')->assertStatus(429)
            ->assertJsonPath('code', 'LOGIN_RATE_LIMITED')
            ->assertJsonMissingPath('ticket');
    }

    public function test_public_ticket_status_lookup_has_its_own_ip_limit(): void
    {
        for ($attempt = 1; $attempt <= 120; $attempt++) {
            $this->postJson('/api/login-lockout/status', ['ticket' => str_repeat('x', 64)])
                ->assertOk()->assertJsonPath('locked', false);
        }

        $this->postJson('/api/login-lockout/status', ['ticket' => str_repeat('x', 64)])
            ->assertStatus(429)
            ->assertJsonPath('code', 'LOGIN_STATUS_RATE_LIMITED')
            ->assertJsonMissingPath('ticket');

        // A status probe never consumes the actual sign-in IP budget.
        $this->attempt('/api/login', 'some-unknown-account')->assertUnauthorized();
    }

    public function test_ticket_status_stays_public_with_an_old_admin_web_cookie(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'admin']), 'web');

        $this->postJson('/api/login-lockout/status', ['ticket' => str_repeat('x', 64)])
            ->assertOk()
            ->assertJsonPath('locked', false);
    }
}
