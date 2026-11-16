<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AdminSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class OperatorSessionPolicyTest extends TestCase
{
    use RefreshDatabase;

    private function operator(string $role = 'admin'): array
    {
        $user = User::factory()->create(['role' => $role, 'password' => Hash::make('Test-password-123')]);
        $issued = $user->createToken('auth_token', ['*'], now()->addHours(6));
        $this->app['auth']->forgetGuards();
        $this->withToken($issued->plainTextToken);

        return [$user, $issued->accessToken];
    }

    public function test_preferences_are_personal_and_do_not_change_existing_tokens(): void
    {
        [$admin, $token] = $this->operator();
        $deadline = $token->expires_at->toIso8601String();
        $this->putJson('/api/admin/session/preferences', ['enabled' => true, 'max_hours' => 12])->assertOk()->assertJsonPath('effective_on', 'next_login');
        $this->getJson('/api/admin/session')->assertOk()->assertJsonPath('absolute_expires_at', $deadline);
        [$staff] = $this->operator('staff');
        $this->getJson('/api/admin/session/preferences')->assertOk()->assertJsonPath('preferences.max_hours', 6);
        $this->putJson('/api/admin/session/preferences', ['enabled' => false, 'max_hours' => 12])->assertOk();
        $this->assertSame(['enabled' => true, 'max_hours' => 12], json_decode(DB::table('user_portal_preferences')->where('user_id', $admin->id)->value('session_policy'), true));
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => false, 'reducedMotion' => false])->assertOk();
        $this->getJson('/api/admin/session/preferences')->assertOk()->assertJsonPath('preferences.enabled', false);
        $this->putJson('/api/admin/session/preferences', ['enabled' => true, 'max_hours' => 2])->assertUnprocessable();
        $this->putJson('/api/admin/session/preferences', ['enabled' => true, 'max_hours' => 6, 'user_id' => $admin->id])->assertUnprocessable();
        $this->putJson('/api/admin/session/preferences', ['enabled' => true, 'max_hours' => 6, 'idle_minutes' => 0])->assertUnprocessable();
    }

    public function test_new_tokens_snapshot_the_saved_policy_and_off_keeps_inactivity_enforcement(): void
    {
        foreach ([6, 12, 0] as $hours) {
            [$user] = $this->operator('staff');
            $this->putJson('/api/admin/session/preferences', ['enabled' => $hours !== 0, 'max_hours' => $hours ?: 12])->assertOk();
            $response = $this->postJson('/api/login', ['login' => $user->email, 'password' => 'Test-password-123'])->assertOk();
            $plain = $response->json('access_token');
            $this->assertIsString($plain);
            $token = PersonalAccessToken::findToken($plain);
            $this->assertSame($hours, (int) $token->operator_session_max_hours);
            $start = now()->copy();
            $this->travel(7)->hours();
            $token->forceFill(['last_interaction_at' => now()])->save();
            $this->assertSame($hours === 6 ? 'SESSION_EXPIRED' : null, AdminSession::expirationCode($token));
            if ($hours === 12) {
                $this->travel(5)->hours();
                $token->forceFill(['last_interaction_at' => now()])->save();
                $this->assertSame('SESSION_EXPIRED', AdminSession::expirationCode($token));
            }
            if ($hours === 0) {
                $this->assertNull(AdminSession::status($token)['absolute_expires_at']);
                $this->travel(63)->minutes();
                $this->assertSame('SESSION_IDLE', AdminSession::expirationCode($token));
            }
            $this->travelTo($start);
        }
    }

    public function test_legacy_and_explicit_shorter_deadlines_remain_authoritative(): void
    {
        [, $token] = $this->operator();
        $token->forceFill(['operator_session_max_hours' => 12, 'expires_at' => now()->addHour()])->save();
        $this->travel(61)->minutes();
        $token->forceFill(['last_interaction_at' => now()])->save();
        $this->assertSame('SESSION_EXPIRED', AdminSession::expirationCode($token));
        $this->getJson('/api/admin/session/preferences')->assertUnauthorized();
    }

    public function test_customer_cannot_change_policy_and_missing_storage_fails_closed(): void
    {
        $this->operator('customer');
        $this->getJson('/api/admin/session/preferences')->assertForbidden();
        $this->putJson('/api/admin/session/preferences', ['enabled' => false, 'max_hours' => 12])->assertForbidden();
        $this->operator();
        Schema::table('user_portal_preferences', fn ($table) => $table->dropColumn('session_policy'));
        $this->getJson('/api/admin/session/preferences')->assertStatus(503);
        $this->getJson('/api/admin/session')->assertOk()->assertJsonPath('absolute_limit_enabled', true);
        [$user] = $this->operator();
        $login = $this->postJson('/api/login', ['login' => $user->email, 'password' => 'Test-password-123'])->assertOk();
        $issued = PersonalAccessToken::findToken($login->json('access_token'));
        $this->assertNull($issued->operator_session_max_hours);
        $this->assertNotNull($issued->expires_at);
        $this->assertSame($issued->created_at->copy()->addHours(6)->toIso8601String(), $issued->expires_at->toIso8601String());
    }
}
