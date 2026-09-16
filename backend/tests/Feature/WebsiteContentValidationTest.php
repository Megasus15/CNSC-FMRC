<?php

namespace Tests\Feature;

use App\Models\Service;
use App\Models\SiteSetting;
use App\Models\User;
use App\Support\WebsiteContentLimits;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class WebsiteContentValidationTest extends TestCase
{
    use RefreshDatabase;

    public static function editorRoles(): array
    {
        return [['admin'], ['staff']];
    }

    private function signIn(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
    }

    #[DataProvider('editorRoles')]
    public function test_each_editor_can_save_all_copy_at_its_exact_limit_and_read_it_back(string $role): void
    {
        $this->signIn($role);
        $payload = [];
        foreach (WebsiteContentLimits::SETTINGS as $key => $limit) {
            $payload[$key] = str_repeat('x', $limit);
        }
        // Image data and gallery JSON are not prose and must not receive a copy limit.
        $payload['mission_image'] = 'data:image/png;base64,'.str_repeat('A', 3000);
        $payload['mission_gallery'] = json_encode([$payload['mission_image']]);
        $this->putJson('/api/admin/site-settings', $payload)->assertOk();
        $response = $this->getJson('/api/site-settings')->assertOk();
        foreach ($payload as $key => $value) {
            $response->assertJsonPath('data.'.$key, $value);
        }
    }

    public function test_oversized_copy_returns_each_field_error_without_partially_saving_settings(): void
    {
        $this->signIn('admin');
        SiteSetting::set('hero_title', 'Original title');
        $payload = [];
        foreach (WebsiteContentLimits::SETTINGS as $key => $limit) {
            $payload[$key] = str_repeat('x', $limit + 1);
        }
        $this->putJson('/api/admin/site-settings', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors(array_keys($payload));
        $this->assertSame('Original title', SiteSetting::get('hero_title'));
        $this->assertNull(SiteSetting::get('editorial_services_title'));
    }

    public function test_partial_settings_updates_preserve_other_copy_and_allow_clearing_optional_copy(): void
    {
        $this->signIn('staff');
        SiteSetting::set('hero_title', 'Keep this title');
        SiteSetting::set('home_sdg_heading', 'Clear this caption');
        $this->putJson('/api/admin/site-settings', ['home_sdg_heading' => null])->assertOk();
        $this->assertSame('Keep this title', SiteSetting::get('hero_title'));
        $this->assertNull(SiteSetting::get('home_sdg_heading'));
        $this->putJson('/api/admin/site-settings', ['mission_text' => ['invalid']])
            ->assertUnprocessable()->assertJsonValidationErrors('mission_text');
    }

    #[DataProvider('editorRoles')]
    public function test_each_editor_can_create_and_partially_update_a_service_at_the_boundaries(string $role): void
    {
        $this->signIn($role);
        $payload = [];
        foreach (WebsiteContentLimits::SERVICE_TEXT as $key => $limit) {
            $payload[$key] = str_repeat('x', $limit);
        }
        foreach (WebsiteContentLimits::SERVICE_LISTS as $key) {
            $payload[$key] = array_fill(0, 12, str_repeat('x', 120));
        }
        $id = $this->postJson('/api/admin/services', $payload)->assertCreated()->json('data.id');
        $this->putJson('/api/admin/services/'.$id, ['description' => 'Updated description'])
            ->assertOk()->assertJsonPath('data.title', $payload['title'])
            ->assertJsonPath('data.description', 'Updated description');
        $this->getJson('/api/admin/services')->assertOk();
        $this->getJson('/api/services')->assertOk()->assertJsonPath('data.0.title', $payload['title']);
    }

    public function test_oversized_service_fields_and_detail_lists_are_rejected_on_create_and_update(): void
    {
        $this->signIn('admin');
        $payload = [];
        foreach (WebsiteContentLimits::SERVICE_TEXT as $key => $limit) {
            $payload[$key] = str_repeat('x', $limit + 1);
        }
        foreach (WebsiteContentLimits::SERVICE_LISTS as $key) {
            $payload[$key] = array_fill(0, 13, str_repeat('x', 121));
        }
        $errorFields = array_keys($payload);
        foreach (WebsiteContentLimits::SERVICE_LISTS as $key) {
            $errorFields[] = $key.'.0';
        }
        $this->postJson('/api/admin/services', $payload)->assertUnprocessable()
            ->assertJsonValidationErrors($errorFields);
        $this->assertSame(0, Service::count());
        $service = Service::create(['title' => 'Original', 'category' => 'Prototyping']);
        $this->putJson('/api/admin/services/'.$service->id, $payload)->assertUnprocessable()
            ->assertJsonValidationErrors($errorFields);
        $this->assertSame('Original', $service->fresh()->title);
    }

    public function test_customer_cannot_write_page_copy_or_service_content(): void
    {
        $service = Service::create(['title' => 'Protected service', 'category' => 'Prototyping']);
        $this->signIn('customer');
        $this->putJson('/api/admin/site-settings', ['hero_title' => 'Changed'])->assertForbidden();
        $this->postJson('/api/admin/services', ['title' => 'Changed', 'category' => 'Prototyping'])->assertForbidden();
        $this->putJson('/api/admin/services/'.$service->id, ['title' => 'Changed'])->assertForbidden();
        $this->deleteJson('/api/admin/services/'.$service->id)->assertForbidden();
        $this->getJson('/api/admin/services')->assertForbidden();
        $this->assertSame('Protected service', $service->fresh()->title);
        $this->assertNull(SiteSetting::get('hero_title'));
        $this->getJson('/api/services')->assertOk();
    }

    public function test_emoji_limits_match_browser_maxlength_and_character_counters(): void
    {
        $this->signIn('staff');
        $emoji = "\u{1F600}";
        $this->putJson('/api/admin/site-settings', ['hero_title' => str_repeat($emoji, 60)])->assertOk();
        $this->putJson('/api/admin/site-settings', ['hero_title' => str_repeat($emoji, 61)])
            ->assertUnprocessable()->assertJsonValidationErrors('hero_title');
        $payload = ['title' => str_repeat($emoji, 50), 'category' => 'Prototyping'];
        $this->postJson('/api/admin/services', $payload)->assertCreated();
        $payload['title'] .= $emoji;
        $payload['modal_features'] = [str_repeat($emoji, 61)];
        $this->postJson('/api/admin/services', $payload)->assertUnprocessable()
            ->assertJsonValidationErrors(['title', 'modal_features.0']);
    }
}
