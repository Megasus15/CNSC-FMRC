<?php

namespace Tests\Feature;

use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SiteSettingsVideoTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_reference_settings_stay_small_with_an_embedded_video_and_keep_legacy_reads_compatible(): void
    {
        $video = 'data:video/mp4;base64,'.base64_encode(str_repeat('video fixture ', 200000));
        SiteSetting::set('about_video_url', $video);
        SiteSetting::set('about_heading', 'About FMRC');
        $compact = $this->getJson('/api/site-settings?media=references')->assertOk()
            ->assertJsonPath('data.about_heading', 'About FMRC');
        $this->assertLessThan(2000, strlen($compact->getContent()));
        $this->assertStringContainsString('/api/site-settings/about-video?v=', $compact->json('data.about_video_url'));
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.about_video_url', $video);
        $this->getJson('/api/site-settings?media=references', ['If-None-Match' => $compact->headers->get('ETag')])
            ->assertNotModified();
    }

    public function test_the_video_supports_ranges_caching_and_head_without_inline_json_bytes(): void
    {
        $binary = "\0\0\0\x18ftypmp42".str_repeat('video fixture bytes', 25000);
        SiteSetting::set('about_video_url', 'data:video/mp4;base64,'.base64_encode($binary));
        $url = $this->getJson('/api/site-settings?media=references')->json('data.about_video_url');
        $response = $this->get($url)->assertOk()
            ->assertHeader('Content-Type', 'video/mp4')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Length', (string) strlen($binary));
        $this->assertSame($binary, file_get_contents($response->baseResponse->getFile()->getPathname()));
        $this->get($url, ['Range' => 'bytes=4-11'])->assertStatus(206)
            ->assertHeader('Content-Range', 'bytes 4-11/'.strlen($binary))
            ->assertHeader('Content-Length', '8');
        $this->get($url, ['If-None-Match' => $response->headers->get('ETag')])->assertNotModified();
        $this->head($url)->assertOk()->assertHeader('Content-Type', 'video/mp4');
    }

    public function test_external_video_references_are_preserved_and_invalid_or_stale_media_requests_are_rejected(): void
    {
        SiteSetting::set('about_video_url', 'https://example.test/intro.mp4');
        $this->getJson('/api/site-settings?media=references')->assertOk()
            ->assertJsonPath('data.about_video_url', 'https://example.test/intro.mp4');
        $this->get('/api/site-settings/about-video')->assertNotFound();
        SiteSetting::set('about_video_url', 'data:video/mp4;base64,'.base64_encode('first version'));
        $url = $this->getJson('/api/site-settings?media=references')->json('data.about_video_url');
        SiteSetting::set('about_video_url', 'data:video/mp4;base64,'.base64_encode('second version'));
        $this->get($url)->assertNotFound();
        SiteSetting::set('about_video_url', 'data:text/html;base64,'.base64_encode('<script>bad()</script>'));
        $this->get('/api/site-settings/about-video')->assertNotFound();
        SiteSetting::set('about_video_url', 'data:video/mp4;base64,not valid base64!');
        $this->get('/api/site-settings/about-video')->assertNotFound();
    }

    public static function editorRoles(): array
    {
        return [['admin'], ['staff']];
    }

    #[DataProvider('editorRoles')]
    public function test_both_editors_can_save_about_text_without_replacing_existing_video_bytes(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
        $video = 'data:video/mp4;base64,'.base64_encode('existing public video');
        SiteSetting::set('about_video_url', $video);
        SiteSetting::set('hero_title', 'Home stays unchanged');
        $this->putJson('/api/admin/site-settings', ['about_heading' => 'Updated by '.$role])->assertOk();
        $this->assertSame($video, SiteSetting::get('about_video_url'));
        $this->getJson('/api/site-settings?media=references')->assertOk()
            ->assertJsonPath('data.about_heading', 'Updated by '.$role)
            ->assertJsonPath('data.hero_title', 'Home stays unchanged');
    }
}
