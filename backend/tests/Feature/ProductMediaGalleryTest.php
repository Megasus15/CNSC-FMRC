<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMediaAsset;
use App\Models\User;
use App\Services\ProductMedia;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class ProductMediaGalleryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public static function roles(): array { return [['admin'], ['staff']]; }

    private function operator(string $role = 'admin'): User
    {
        $user = User::factory()->create(['role' => $role]);
        Sanctum::actingAs($user);
        return $user;
    }

    private function fields(): array
    {
        return ['name' => 'Gallery product', 'category' => '3D Print', 'code' => 'MEDIA-'.fake()->unique()->numerify('#####'),
            'price' => 120, 'stock' => 10, 'stock_status' => 'in_stock', 'is_blocked' => false];
    }

    private function photo(string $name = 'product.png'): array
    {
        return $this->postJson('/api/admin/products/media-uploads', ['file' => UploadedFile::fake()->image($name, 120, 80)])
            ->assertCreated()->json('data');
    }

    private function video(): array
    {
        // Real MP4 file-type bytes, rather than trusting a claimed Content-Type.
        $bytes = pack('N', 24).'ftypmp42'.pack('N', 0).'mp42isom'.pack('N', 8).'mdat';
        return $this->postJson('/api/admin/products/media-uploads', ['file' => UploadedFile::fake()->createWithContent('product.mp4', $bytes)])
            ->assertCreated()->json('data');
    }

    private function createGallery(array $entries, ?string $cover, array $fields = []): Product
    {
        $response = $this->postJson('/api/admin/products', array_merge($this->fields(), $fields, ['media' => $entries, 'cover' => $cover, 'media_revision' => 0]))->assertCreated();
        return Product::findOrFail($response->json('data.id'));
    }

    #[DataProvider('roles')]
    public function test_gallery_is_published_only_by_product_save_and_keeps_payloads_light(string $role): void
    {
        $this->operator($role); $photo = $this->photo(); $video = $this->video();
        $this->get('/api/product-media/'.$photo['id'])->assertNotFound();
        $this->assertDatabaseCount('products', 0);
        $this->assertArrayNotHasKey('url', $photo);
        $product = $this->createGallery([['token' => $video['token']], ['token' => $photo['token']]], $photo['token']);
        $this->assertSame(1, $product->media_revision);
        $gallery = $this->getJson('/api/products/'.$product->id.'/media')->assertOk()->json('data');
        $this->assertSame(['video', 'image'], array_column($gallery['media'], 'type'));
        $this->assertSame((string) $photo['id'], $gallery['cover']);
        $this->assertArrayNotHasKey('token', $gallery['media'][0]);
        $this->assertStringNotContainsString('base64', json_encode($gallery));
        $this->get('/api/product-media/'.$video['id'])->assertOk()->assertHeader('Content-Type', 'video/mp4');
        $this->head('/api/product-media/'.$video['id'])->assertOk()->assertHeader('Content-Type', 'video/mp4');
        $this->get('/api/product-media/'.$video['id'], ['Range' => 'bytes=0-15'])->assertStatus(206)->assertHeader('Content-Length', '16');
        $this->getJson('/api/products')->assertOk()->assertJsonPath('data.0.media_count', 2)
            ->assertJsonPath('data.0.image_data', url('/api/product-media/'.$photo['id']).'?thumbnail=1');
        $this->getJson('/api/admin/products')->assertOk()->assertJsonCount(2, 'data.0.media');
        // Cancel after an uncertain save response cannot remove published assets.
        $this->deleteJson('/api/admin/products/media-uploads/'.$photo['token'])->assertOk();
        $this->get('/api/product-media/'.$photo['id'])->assertOk();
    }

    public function test_gallery_reordering_cover_replacement_removal_and_stale_save_are_atomic(): void
    {
        $this->operator(); $first=$this->photo('first.png'); $second=$this->photo('second.png');
        $product=$this->createGallery([['token'=>$first['token']],['token'=>$second['token']]],$first['token']);
        $body=$this->fields()+['media'=>[['id'=>$second['id']],['id'=>$first['id']]],'cover'=>(string)$second['id'],'media_revision'=>1];
        $this->putJson('/api/admin/products/'.$product->id,$body)->assertOk()->assertJsonPath('data.media_revision',2);
        $this->getJson('/api/products/'.$product->id.'/media')->assertJsonPath('data.media.0.id',$second['id'])->assertJsonPath('data.cover',(string)$second['id']);
        $this->putJson('/api/admin/products/'.$product->id,array_replace($body,['name'=>'Stale overwrite']))->assertConflict();
        $this->assertSame('Gallery product',$product->fresh()->name);
        $this->putJson('/api/admin/products/'.$product->id,array_replace($body,['media'=>[['id'=>$first['id']]],'cover'=>(string)$first['id'],'media_revision'=>2]))->assertOk();
        $this->assertNull(ProductMediaAsset::find($second['id'])->product_id);
        $this->get('/api/product-media/'.$second['id'])->assertOk();
        $this->deleteJson('/api/admin/products/'.$product->id)->assertOk();
        $this->get('/api/product-media/'.$first['id'])->assertOk();
    }

    public function test_legacy_products_keep_original_image_endpoints_and_can_be_cleared_without_resurrection(): void
    {
        $this->operator(); $file=UploadedFile::fake()->image('original.png',80,60);
        $original='data:image/png;base64,'.base64_encode(file_get_contents($file->getRealPath()));
        $product=Product::create($this->fields()+['image_data'=>$original]);
        $this->getJson('/api/products/'.$product->id.'/media')->assertJsonPath('data.media.0.id','legacy');
        $this->putJson('/api/admin/products/'.$product->id,$this->fields()+['media'=>[['legacy'=>true]],'cover'=>'legacy','media_revision'=>0])
            ->assertOk()->assertJsonPath('data.media_count',1);
        $this->assertSame($original,$product->fresh()->image_data);
        $legacyAsset=$product->fresh()->cover_media_id;
        $this->get('/api/products/'.$product->id.'/image?full=1')->assertOk()->assertContent(file_get_contents($file->getRealPath()));
        $this->putJson('/api/admin/products/'.$product->id,$this->fields()+['media'=>[],'cover'=>null,'media_revision'=>1])->assertOk()->assertJsonPath('data.image_data',null)->assertJsonPath('data.media_count',0);
        $this->getJson('/api/products/'.$product->id.'/media')->assertJsonCount(0,'data.media');
        $this->get('/api/product-media/'.$legacyAsset)->assertOk();
    }

    public function test_owner_product_and_revision_checks_prevent_token_or_gallery_theft(): void
    {
        $this->operator(); $photo=$this->photo();
        $this->operator('staff');
        $this->postJson('/api/admin/products',$this->fields()+['media'=>[['token'=>$photo['token']]],'cover'=>$photo['token'],'media_revision'=>0])->assertUnprocessable();
        $this->deleteJson('/api/admin/products/media-uploads/'.$photo['token'])->assertNotFound();
        $this->assertDatabaseCount('products',0);
        $own=$this->photo(); $first=$this->createGallery([['token'=>$own['token']]],$own['token']); $second=Product::create($this->fields());
        $this->putJson('/api/admin/products/'.$second->id,$this->fields()+['media'=>[['id'=>$first->cover_media_id]],'cover'=>(string)$first->cover_media_id,'media_revision'=>0])->assertUnprocessable();
        $this->putJson('/api/admin/products/'.$first->id,$this->fields()+['media'=>[],'cover'=>null])->assertUnprocessable()->assertJsonValidationErrors('media_revision');
    }

    public function test_upload_permissions_and_actual_file_validation(): void
    {
        $this->postJson('/api/admin/products/media-uploads',['file'=>UploadedFile::fake()->image('photo.png')])->assertUnauthorized();
        $this->operator('customer');
        $this->postJson('/api/admin/products/media-uploads',['file'=>UploadedFile::fake()->image('photo.png')])->assertForbidden();
        $this->operator();
        foreach (['photo.png','movie.mp4','photo.php'] as $name) {
            $this->postJson('/api/admin/products/media-uploads',['file'=>UploadedFile::fake()->createWithContent($name,'<?php echo "bad";')])->assertUnprocessable()->assertJsonValidationErrors('file');
        }
        $this->postJson('/api/admin/products/media-uploads',['file'=>UploadedFile::fake()->image('large.png')->size(5121)])->assertUnprocessable();
        $this->postJson('/api/admin/products/media-uploads',['file'=>UploadedFile::fake()->create('large.mp4',51201,'video/mp4')])->assertUnprocessable();
        $this->assertDatabaseCount('product_media',0);
        $this->assertSame([],Storage::disk('local')->allFiles());
    }

    public function test_gallery_limits_duplicates_and_cover_are_validated_before_any_product_change(): void
    {
        $this->operator(); $photo=$this->photo(); $video=$this->video();
        $base=$this->fields()+['media_revision'=>0];
        $this->postJson('/api/admin/products',$base+['media'=>[['token'=>$video['token']]],'cover'=>$video['token']])->assertUnprocessable()->assertJsonValidationErrors('cover');
        $this->postJson('/api/admin/products',$base+['media'=>array_fill(0,11,['token'=>$photo['token']]),'cover'=>$photo['token']])->assertUnprocessable()->assertJsonValidationErrors('media');
        $this->postJson('/api/admin/products',$base+['media'=>array_fill(0,2,['token'=>$photo['token']]),'cover'=>$photo['token']])->assertUnprocessable()->assertJsonValidationErrors('media');
        $videos=[$video,$this->video(),$this->video()];
        $this->postJson('/api/admin/products',$base+['media'=>array_merge([['token'=>$photo['token']]],array_map(fn($v)=>['token'=>$v['token']],$videos)),'cover'=>$photo['token']])->assertUnprocessable()->assertJsonValidationErrors('media');
        $this->assertDatabaseCount('products',0);
        $this->assertSame(0,ProductMediaAsset::whereNotNull('published_at')->count());
        $this->createGallery([['token'=>$photo['token']],['token'=>$videos[0]['token']],['token'=>$videos[1]['token']]],$photo['token']);
    }

    public function test_cancel_and_expiry_clean_only_unpublished_files_and_tokens_cannot_be_reused(): void
    {
        $this->operator(); $published=$this->photo(); $this->createGallery([['token'=>$published['token']]],$published['token']);
        $cancel=$this->photo(); $cancelPath=ProductMediaAsset::find($cancel['id'])->path;
        $this->deleteJson('/api/admin/products/media-uploads/'.$cancel['token'])->assertOk();
        Storage::disk('local')->assertMissing($cancelPath);
        $expired=$this->photo(); $expiredPath=ProductMediaAsset::find($expired['id'])->path;
        $this->travel(25)->hours();
        $this->postJson('/api/admin/products',$this->fields()+['media'=>[['token'=>$expired['token']]],'cover'=>$expired['token'],'media_revision'=>0])->assertUnprocessable();
        $this->artisan('products:clean-media-drafts')->assertSuccessful();
        Storage::disk('local')->assertMissing($expiredPath);
        $this->get('/api/product-media/'.$published['id'])->assertOk();
        $this->assertDatabaseCount('product_media',1);
    }

    public function test_failed_product_validation_preserves_staged_media_for_retry_and_blocked_galleries_stay_hidden(): void
    {
        $this->operator(); $photo=$this->photo(); $body=$this->fields()+['media'=>[['token'=>$photo['token']]],'cover'=>$photo['token'],'media_revision'=>0];
        $this->postJson('/api/admin/products',array_replace($body,['name'=>'']))->assertUnprocessable();
        $product=$this->createGallery($body['media'],$body['cover'],['is_blocked'=>true]);
        $this->getJson('/api/products/'.$product->id.'/media')->assertOk();
        $this->operator('customer');
        $this->getJson('/api/products/'.$product->id.'/media')->assertNotFound();
        $this->getJson('/api/products')->assertJsonCount(0,'data');
    }

    public function test_image_variants_have_distinct_cache_validators(): void
    {
        $this->operator(); $photo=$this->photo('original.webp');
        $this->createGallery([['token'=>$photo['token']]],$photo['token']);
        $url='/api/product-media/'.$photo['id']; $full=$this->get($url)->assertOk();
        $thumbnail=$this->get($url.'?thumbnail=1')->assertOk();
        $this->assertNotSame($full->headers->get('ETag'),$thumbnail->headers->get('ETag'));
        $this->get($url,['If-None-Match'=>$full->headers->get('ETag')])->assertStatus(304);
    }

    public function test_gallery_accepts_ten_distinct_items_and_exact_file_size_boundaries(): void
    {
        $this->operator();
        $first = $this->postJson('/api/admin/products/media-uploads', ['file' => UploadedFile::fake()->image('maximum-photo.png')->size(5120)])
            ->assertCreated()->assertJsonPath('data.size', 5 * 1024 * 1024)->json('data');
        $bytes = pack('N', 24).'ftypmp42'.pack('N', 0).'mp42isom'.pack('N', 8).'mdat';
        $video = $this->postJson('/api/admin/products/media-uploads', ['file' => UploadedFile::fake()->createWithContent('maximum-video.mp4', $bytes)->size(51200)])
            ->assertCreated()->assertJsonPath('data.size', 50 * 1024 * 1024)->json('data');
        $items = [$first, $video, $this->video()];
        for ($index = 0; $index < 7; $index++) $items[] = $this->photo('view-'.$index.'.png');
        $product = $this->createGallery(array_map(fn ($item) => ['token' => $item['token']], $items), $first['token']);
        $this->getJson('/api/products/'.$product->id.'/media')->assertOk()->assertJsonCount(10, 'data.media');
    }
}
