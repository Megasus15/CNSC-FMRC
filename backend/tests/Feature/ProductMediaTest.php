<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use App\Support\ProductMedia;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class ProductMediaTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->withHeader('Accept', 'application/json');
    }

    public static function editors(): array { return [['admin'], ['staff']]; }

    private function signIn(string $role = 'admin'): User
    {
        $user = User::factory()->create(['role' => $role === 'staff' ? 'admin' : $role]);
        $user->role = $role;
        Sanctum::actingAs($user);

        return $user;
    }

    private function product(): Product
    {
        $cover = UploadedFile::fake()->image('cover.png');
        return Product::create([
            'name' => 'Bamboo Tumbler', 'category' => 'Products', 'code' => 'TUM-'.Product::count(),
            'price' => 150, 'stock' => 5, 'stock_status' => 'in_stock', 'is_blocked' => false,
            'image_data' => 'data:image/png;base64,'.base64_encode(file_get_contents($cover->getRealPath())),
        ]);
    }

    private function body(Product $product, array $extra = []): array
    {
        return $extra + $product->only(['name', 'category', 'code', 'stock', 'price', 'stock_status']);
    }

    private function upload(Product $product, string $fixture = 'image'): array
    {
        $file = $fixture === 'image' ? UploadedFile::fake()->image('detail.png', 320, 180)
            : new UploadedFile(base_path('tests/Fixtures/product-media/'.$fixture.'.webm'), $fixture.'.webm', 'video/webm', null, true);

        return $this->post('/api/admin/products/'.$product->id.'/media-uploads', ['file' => $file])
            ->assertCreated()->json('data');
    }

    #[DataProvider('editors')]
    public function test_editors_stage_publish_reorder_and_remove_media(string $role): void
    {
        $this->signIn($role);
        $product = $this->product();
        $image = $this->upload($product);
        $video = $this->upload($product, 'short');
        $this->getJson('/api/products')->assertJsonCount(1, 'data.0.media');
        $this->get('/api/products/'.$product->id.'/media/'.$image['upload_token'])->assertNotFound();
        $draftUrl = '/api/admin/products/'.$product->id.'/media-uploads/'.$image['upload_token'];
        $this->get($draftUrl)->assertOk()->assertHeader('Cache-Control', 'no-store, private');

        $input = [['upload_token' => $image['upload_token']], ['upload_token' => $video['upload_token']]];
        $response = $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => $input]))
            ->assertOk()->assertJsonCount(3, 'data.media')->assertJsonPath('data.media.0.id', 'cover')
            ->assertJsonPath('data.media.2.type', 'video');
        $this->assertArrayNotHasKey('gallery_media', $response->json('data'));
        $imageUrl = $response->json('data.media.1.url');
        $videoUrl = $response->json('data.media.2.url');
        $this->get($imageUrl)->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->get($videoUrl, ['Range' => 'bytes=0-15'])->assertStatus(206)->assertHeader('Content-Length', '16');
        $this->get($imageUrl, ['If-None-Match' => '"'.$image['upload_token'].'"'])->assertStatus(304);
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => array_reverse($input)]))
            ->assertOk()->assertJsonPath('data.media.1.id', $video['upload_token']);
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['summary' => 'Changed text only']))
            ->assertOk()->assertJsonCount(3, 'data.media');
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => []]))
            ->assertOk()->assertJsonCount(1, 'data.media');
        $this->get($imageUrl)->assertNotFound();
        $this->get($videoUrl)->assertNotFound();
        $this->assertSame([], Storage::disk('local')->files('product-media/'.$product->id));
    }

    public function test_five_items_are_allowed_but_six_and_two_videos_are_rejected_atomically(): void
    {
        $this->signIn(); $product = $this->product();
        $items = [];
        for ($i = 0; $i < 4; $i++) $items[] = ['upload_token' => $this->upload($product)['upload_token']];
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => $items]))
            ->assertOk()->assertJsonCount(5, 'data.media');
        $extra = ['upload_token' => $this->upload($product)['upload_token']];
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['name' => 'Must not save', 'gallery_media' => [...$items, $extra]]))->assertUnprocessable();
        $videos = [['upload_token' => $this->upload($product, 'short')['upload_token']], ['upload_token' => $this->upload($product, 'short')['upload_token']]];
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['name' => 'Must not save', 'gallery_media' => $videos]))->assertUnprocessable()->assertJsonValidationErrors('gallery_media');
        $this->assertSame('Bamboo Tumbler', $product->fresh()->name);
        $this->assertCount(4, $product->fresh()->gallery_media);
    }

    public function test_video_duration_boundary_is_enforced_using_actual_files(): void
    {
        $this->signIn(); $product = $this->product();
        $this->assertEquals(30, $this->upload($product, 'boundary-30')['duration_seconds']);
        $this->post('/api/admin/products/'.$product->id.'/media-uploads', [
            'file' => new UploadedFile(base_path('tests/Fixtures/product-media/over-30.webm'), 'long.webm', 'video/webm', null, true),
        ])->assertUnprocessable()->assertJsonValidationErrors('file');
        $this->assertCount(2, Storage::disk('local')->allFiles('product-media-drafts'));
    }

    public function test_upload_validation_rejects_spoofed_unreadable_and_oversized_files(): void
    {
        $this->signIn(); $product = $this->product();
        foreach ([
            UploadedFile::fake()->createWithContent('fake.mp4', 'not a video'),
            UploadedFile::fake()->image('large.png')->size(10241),
            UploadedFile::fake()->create('large.webm', 30721, 'video/webm'),
            UploadedFile::fake()->createWithContent('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
        ] as $file) $this->post('/api/admin/products/'.$product->id.'/media-uploads', ['file' => $file])->assertUnprocessable();
        $this->assertSame([], Storage::disk('local')->allFiles('product-media-drafts'));
    }

    public function test_customers_cannot_upload_discard_preview_or_publish_gallery_media(): void
    {
        $this->signIn(); $product = $this->product(); $draft = $this->upload($product);
        $this->signIn('customer');
        $url = '/api/admin/products/'.$product->id.'/media-uploads';
        $this->post($url, ['file' => UploadedFile::fake()->image('x.png')])->assertForbidden();
        $this->get($url.'/'.$draft['upload_token'])->assertForbidden();
        $this->delete($url.'/'.$draft['upload_token'])->assertForbidden();
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => []]))->assertForbidden();
    }

    public function test_upload_tokens_and_retained_ids_cannot_cross_editors_or_products(): void
    {
        $this->signIn(); $first = $this->product(); $second = $this->product();
        $draft = $this->upload($first); $entry = [['upload_token' => $draft['upload_token']]];
        $this->putJson('/api/admin/products/'.$second->id, $this->body($second, ['gallery_media' => $entry]))->assertUnprocessable();
        $this->signIn('staff');
        $this->putJson('/api/admin/products/'.$first->id, $this->body($first, ['gallery_media' => $entry]))->assertUnprocessable();
        $this->get('/api/admin/products/'.$first->id.'/media-uploads/'.$draft['upload_token'])->assertUnprocessable();
        $this->putJson('/api/admin/products/'.$first->id, $this->body($first, ['gallery_media' => [['id' => $draft['upload_token']]]]))->assertUnprocessable();
    }

    public function test_failed_save_retains_drafts_and_successful_request_can_be_retried(): void
    {
        $this->signIn(); $product = $this->product(); $other = $this->product();
        $draft = $this->upload($product); $entry = [['upload_token' => $draft['upload_token']]];
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['code' => $other->code, 'gallery_media' => $entry]))->assertUnprocessable();
        $this->get('/api/admin/products/'.$product->id.'/media-uploads/'.$draft['upload_token'])->assertOk();
        for ($i = 0; $i < 2; $i++) $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => $entry]))->assertOk()->assertJsonCount(2, 'data.media');
        $this->assertCount(1, Storage::disk('local')->files('product-media/'.$product->id));
    }

    public function test_gallery_requires_cover_and_rejects_duplicate_or_arbitrary_manifest_properties(): void
    {
        $this->signIn(); $product = $this->product(); $draft = $this->upload($product);
        $entry = ['upload_token' => $draft['upload_token']];
        foreach ([['image_data' => null, 'gallery_media' => [$entry]], ['gallery_media' => [$entry, $entry]], ['gallery_media' => [$entry + ['path' => '../secret']]]] as $extra) {
            $this->putJson('/api/admin/products/'.$product->id, $this->body($product, $extra))->assertUnprocessable();
        }
        $this->assertNull($product->fresh()->gallery_media);
    }

    public function test_discard_expiry_blocking_and_product_deletion_remove_access(): void
    {
        $this->signIn(); $product = $this->product(); $draft = $this->upload($product);
        $url = '/api/admin/products/'.$product->id.'/media-uploads/'.$draft['upload_token'];
        $this->delete($url)->assertOk(); $this->get($url)->assertUnprocessable();
        $draft = $this->upload($product);
        $saved = $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['gallery_media' => [['upload_token' => $draft['upload_token']]]]))->assertOk();
        $mediaUrl = $saved->json('data.media.1.url');
        $product->update(['is_blocked' => true]); $this->get($mediaUrl)->assertNotFound();
        $this->get('/api/admin/products/'.$product->id.'/media/'.$draft['upload_token'])->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $product->delete(); $this->assertSame([], Storage::disk('local')->files('product-media/'.$product->id));
        foreach (Storage::disk('local')->allFiles('product-media-drafts') as $file) touch(Storage::disk('local')->path($file), now()->subDays(2)->timestamp);
        ProductMedia::cleanup(); $this->assertSame([], Storage::disk('local')->allFiles('product-media-drafts'));
    }

    public function test_database_failure_after_file_copy_keeps_product_unchanged_and_upload_retryable(): void
    {
        $this->signIn(); $product = $this->product(); $draft = $this->upload($product);
        $body = $this->body($product, ['name' => 'Updated name', 'gallery_media' => [['upload_token' => $draft['upload_token']]]]);
        $event = 'eloquent.updating: '.Product::class;
        \Illuminate\Support\Facades\Event::listen($event, function () {
            throw \Illuminate\Validation\ValidationException::withMessages(['name' => 'Simulated database save failure.']);
        });
        try {
            $this->putJson('/api/admin/products/'.$product->id, $body)->assertUnprocessable();
        } finally { \Illuminate\Support\Facades\Event::forget($event); }
        $this->assertSame('Bamboo Tumbler', $product->fresh()->name);
        $this->assertNull($product->fresh()->gallery_media);
        $this->putJson('/api/admin/products/'.$product->id, $body)->assertOk()->assertJsonPath('data.name', 'Updated name');
    }

    public function test_cover_replacement_changes_card_and_gallery_urls_even_within_one_second(): void
    {
        $this->freezeTime(); $this->signIn(); $product = $this->product();
        $before = $this->getJson('/api/products')->assertOk()->json('data.0.image_data');
        $file = UploadedFile::fake()->image('new-cover.png', 100, 200);
        $cover = 'data:image/png;base64,'.base64_encode(file_get_contents($file->getRealPath()));
        $response = $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['image_data' => $cover]))->assertOk();
        $this->assertNotSame($before, $response->json('data.image_data'));
        $this->assertSame($response->json('data.image_data'), $response->json('data.media.0.url'));
        $this->get($response->json('data.image_data'))->assertOk();
        $this->putJson('/api/admin/products/'.$product->id, $this->body($product, ['image_data' => ['bad']]))->assertUnprocessable();
    }
}
