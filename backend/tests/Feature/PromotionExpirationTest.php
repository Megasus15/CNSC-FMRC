<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PromotionExpirationTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_campaign_statuses_use_strict_manila_schedule_boundaries(): void
    {
        // 10:00 in Asia/Manila, represented as UTC like the persisted timestamps.
        $now = Carbon::parse('2026-08-05 02:00:00', 'UTC');
        Carbon::setTestNow($now);

        $live = Promotion::create([
            'title' => 'Live campaign',
            'discount_percent' => 10,
            'scope' => 'all_products',
            'starts_at' => $now->copy()->subHour(),
            'ends_at' => $now->copy()->addHour(),
            'is_enabled' => true,
        ]);
        $scheduled = Promotion::create([
            'title' => 'Scheduled campaign',
            'discount_percent' => 15,
            'scope' => 'all_products',
            'starts_at' => $now->copy()->addHour(),
            'ends_at' => $now->copy()->addHours(2),
            'is_enabled' => true,
        ]);
        $finished = Promotion::create([
            'title' => 'Finished campaign',
            'discount_percent' => 20,
            'scope' => 'all_products',
            'starts_at' => $now->copy()->subHours(2),
            'ends_at' => $now,
            'is_enabled' => true,
        ]);
        $paused = Promotion::create([
            'title' => 'Paused campaign',
            'discount_percent' => 25,
            'scope' => 'all_products',
            'is_enabled' => false,
        ]);

        $this->assertTrue($live->isLive());
        $this->assertSame('LIVE', $live->status());
        $this->assertSame('SCHEDULED', $scheduled->status());
        $this->assertFalse($finished->isLive());
        $this->assertSame('FINISHED', $finished->status());
        $this->assertSame('PAUSED', $paused->status());

        $announcement = Announcement::create([
            'title' => 'Expired visitor notice',
            'message' => 'This notice has ended.',
            'placement' => 'site',
            'starts_at' => $now->copy()->subHour(),
            'ends_at' => $now,
            'is_enabled' => true,
        ]);

        $this->assertFalse($announcement->isLive());
        $this->assertSame('FINISHED', $announcement->status());
    }

    public function test_public_feeds_exclude_campaigns_at_their_end_time(): void
    {
        // 10:00 in Asia/Manila, represented as UTC like the persisted timestamps.
        $now = Carbon::parse('2026-08-05 02:00:00', 'UTC');
        Carbon::setTestNow($now);

        Promotion::create([
            'title' => 'Expired promotion',
            'discount_percent' => 10,
            'scope' => 'all_products',
            'ends_at' => $now,
            'is_enabled' => true,
        ]);
        Promotion::create([
            'title' => 'Live promotion',
            'discount_percent' => 15,
            'scope' => 'all_products',
            'ends_at' => $now->copy()->addHour(),
            'is_enabled' => true,
        ]);

        Announcement::create([
            'title' => 'Expired announcement',
            'message' => 'Expired.',
            'placement' => 'site',
            'ends_at' => $now,
            'is_enabled' => true,
        ]);
        Announcement::create([
            'title' => 'Live announcement',
            'message' => 'Live.',
            'placement' => 'site',
            'ends_at' => $now->copy()->addHour(),
            'is_enabled' => true,
        ]);

        $this->getJson('/api/promotions/active')
            ->assertOk()
            ->assertJsonMissing(['title' => 'Expired promotion'])
            ->assertJsonFragment(['title' => 'Live promotion']);

        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonMissing(['title' => 'Expired announcement'])
            ->assertJsonFragment(['title' => 'Live announcement']);
    }

    public function test_admin_feed_keeps_expired_campaign_with_finished_status_and_formats_manila_time(): void
    {
        // 10:00 in Asia/Manila, represented as UTC like the persisted timestamps.
        $now = Carbon::parse('2026-08-05 02:00:00', 'UTC');
        Carbon::setTestNow($now);

        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $expired = Promotion::create([
            'title' => 'Finished campaign',
            'discount_percent' => 10,
            'scope' => 'all_products',
            'ends_at' => $now,
            'is_enabled' => true,
        ]);

        $this->getJson('/api/admin/promotions')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $expired->id,
                'title' => 'Finished campaign',
                'status' => 'FINISHED',
            ]);

        $response = $this->postJson('/api/admin/promotions', [
            'title' => 'Manila schedule',
            'discount_percent' => 5,
            'scope' => 'all_products',
            'starts_at' => '2026-08-05T12:00',
            'ends_at' => '2026-08-05T13:00',
            'is_enabled' => true,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.starts_at', '2026-08-05T12:00:00+08:00')
            ->assertJsonPath('data.ends_at', '2026-08-05T13:00:00+08:00')
            ->assertJsonPath('data.status', 'SCHEDULED');
    }

    public function test_expired_promotion_returns_original_product_price(): void
    {
        // 10:00 in Asia/Manila, represented as UTC like the persisted timestamps.
        $now = Carbon::parse('2026-08-05 02:00:00', 'UTC');
        Carbon::setTestNow($now);

        $product = Product::create([
            'name' => 'Test product',
            'category' => '3D Print',
            'code' => 'TEST-EXPIRY-001',
            'stock' => 10,
            'price' => 100,
            'stock_status' => 'in_stock',
            'is_blocked' => false,
        ]);

        Promotion::create([
            'title' => 'Expired discount',
            'discount_percent' => 50,
            'scope' => 'all_products',
            'ends_at' => $now,
            'is_enabled' => true,
        ]);

        $publicProduct = $this->getJson('/api/products')
            ->assertOk()
            ->json('data.0');

        $this->assertSame($product->id, $publicProduct['id']);
        $this->assertSame(100, (int) $publicProduct['price']);
        $this->assertSame(100, (int) $publicProduct['sale_price']);
        $this->assertSame(0, $publicProduct['discount_percent']);
        $this->assertNull($publicProduct['promotion']);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $adminProduct = $this->getJson('/api/admin/products')
            ->assertOk()
            ->json('data.0');

        $this->assertSame(100, (int) $adminProduct['sale_price']);
        $this->assertSame(0, $adminProduct['discount_percent']);
        $this->assertNull($adminProduct['promotion']);
    }

    public function test_promotion_picker_uses_lightweight_authorized_product_options(): void
    {
        $product = Product::create([
            'name' => 'Picker product',
            'category' => '3D Print',
            'code' => 'PICKER-001',
            'stock' => 4,
            'price' => 250,
            'stock_status' => 'in_stock',
            'is_blocked' => false,
            'image_data' => 'data:image/png;base64,cHJvZHVjdC1pbWFnZQ==',
        ]);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $response = $this->getJson('/api/admin/products/promotion-options')
            ->assertOk()
            ->assertJsonPath('data.0.id', $product->id)
            ->assertJsonPath('data.0.name', 'Picker product')
            ->assertJsonPath('data.0.code', 'PICKER-001');

        $this->assertArrayNotHasKey('image_data', $response->json('data.0'));
        $this->assertArrayNotHasKey('price', $response->json('data.0'));

        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));

        $this->getJson('/api/admin/products/promotion-options')->assertForbidden();
        $this->getJson('/api/admin/products')->assertForbidden();
        $this->getJson('/api/admin/promotions')->assertForbidden();
    }
}
