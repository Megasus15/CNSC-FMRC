<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductRating;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductRatingArchiveTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_archive_restore_and_delete_a_review_from_unified_archives(): void
    {
        Storage::fake('public');
        [$customer, $order, $item, $product] = $this->makeOrderAndItem();
        Storage::disk('public')->put('product-reviews/archive.txt', 'review media');

        $rating = ProductRating::create([
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'order_item_id' => $item->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'stars' => 5,
            'feedback' => 'A review with enough detail for the archive workflow test.',
            'media' => [[
                'path' => 'product-reviews/archive.txt',
                'url' => '/storage/product-reviews/archive.txt',
                'type' => 'image',
            ]],
            'is_anonymous' => true,
        ]);

        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $this->patchJson('/api/admin/ratings/archive-bulk', ['ids' => [$rating->id]])
            ->assertOk()
            ->assertJsonPath('scope', 'rating')
            ->assertJsonPath('processed_ids.0', $rating->id);

        $this->assertDatabaseHas('product_ratings', [
            'id' => $rating->id,
            'is_archived' => 1,
        ]);
        $this->getJson('/api/admin/ratings')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('summary.total', 0);
        $this->getJson("/api/products/{$product->id}/reviews")
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('summary.total', 0);
        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.review_count', 0);
        Sanctum::actingAs($customer);
        $this->getJson('/api/customer/orders')
            ->assertOk()
            ->assertJsonPath('data.0.has_rating', false);
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/archives')
            ->assertOk()
            ->assertJsonCount(1, 'ratings')
            ->assertJsonPath('ratings.0.source_id', $rating->id);

        // The shared Admin/Staff frontend uses the same unified archive endpoints.
        // SQLite's legacy users CHECK constraint only permits admin/cashier/customer,
        // so this request uses the already-authenticated admin in this test suite.
        Sanctum::actingAs($admin);
        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'rating',
            'ids' => [$rating->id],
        ])
            ->assertOk()
            ->assertJsonPath('processed_ids.0', $rating->id);

        $this->assertDatabaseHas('product_ratings', [
            'id' => $rating->id,
            'is_archived' => 0,
            'archived_at' => null,
        ]);
        $this->getJson('/api/admin/ratings')
            ->assertOk()
            ->assertJsonCount(1, 'data');
        $this->getJson("/api/products/{$product->id}/reviews")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.author_name', 'Anonymous customer');
        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.review_count', 1);

        $this->patchJson('/api/admin/ratings/archive-bulk', ['ids' => [$rating->id]])
            ->assertOk();
        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'rating',
            'ids' => [$rating->id],
        ])
            ->assertOk()
            ->assertJsonPath('deleted_count', 1);

        $this->assertDatabaseMissing('product_ratings', ['id' => $rating->id]);
        Storage::disk('public')->assertMissing('product-reviews/archive.txt');
    }

    public function test_auto_delete_purges_expired_archived_reviews_and_media(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('product-reviews/expired.txt', 'expired media');
        [$customer, $order, $item, $product] = $this->makeOrderAndItem();
        $rating = ProductRating::create([
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'order_item_id' => $item->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'stars' => 4,
            'media' => [[
                'path' => 'product-reviews/expired.txt',
                'url' => '/storage/product-reviews/expired.txt',
                'type' => 'image',
            ]],
            'is_archived' => true,
            'archived_at' => now()->subDays(61),
        ]);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->postJson('/api/admin/archives/auto-delete', ['retention_days' => 60])
            ->assertOk()
            ->assertJsonPath('deleted_count', 1);

        $this->assertDatabaseMissing('product_ratings', ['id' => $rating->id]);
        Storage::disk('public')->assertMissing('product-reviews/expired.txt');
    }

    public function test_customers_cannot_archive_product_reviews(): void
    {
        [$customer, $order, $item, $product] = $this->makeOrderAndItem();
        $rating = ProductRating::create([
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'order_item_id' => $item->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'stars' => 5,
        ]);

        Sanctum::actingAs($customer);
        $this->patchJson('/api/admin/ratings/archive-bulk', ['ids' => [$rating->id]])
            ->assertForbidden();
    }

    /** @return array{0: User, 1: Order, 2: OrderItem, 3: Product} */
    private function makeOrderAndItem(): array
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $product = Product::create([
            'name' => 'Archive Test Product',
            'category' => '3D Print',
            'code' => 'ARCHIVE-REVIEW-001',
            'stock' => 5,
            'price' => 100,
            'stock_status' => 'in_stock',
            'is_blocked' => false,
        ]);
        $order = Order::create([
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 1,
            'subtotal' => 100,
            'total' => 100,
            'payment_method' => 'COD',
            'payment_reference' => 'Archive review test',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
            'completed_at' => now(),
        ]);
        $item = OrderItem::create([
            'order_id' => $order->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'unit_price' => 100,
            'quantity' => 1,
            'line_total' => 100,
        ]);

        return [$customer, $order, $item, $product];
    }
}
