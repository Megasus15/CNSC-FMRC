<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class RevokePortalSessionsTest extends TestCase
{
    use RefreshDatabase;

    public function test_preview_does_not_revoke_and_force_only_revokes_admin_and_staff(): void
    {
        foreach (['admin', 'staff', 'customer'] as $role) {
            User::factory()->create(['role' => $role])->createToken('auth_token');
        }

        $this->artisan('admin:revoke-sessions')
            ->expectsOutput('2 Admin/Staff session(s) would be revoked. Run with --force during the release to apply.')
            ->assertExitCode(0);
        $this->assertSame(3, PersonalAccessToken::count());

        $this->artisan('admin:revoke-sessions', ['--force' => true])
            ->expectsOutput('2 Admin/Staff session(s) revoked. Customer sessions were not changed.')
            ->assertExitCode(0);
        $this->assertSame(1, PersonalAccessToken::count());
        $this->assertSame('customer', PersonalAccessToken::first()->tokenable->role);

        $this->artisan('admin:revoke-sessions', ['--force' => true])
            ->expectsOutput('0 Admin/Staff session(s) revoked. Customer sessions were not changed.')
            ->assertExitCode(0);
        $this->assertSame(1, PersonalAccessToken::count());
    }
}
