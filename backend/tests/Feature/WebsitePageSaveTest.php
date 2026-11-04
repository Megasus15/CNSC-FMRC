<?php

namespace Tests\Feature;

use App\Models\HomeSdg;
use App\Models\Service;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class WebsitePageSaveTest extends TestCase
{
    use RefreshDatabase;

    public static function editors(): array
    {
        return [['admin'], ['staff']];
    }

    #[DataProvider('editors')]
    public function test_page_save_publishes_settings_and_collection_changes_together(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
        SiteSetting::set('hero_title', 'Original');
        SiteSetting::set('about_heading', 'Keep About');
        $service = Service::create(['title' => 'Original service', 'category' => 'Design', 'image_data' => 'original-artwork', 'modal_features' => ['Keep feature']]);
        $removed = HomeSdg::create(['title' => 'Remove badge', 'sort_order' => 0, 'is_visible' => true]);
        $retained = HomeSdg::create(['title' => 'Retain badge', 'sort_order' => 1, 'is_visible' => false]);
        $this->getJson('/api/site-settings')->assertJsonPath('data.hero_title', 'Original');
        $this->putJson('/api/admin/website-pages/home', [
            'settings' => ['hero_title' => 'Published', 'nav_logo_image' => 'new-logo'],
            'services' => ['upsert' => [['id' => $service->id, 'title' => 'Edited service']], 'delete' => []],
            'sdgs' => ['upsert' => [['id' => $retained->id, 'is_visible' => true, 'sort_order' => 0], ['title' => 'New badge', 'is_visible' => true, 'sort_order' => 1]], 'delete' => [$removed->id]],
        ])->assertOk();
        $this->getJson('/api/site-settings')->assertJsonPath('data.hero_title', 'Published')->assertJsonPath('data.about_heading', 'Keep About');
        $this->assertSame('Edited service', $service->fresh()->title);
        $this->assertSame('original-artwork', $service->fresh()->image_data);
        $this->assertSame(['Keep feature'], $service->fresh()->modal_features);
        $this->getJson('/api/site-sdgs')->assertJsonPath('data.0.id', $retained->id)->assertJsonPath('data.1.title', 'New badge')->assertJsonCount(2, 'data');
    }

    public function test_invalid_settings_or_records_never_partially_publish(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        SiteSetting::set('hero_title', 'Original');
        $service = Service::create(['title' => 'Original service', 'category' => 'Design']);
        $this->putJson('/api/admin/website-pages/home', [
            'settings' => ['hero_title' => 'Must not publish'],
            'services' => ['upsert' => [['id' => $service->id, 'title' => 'Must roll back']]],
            'sdgs' => ['delete' => [999]],
        ])->assertUnprocessable();
        $this->assertSame('Original', SiteSetting::get('hero_title'));
        $this->assertSame('Original service', $service->fresh()->title);
        $this->putJson('/api/admin/website-pages/home', ['settings' => ['hero_title' => 'Must not publish'], 'services' => ['upsert' => [['title' => str_repeat('x', 101), 'category' => 'Design']]]])->assertUnprocessable();
        $this->assertDatabaseCount('services', 1);
    }

    #[DataProvider('editors')]
    public function test_services_page_saves_copy_categories_and_services_without_replacing_other_content(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
        SiteSetting::set('hero_title', 'Keep Home');
        $this->putJson('/api/admin/website-pages/services', [
            'settings' => ['editorial_services_title' => 'Our services', 'editorial_services_categories' => '["Design"]'],
            'services' => ['upsert' => [['title' => 'New service', 'category' => 'Design', 'image_data' => null]]],
        ])->assertOk();
        $this->assertSame('Keep Home', SiteSetting::get('hero_title'));
        $this->getJson('/api/services')->assertJsonPath('data.0.title', 'New service');
        $this->putJson('/api/admin/website-pages/services', ['settings' => ['hero_title' => 'Wrong page']])->assertUnprocessable();
        $this->putJson('/api/admin/website-pages/home', ['settings' => ['portal_customer_brand_name' => 'Forbidden']])->assertUnprocessable();
        $this->putJson('/api/admin/website-pages/home', ['settings' => ['payment_gcash_enabled' => '0']])->assertUnprocessable();
    }

    public function test_customer_and_guest_cannot_publish_and_sdg_limit_is_atomic(): void
    {
        $this->putJson('/api/admin/website-pages/home', ['settings' => []])->assertUnauthorized();
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->putJson('/api/admin/website-pages/home', ['settings' => []])->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        for ($i = 0; $i < 8; $i++) {
            HomeSdg::create(['title' => 'Badge '.$i, 'sort_order' => $i]);
        }
        $this->putJson('/api/admin/website-pages/home', ['settings' => ['hero_title' => 'Must not publish'], 'sdgs' => ['upsert' => [['title' => 'Ninth badge']]]])->assertUnprocessable();
        $this->assertNull(SiteSetting::get('hero_title'));
        $this->assertDatabaseCount('home_sdgs', 8);
    }

    public function test_shared_controls_are_served_from_the_source_assets_on_normal_and_team_routes(): void
    {
        foreach (['/admin-page/admin-form-controls.css', '/apps/team/admin-page/admin-form-controls.css'] as $url) {
            $this->get($url)->assertOk()->assertHeader('Content-Type', 'text/css; charset=utf-8');
        }
        foreach (['/admin-page/website-about', '/apps/team/staff-page/website-about', '/admin-auth/auth'] as $url) {
            $response = $this->get($url)->assertOk();
            $html = file_get_contents($response->baseResponse->getFile()->getPathname());
            $this->assertStringContainsString('admin-form-controls.css?v=1.0', $html);
            $this->assertStringContainsString('admin-form-controls.js?v=1.0', $html);
        }
    }
}
