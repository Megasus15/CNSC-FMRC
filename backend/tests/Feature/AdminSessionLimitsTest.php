<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class AdminSessionLimitsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
    }

    private function bearer(string $role = 'admin', bool $setExpiry = true): PersonalAccessToken
    {
        $user = User::factory()->create(['role' => $role]);
        $newToken = $user->createToken(
            'auth_token',
            ['*'],
            $setExpiry ? now()->addHours(6) : null,
        );
        $this->app['auth']->forgetGuards();
        $this->withToken($newToken->plainTextToken);

        return $newToken->accessToken;
    }

    public function test_admin_and_staff_receive_deadlines_without_polling_renewing_them(): void
    {
        foreach (['admin', 'staff'] as $role) {
            $this->bearer($role);
            $start = now()->copy();

            $this->getJson('/api/admin/session')->assertOk()
                ->assertJsonPath('idle_warning_at', $start->copy()->addHour()->utc()->toIso8601String())
                ->assertJsonPath('idle_expires_at', $start->copy()->addMinutes(63)->utc()->toIso8601String())
                ->assertJsonPath('absolute_expires_at', $start->copy()->addHours(6)->utc()->toIso8601String());

            $this->travelTo($start->copy()->addMinutes(60));
            $this->getJson('/api/admin/session')->assertOk()
                ->assertJsonPath('idle_warning_at', $start->copy()->addHour()->utc()->toIso8601String());
            $this->postJson('/api/admin/session/activity', ['interaction' => 'activity'])
                ->assertOk()
                ->assertJsonPath('idle_warning_at', $start->copy()->addHour()->utc()->toIso8601String());

            $this->travelTo($start->copy()->addMinutes(63));
            $this->getJson('/api/admin/session')->assertUnauthorized()
                ->assertJsonPath('code', 'SESSION_IDLE');
            $this->getJson('/api/user')->assertUnauthorized()
                ->assertJsonPath('code', 'SESSION_IDLE');

            $this->travelTo($start);
        }
    }

    public function test_only_stay_signed_in_renews_after_warning_and_expired_idle_cannot_revive(): void
    {
        $token = $this->bearer();
        $start = now()->copy();

        $this->travelTo($start->copy()->addMinutes(60));
        $this->postJson('/api/admin/session/activity', ['interaction' => 'stay_signed_in'])
            ->assertOk()
            ->assertJsonPath('idle_warning_at', $start->copy()->addMinutes(120)->utc()->toIso8601String());
        $this->assertNotNull($token->fresh()->last_interaction_at);

        $this->travelTo($start->copy()->addMinutes(123));
        $this->postJson('/api/admin/session/activity', ['interaction' => 'stay_signed_in'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_IDLE');
    }

    public function test_genuine_activity_before_the_warning_renews_only_idle_deadline(): void
    {
        $this->bearer('staff');
        $start = now()->copy();

        $this->travelTo($start->copy()->addMinutes(59));
        $this->postJson('/api/admin/session/activity', ['interaction' => 'activity'])
            ->assertOk()
            ->assertJsonPath('idle_warning_at', $start->copy()->addMinutes(119)->utc()->toIso8601String())
            ->assertJsonPath('absolute_expires_at', $start->copy()->addHours(6)->utc()->toIso8601String());

        $this->travelTo($start->copy()->addMinutes(63));
        $this->getJson('/api/user')->assertOk();
    }

    public function test_six_hour_limit_overrides_recent_activity_and_legacy_tokens(): void
    {
        foreach ([true, false] as $setExpiry) {
            $token = $this->bearer('admin', $setExpiry);
            $start = now()->copy();
            $token->forceFill(['last_interaction_at' => $start->copy()->addHours(5)->addMinutes(50)])->save();

            $this->travelTo($start->copy()->addHours(6));
            $this->getJson('/api/user')->assertUnauthorized()
                ->assertJsonPath('code', 'SESSION_EXPIRED');

            $this->travelTo($start);
        }
    }

    public function test_customer_tokens_are_unchanged_and_customer_cannot_use_admin_session_endpoint(): void
    {
        $this->bearer('customer', false);
        $start = now()->copy();
        $this->travelTo($start->copy()->addHours(7));

        $this->getJson('/api/user')->assertOk();
        $this->getJson('/api/admin/session')->assertForbidden();
    }

    public function test_admin_web_cookie_cannot_replace_a_portal_bearer_token(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin, 'web');

        $this->getJson('/api/user')->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_TOKEN_REQUIRED');
        $this->getJson('/api/appointments')->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_TOKEN_REQUIRED');
        $this->getJson('/api/security-config')->assertOk();
    }

    public function test_admin_web_cookie_cannot_override_a_different_valid_bearer(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $customer = User::factory()->create(['role' => 'customer']);
        $customerBearer = $customer->createToken('customer')->plainTextToken;

        $this->actingAs($admin, 'web')->withToken($customerBearer);
        $this->getJson('/api/user')->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_TOKEN_REQUIRED');
    }

    public function test_idle_limit_applies_to_legacy_public_api_routes_with_an_admin_bearer(): void
    {
        $this->bearer();
        $this->travel(63)->minutes();

        $this->getJson('/api/appointments')->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_IDLE');
    }
}
