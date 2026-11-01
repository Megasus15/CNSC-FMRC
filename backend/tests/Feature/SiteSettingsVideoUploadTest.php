<?php

namespace Tests\Feature;

use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SiteSettingsVideoUploadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public static function editorRoles(): array
    {
        return [['admin'], ['staff']];
    }

    #[DataProvider('editorRoles')]
    public function test_fifty_mb_is_accepted_but_video_is_published_only_when_its_owner_saves(string $role): void
    {
        $user = User::factory()->create(['role' => $role]);
        Sanctum::actingAs($user);
        SiteSetting::set('about_video_url', 'https://example.test/previous.mp4');
        $upload = $this->postJson('/api/admin/site-settings/about-video-upload', [
            'video' => UploadedFile::fake()->create('intro.mp4', 51200, 'video/mp4'),
        ])->assertCreated()->assertJsonPath('data.size', 50 * 1024 * 1024);
        $token = $upload->json('data.token');
        $this->assertSame('https://example.test/previous.mp4', SiteSetting::get('about_video_url'));
        $this->putJson('/api/admin/site-settings', ['about_heading' => 'Updated introduction', 'about_video_upload_token' => $token])
            ->assertOk();
        $this->assertStringStartsWith('/api/site-settings/about-video?v=', SiteSetting::get('about_video_url'));
        $this->assertNull(SiteSetting::get('about_video_upload_token'));
        $url = $this->getJson('/api/site-settings?media=references')->assertOk()->json('data.about_video_url');
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'video/mp4');
        // Losing a save response must not make the same upload receipt unusable.
        $this->putJson('/api/admin/site-settings', ['about_video_upload_token' => $token])->assertOk();
        $this->deleteJson('/api/admin/site-settings/about-video-upload/'.$token)->assertOk();
        $this->get($url)->assertOk();
    }

    #[DataProvider('editorRoles')]
    public function test_oversize_or_unsupported_uploads_leave_the_current_video_unchanged(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
        SiteSetting::set('about_video_url', 'https://example.test/previous.mp4');
        $this->postJson('/api/admin/site-settings/about-video-upload', [
            'video' => UploadedFile::fake()->create('oversize.mp4', 51201, 'video/mp4'),
        ])->assertUnprocessable()->assertJsonValidationErrors('video');
        $this->postJson('/api/admin/site-settings/about-video-upload', [
            'video' => UploadedFile::fake()->create('document.txt', 1, 'text/plain'),
        ])->assertUnprocessable()->assertJsonValidationErrors('video');
        $this->assertSame('https://example.test/previous.mp4', SiteSetting::get('about_video_url'));
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_other_accounts_cannot_publish_or_discard_an_upload_and_failed_publication_is_atomic(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $token = $this->postJson('/api/admin/site-settings/about-video-upload', [
            'video' => UploadedFile::fake()->create('intro.mp4', 1, 'video/mp4'),
        ])->assertCreated()->json('data.token');
        SiteSetting::set('about_heading', 'Keep this text');
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->putJson('/api/admin/site-settings', ['about_heading' => 'Do not write this', 'about_video_upload_token' => $token])
            ->assertUnprocessable()->assertJsonValidationErrors('about_video_upload_token');
        $this->deleteJson('/api/admin/site-settings/about-video-upload/'.$token)->assertNotFound();
        $this->assertSame('Keep this text', SiteSetting::get('about_heading'));
        $this->assertNull(SiteSetting::get('about_video_url'));
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->postJson('/api/admin/site-settings/about-video-upload', [
            'video' => UploadedFile::fake()->create('intro.mp4', 1, 'video/mp4'),
        ])->assertForbidden();
    }

    public function test_discarding_an_unpublished_upload_removes_its_private_file(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $token = $this->postJson('/api/admin/site-settings/about-video-upload', [
            'video' => UploadedFile::fake()->create('intro.mp4', 1, 'video/mp4'),
        ])->assertCreated()->json('data.token');
        $this->assertCount(1, Storage::disk('local')->allFiles());
        $this->deleteJson('/api/admin/site-settings/about-video-upload/'.$token)->assertOk();
        $this->assertSame([], Storage::disk('local')->allFiles());
        $this->putJson('/api/admin/site-settings', ['about_video_upload_token' => $token])
            ->assertUnprocessable()->assertJsonValidationErrors('about_video_upload_token');
    }
}
