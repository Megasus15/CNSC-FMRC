<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PortalPreferenceTest extends TestCase
{
    use RefreshDatabase;

    private const WORKSPACE_DEFAULTS = ['sidebarWidth' => 270, 'sidebarLabel' => 'UCN-FMRC', 'sidebarLogo' => ''];
    private const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAMElEQVR4nO3OIQEAAAgDMJIQgnRvDzEwE/Or9OynEhAQEBAQEBAQEBAQEBAQyHPgANnfHGqNHPv7AAAAAElFTkSuQmCC';

    public function test_each_admin_and_staff_account_owns_independent_persistent_preferences(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $otherStaff = User::factory()->create(['role' => 'staff']);

        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true])
            ->assertOk()->assertJsonPath('user_id', $admin->id);
        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme', 'light');
        $this->putJson('/api/admin/preferences', ['theme' => 'light', 'compact' => false, 'reducedMotion' => false])->assertOk();
        Sanctum::actingAs($otherStaff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme', 'light');
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true, ...self::WORKSPACE_DEFAULTS]);
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
        $this->putJson('/api/admin/preferences', ['theme' => 'light', 'compact' => false, 'reducedMotion' => false])->assertOk();
        $this->assertDatabaseCount('user_portal_preferences', 1);
        $this->assertDatabaseHas('user_portal_preferences', ['user_id' => $user->id, 'theme' => 'light', 'compact' => false]);
    }

    public function test_missing_deployment_table_reports_unavailable_without_changing_accounts(): void
    {
        $user = User::factory()->create(['role' => 'staff']);
        Sanctum::actingAs($user);
        Schema::dropIfExists('user_portal_preferences');

        $this->getJson('/api/admin/preferences')->assertStatus(503);
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => false])->assertStatus(503);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'role' => 'staff']);
    }

    public function test_installing_the_table_restores_account_sync_and_later_migrations_preserve_preferences(): void
    {
        $user = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($user);
        Schema::dropIfExists('user_portal_preferences');
        $this->getJson('/api/admin/preferences')->assertStatus(503);

        $migration = require database_path('migrations/2026_10_04_000001_create_user_portal_preferences_table.php');
        $migration->up();
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true])->assertOk();

        // Simulate Artisan registration after the phpMyAdmin installation.
        $migration->up();
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences', ['theme' => 'dark', 'compact' => true, 'reducedMotion' => true, ...self::WORKSPACE_DEFAULTS]);
        $this->assertDatabaseCount('user_portal_preferences', 1);
    }

    public function test_workspace_preferences_belong_to_one_account_and_older_clients_preserve_them(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $appearance = ['theme' => 'dark', 'compact' => false, 'reducedMotion' => false];
        $workspace = ['sidebarWidth' => 220, 'sidebarLabel' => 'Fabrication Lab', 'sidebarLogo' => self::LOGO];
        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/preferences', [...$appearance, ...$workspace])->assertOk()->assertJsonPath('preferences', [...$appearance, ...$workspace]);
        // Cached appearance-only clients must not erase the saved workspace.
        $this->putJson('/api/admin/preferences', [...$appearance, 'theme' => 'light'])->assertOk()->assertJsonPath('preferences.sidebarLogo', self::LOGO);
        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.sidebarWidth', 270)->assertJsonPath('preferences.sidebarLogo', '');
        $this->putJson('/api/admin/preferences', [...$appearance, 'sidebarWidth' => 76, 'sidebarLabel' => 'Staff workspace'])->assertOk();
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.sidebarWidth', 220)->assertJsonPath('preferences.sidebarLabel', 'Fabrication Lab');
        $this->putJson('/api/admin/preferences', [...$appearance, ...self::WORKSPACE_DEFAULTS])->assertOk()->assertJsonPath('preferences.sidebarLogo', '');
        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.sidebarWidth', 76)->assertJsonPath('preferences.sidebarLabel', 'Staff workspace');
        $this->assertDatabaseCount('user_portal_preferences', 2);
    }

    public function test_workspace_validation_protects_layout_and_rejects_unsafe_logos(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $appearance = ['theme' => 'dark', 'compact' => false, 'reducedMotion' => false];
        foreach ([['sidebarWidth' => 75], ['sidebarWidth' => 271], ['sidebarWidth' => 180.5], ['sidebarLabel' => str_repeat('W', 19)], ['sidebarLabel' => '   '], ['sidebarLabel' => "Bad\x01label"], ['sidebarLogo' => 'https://example.test/logo.png'], ['sidebarLogo' => 'data:image/svg+xml;base64,PHN2Zy8+'], ['sidebarLogo' => 'data:image/png;base64,bm90IGFuIGltYWdl']] as $invalid) {
            $this->putJson('/api/admin/preferences', [...$appearance, ...$invalid])->assertUnprocessable();
        }
        $this->assertDatabaseCount('user_portal_preferences', 0);
    }

    public function test_workspace_upgrade_preserves_appearance_and_can_run_after_manual_install(): void
    {
        $user = User::factory()->create(['role' => 'staff']);
        Sanctum::actingAs($user);
        $upgrade = require database_path('migrations/2026_10_04_000002_add_workspace_to_portal_preferences_table.php');
        $upgrade->down();
        $appearance = ['theme' => 'dark', 'compact' => true, 'reducedMotion' => false];
        $this->putJson('/api/admin/preferences', $appearance)->assertOk();
        $this->putJson('/api/admin/preferences', [...$appearance, 'sidebarWidth' => 76])->assertStatus(503);
        $upgrade->up();
        $upgrade->up();
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences', [...$appearance, ...self::WORKSPACE_DEFAULTS]);
        $this->putJson('/api/admin/preferences', [...$appearance, 'sidebarWidth' => 76])->assertOk()->assertJsonPath('preferences.sidebarWidth', 76);
        $this->assertDatabaseCount('user_portal_preferences', 1);
    }

    public function test_light_schema_fallback_preserves_saved_dark_and_device_choices(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $newStaff = User::factory()->create(['role' => 'staff']);
        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/preferences', ['theme' => 'dark', 'compact' => false, 'reducedMotion' => false])->assertOk();
        Sanctum::actingAs($staff);
        $this->putJson('/api/admin/preferences', ['theme' => 'system', 'compact' => false, 'reducedMotion' => false])->assertOk();
        $migration = require database_path('migrations/2026_10_04_000003_use_light_portal_appearance.php');
        $migration->down();
        $migration->up();
        $migration->up();
        DB::table('user_portal_preferences')->insert(['user_id' => $newStaff->id]);
        $this->assertDatabaseHas('user_portal_preferences', ['user_id' => $newStaff->id, 'theme' => 'light']);
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme', 'dark');
        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme', 'system');
    }
}
