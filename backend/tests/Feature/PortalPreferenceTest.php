<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PortalPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_each_admin_and_staff_account_owns_independent_persistent_preferences(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $otherStaff = User::factory()->create(['role' => 'staff']);

        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true])
            ->assertOk()->assertJsonPath('user_id', $admin->id);
        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme', 'system');
        $this->putJson('/api/admin/preferences', ['theme' => 'light', 'compact' => false, 'reducedMotion' => false])->assertOk();
        Sanctum::actingAs($otherStaff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme', 'system');
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true]);
        $this->assertDatabaseCount('user_portal_preferences', 2);
    }

    public function test_invalid_preferences_and_attempts_to_target_another_user_do_not_write(): void
    {
        $user = User::factory()->create(['role' => 'staff']);
        Sanctum::actingAs($user);
        $this->putJson('/api/admin/preferences', ['theme' => 'sepia', 'compact' => false, 'reducedMotion' => false])->assertUnprocessable();
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => 'maybe', 'reducedMotion' => false])->assertUnprocessable();
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => false, 'reducedMotion' => false, 'user_id' => $user->id + 1])->assertUnprocessable();
        $this->assertDatabaseCount('user_portal_preferences', 0);
    }

    public function test_customers_and_guests_cannot_use_portal_preferences(): void
    {
        $this->getJson('/api/admin/preferences')->assertUnauthorized();
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->getJson('/api/admin/preferences')->assertForbidden();
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => false, 'reducedMotion' => false])->assertForbidden();
    }

    public function test_restoring_defaults_updates_one_row_and_other_accounts_keep_their_theme(): void
    {
        $user = User::factory()->create(['role' => 'staff']);
        Sanctum::actingAs($user);
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true])->assertOk();
        $this->putJson('/api/admin/preferences', ['theme' => 'system', 'compact' => false, 'reducedMotion' => false])->assertOk();
        $this->assertDatabaseCount('user_portal_preferences', 1);
        $this->assertDatabaseHas('user_portal_preferences', ['user_id' => $user->id, 'theme' => 'system', 'compact' => false]);
    }
}
