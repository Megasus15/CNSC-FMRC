<?php

namespace Tests\Feature;

use App\Models\MaintenanceSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MaintenanceScopeSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_scopes_are_seeded_off_and_exposed_in_public_snapshot(): void
    {
        foreach (['site_portal', 'page_about'] as $scope) {
            $this->assertDatabaseHas('maintenance_settings', [
                'scope' => $scope,
                'is_active' => false,
            ]);
            $this->assertFalse(MaintenanceSetting::isActive($scope));
        }

        $this->getJson('/api/maintenance')->assertOk()
            ->assertJsonPath('data.site_portal.active', false)
            ->assertJsonPath('data.site_portal.message', MaintenanceSetting::DEFAULTS['site_portal'])
            ->assertJsonPath('data.page_about.active', false)
            ->assertJsonPath('data.page_about.message', MaintenanceSetting::DEFAULTS['page_about']);
    }

    public function test_admin_can_switch_each_new_scope_independently_and_restore_defaults(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $this->putJson('/api/admin/maintenance', [
            'scopes' => [
                'page_about' => ['is_active' => true, 'message' => 'About page update.'],
            ],
        ])->assertOk()
            ->assertJsonPath('data.page_about.active', true)
            ->assertJsonPath('data.page_about.message', 'About page update.')
            ->assertJsonPath('data.home_about.active', false)
            ->assertJsonPath('data.page_home.active', false)
            ->assertJsonPath('data.site_portal.active', false);

        $this->putJson('/api/admin/maintenance', [
            'scopes' => [
                'site_portal' => ['is_active' => true, 'message' => 'Site upgrade.'],
            ],
        ])->assertOk()
            ->assertJsonPath('data.site_portal.active', true)
            ->assertJsonPath('data.page_about.active', true);

        $this->putJson('/api/admin/maintenance', [
            'scopes' => [
                'site_portal' => ['is_active' => false, 'message' => null],
            ],
        ])->assertOk()
            ->assertJsonPath('data.site_portal.active', false)
            ->assertJsonPath('data.site_portal.message', MaintenanceSetting::DEFAULTS['site_portal'])
            ->assertJsonPath('data.page_about.active', true);

        $this->assertNull(MaintenanceSetting::where('scope', 'site_portal')->firstOrFail()->message);
    }

    public function test_additive_migration_keeps_existing_admin_choices(): void
    {
        MaintenanceSetting::where('scope', 'site_portal')->update([
            'is_active' => true,
            'message' => 'The site is being upgraded.',
        ]);

        $migration = require database_path('migrations/2027_01_03_000000_add_customer_website_maintenance_scopes.php');
        $migration->up();

        $this->assertDatabaseHas('maintenance_settings', [
            'scope' => 'site_portal',
            'is_active' => true,
            'message' => 'The site is being upgraded.',
        ]);
        $this->assertSame(1, MaintenanceSetting::where('scope', 'site_portal')->count());
    }

    public function test_new_scopes_keep_admin_only_validation_and_do_not_partially_save(): void
    {
        $payload = ['scopes' => ['site_portal' => ['is_active' => true, 'message' => 'Offline.']]];

        $this->putJson('/api/admin/maintenance', $payload)->assertUnauthorized();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->putJson('/api/admin/maintenance', $payload)->assertForbidden();
        $this->assertFalse(MaintenanceSetting::isActive('site_portal'));

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->putJson('/api/admin/maintenance', [
            'scopes' => [
                'site_portal' => ['is_active' => true, 'message' => 'Offline.'],
                'page_about' => ['is_active' => true, 'message' => str_repeat('x', 76)],
            ],
        ])->assertUnprocessable();

        $this->assertFalse(MaintenanceSetting::isActive('site_portal'));
        $this->assertFalse(MaintenanceSetting::isActive('page_about'));
    }
}
