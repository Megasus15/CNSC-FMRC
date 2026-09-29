<?php

namespace Tests\Feature;

use App\Models\MaintenancePageSetting;
use App\Models\MaintenanceSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MaintenancePageSettingsTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=';

    private function payload(array $page = []): array
    {
        return [
            'scopes' => ['site_portal' => ['is_active' => true, 'message' => 'Scheduled improvements are in progress.']],
            'site_page' => $page,
        ];
    }

    public function test_public_defaults_and_custom_copy_are_exposed_without_upload_data(): void
    {
        $before = $this->getJson('/api/maintenance')->assertOk()
            ->assertJsonPath('site_page_installed', true)
            ->assertJsonPath('site_page', MaintenancePageSetting::DEFAULTS);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $page = [
            'eyebrow' => 'Scheduled improvements',
            'headline' => 'We are making room',
            'headline_accent' => 'for better ideas.',
            'supporting_line' => 'Thank you for checking back later.',
            'image_alt' => 'Website improvements illustration',
            'theme' => 'soft_gold',
        ];
        $this->putJson('/api/admin/maintenance', $this->payload($page))->assertOk()
            ->assertJsonPath('site_page.theme', 'soft_gold')
            ->assertJsonPath('site_page.headline', 'We are making room')
            ->assertJsonPath('site_page.image_url', '');

        $after = $this->getJson('/api/maintenance')->assertOk()->assertJsonPath('site_page', array_replace(MaintenancePageSetting::DEFAULTS, $page));
        $this->assertNotSame($before->headers->get('ETag'), $after->headers->get('ETag'));
        $this->assertArrayNotHasKey('image_data', $after->json('site_page'));
    }

    public function test_illustration_is_stored_as_a_public_file_and_can_be_reset(): void
    {
        Storage::fake('public');
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $response = $this->putJson('/api/admin/maintenance', $this->payload([
            'image_data' => 'data:image/png;base64,'.self::PNG,
        ]))->assertOk();

        $url = $response->json('site_page.image_url');
        $this->assertMatchesRegularExpression('~^/storage/maintenance/site-page-[a-f0-9]{24}\.png$~', $url);
        Storage::disk('public')->assertExists(substr($url, strlen('/storage/')));
        $this->assertSame(base64_decode(self::PNG), Storage::disk('public')->get(substr($url, strlen('/storage/'))));

        // Changing text without an image key retains the published illustration.
        $this->putJson('/api/admin/maintenance', $this->payload(['headline' => 'A quick update']))->assertOk()
            ->assertJsonPath('site_page.image_url', $url);
        $this->getJson('/api/maintenance')->assertOk()->assertJsonPath('site_page.image_url', $url);

        $this->putJson('/api/admin/maintenance', $this->payload(['image_data' => null]))->assertOk()
            ->assertJsonPath('site_page.image_url', '');
        $this->assertNull(MaintenancePageSetting::firstOrFail()->image_path);
    }

    public function test_invalid_images_and_layout_copy_are_rejected_before_any_scope_changes(): void
    {
        Storage::fake('public');
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        foreach ([
            ['image_data' => 'data:image/svg+xml;base64,'.base64_encode('<svg onload="alert(1)"/>')],
            ['image_data' => 'data:image/jpeg;base64,'.self::PNG],
            ['image_data' => 'data:image/png;base64,'.base64_encode(str_repeat('x', 1024 * 1024 + 1))],
            ['theme' => 'unapproved_color'],
            ['headline' => str_repeat('x', 61)],
            ['image_url' => 'https://example.com/tracker.png'],
        ] as $page) {
            $this->putJson('/api/admin/maintenance', $this->payload($page))->assertUnprocessable();
            $this->assertFalse(MaintenanceSetting::isActive('site_portal'));
        }
        $this->assertSame([], Storage::disk('public')->allFiles());
        $this->assertDatabaseCount('maintenance_page_settings', 0);
    }

    public function test_only_the_site_wide_message_can_use_the_longer_limit(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $message = str_repeat('x', 200);
        $payload = $this->payload(['headline' => 'Scheduled update']);
        $payload['scopes']['site_portal']['message'] = $message;
        $this->putJson('/api/admin/maintenance', $payload)->assertOk()
            ->assertJsonPath('data.site_portal.message', $message);

        $payload['scopes']['site_portal']['message'] = str_repeat('x', 201);
        $this->putJson('/api/admin/maintenance', $payload)->assertUnprocessable();
        $payload['scopes']['site_portal']['message'] = 'Valid paragraph.';
        $payload['scopes']['page_about'] = ['is_active' => true, 'message' => str_repeat('x', 76)];
        $this->putJson('/api/admin/maintenance', $payload)->assertUnprocessable();
        $this->assertFalse(MaintenanceSetting::isActive('page_about'));
    }

    public function test_customer_and_staff_cannot_publish_screen_customizations(): void
    {
        $payload = $this->payload(['headline' => 'Unavailable']);
        $this->putJson('/api/admin/maintenance', $payload)->assertUnauthorized();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->putJson('/api/admin/maintenance', $payload)->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->putJson('/api/admin/maintenance', $payload)->assertForbidden();
        $this->assertDatabaseCount('maintenance_page_settings', 0);
        $this->assertFalse(MaintenanceSetting::isActive('site_portal'));
    }

    public function test_missing_presentation_migration_falls_back_without_losing_availability_controls(): void
    {
        Schema::drop('maintenance_page_settings');
        $this->getJson('/api/maintenance')->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('site_page_installed', false)
            ->assertJsonPath('site_page', MaintenancePageSetting::DEFAULTS);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $payload = $this->payload(['headline' => 'Offline']);
        $this->putJson('/api/admin/maintenance', $payload)->assertStatus(503);
        $this->assertFalse(MaintenanceSetting::isActive('site_portal'));
        unset($payload['site_page']);
        $this->putJson('/api/admin/maintenance', $payload)->assertOk()
            ->assertJsonPath('data.site_portal.active', true);
    }

    public function test_additive_migration_preserves_existing_copy_when_run_again(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->putJson('/api/admin/maintenance', $this->payload(['headline' => 'Our saved heading']))->assertOk();
        $migration = require database_path('migrations/2027_01_04_000000_create_maintenance_page_settings_table.php');
        $migration->up();
        $this->getJson('/api/maintenance')->assertOk()
            ->assertJsonPath('site_page.headline', 'Our saved heading')
            ->assertJsonPath('data.site_portal.active', true);
    }
}
