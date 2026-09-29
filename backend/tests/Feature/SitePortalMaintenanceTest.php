<?php

namespace Tests\Feature;

use App\Models\MaintenanceSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SitePortalMaintenanceTest extends TestCase
{
    use RefreshDatabase;

    private function enableSitePortal(): void
    {
        MaintenanceSetting::updateOrCreate(
            ['scope' => 'site_portal'],
            ['is_active' => true, 'message' => 'The customer website is being serviced.'],
        );
    }

    public function test_site_wide_maintenance_blocks_customer_sign_in_but_keeps_admin_sign_in_available(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $admin = User::factory()->create(['role' => 'admin']);
        $this->enableSitePortal();

        $this->postJson('/api/customer/login', [
            'login' => $customer->email,
            'password' => 'password',
        ])->assertStatus(503)
            ->assertJsonPath('maintenance', true)
            ->assertJsonPath('scope', 'site_portal');

        $this->postJson('/api/login', [
            'login' => $admin->email,
            'password' => 'password',
        ])->assertOk();
    }

    public function test_guest_customer_submissions_are_blocked_but_maintenance_snapshot_remains_readable(): void
    {
        $this->enableSitePortal();

        $this->getJson('/api/maintenance')->assertOk()
            ->assertJsonPath('data.site_portal.active', true);
        $this->postJson('/api/appointments', [])->assertStatus(503)
            ->assertJsonPath('scope', 'site_portal');
        $this->postJson('/api/register', [])->assertStatus(503)
            ->assertJsonPath('scope', 'site_portal');
    }

    public function test_existing_customer_actions_are_blocked_but_admin_can_restore_the_site(): void
    {
        $this->enableSitePortal();
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));

        $this->getJson('/api/customer/cart')->assertStatus(503)
            ->assertJsonPath('scope', 'site_portal');
        $this->postJson('/api/orders', [])->assertStatus(503)
            ->assertJsonPath('scope', 'site_portal');

        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->getJson('/api/user')->assertOk();

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->putJson('/api/admin/maintenance', [
            'scopes' => ['site_portal' => ['is_active' => false, 'message' => '']],
        ])->assertOk()->assertJsonPath('data.site_portal.active', false);
    }

    public function test_about_page_and_home_about_section_remain_independent(): void
    {
        MaintenanceSetting::updateOrCreate(
            ['scope' => 'page_about'],
            ['is_active' => true, 'message' => 'The About Us page is being updated.'],
        );

        $this->getJson('/api/maintenance')->assertOk()
            ->assertJsonPath('data.page_about.active', true)
            ->assertJsonPath('data.home_about.active', false)
            ->assertJsonPath('data.site_portal.active', false);
    }
}
