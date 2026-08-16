<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductRating;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductRatingReviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_submit_one_review_per_order_item_and_load_them_together(): void
    {
        Storage::fake('public');
        [$customer, $order, $items] = $this->makeCompletedOrder(2);
        Sanctum::actingAs($customer);

        $first = $this->post("/api/customer/orders/{$order->id}/rating", [
            'order_item_id' => $items[0]->id,
            'stars' => 4,
            'feedback' => 'The first product arrived in excellent condition and worked well.',
            'post_anonymously' => '1',
            'media' => [UploadedFile::fake()->image('first-review.jpg')],
        ]);

        $first
            ->assertOk()
            ->assertJsonPath('data.order_item_id', $items[0]->id)
            ->assertJsonPath('data.is_anonymous', true);

        $second = $this->postJson("/api/customer/orders/{$order->id}/rating", [
            'order_item_id' => $items[1]->id,
            'stars' => 5,
            'post_anonymously' => '0',
        ]);

        $second->assertOk()->assertJsonPath('data.order_item_id', $items[1]->id);
        $this->assertDatabaseCount('product_ratings', 2);
        $this->assertDatabaseHas('product_ratings', [
            'user_id' => $customer->id,
            'order_item_id' => $items[0]->id,
            'is_anonymous' => 1,
        ]);

        $this->getJson("/api/customer/orders/{$order->id}/rating")
            ->assertOk()
            ->assertJsonCount(2, 'data');

        $storedFiles = Storage::disk('public')->allFiles('product-reviews');
        $this->assertNotEmpty($storedFiles);
        Storage::disk('public')->assertExists($storedFiles[0]);
    }

    public function test_public_reviews_filter_visuals_and_stars_and_hide_anonymous_identity(): void
    {
        [$customer, $order, $items] = $this->makeCompletedOrder(2);
        Sanctum::actingAs($customer);

        $this->postJson("/api/customer/orders/{$order->id}/rating", [
            'order_item_id' => $items[0]->id,
            'stars' => 4,
            'feedback' => 'A useful review with enough detail for other customers to read.',
            'post_anonymously' => true,
        ])->assertOk();

        $this->postJson("/api/customer/orders/{$order->id}/rating", [
            'order_item_id' => $items[1]->id,
            'stars' => 2,
            'feedback' => 'This product did not meet the expected result after delivery.',
            'post_anonymously' => false,
        ])->assertOk();

        $this->getJson("/api/products/{$items[0]->product_id}/reviews?stars=4")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.author_name', 'Anonymous customer')
            ->assertJsonPath('data.0.is_anonymous', true)
            ->assertJsonMissing(['author_name' => $customer->name])
            ->assertJsonPath('data.0.stars', 4);

        $this->getJson("/api/products/{$items[1]->product_id}/reviews?stars=4")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_blank_optional_feedback_is_saved_as_null_when_stars_are_complete(): void
    {
        [$customer, $order, $items] = $this->makeCompletedOrder(1);
        Sanctum::actingAs($customer);

        $this->postJson("/api/customer/orders/{$order->id}/rating", [
            'order_item_id' => $items[0]->id,
            'stars' => 5,
            'feedback' => '',
            'post_anonymously' => false,
        ])
            ->assertOk()
            ->assertJsonPath('data.stars', 5)
            ->assertJsonPath('data.feedback', null);

        $this->assertDatabaseHas('product_ratings', [
            'user_id' => $customer->id,
            'order_item_id' => $items[0]->id,
            'stars' => 5,
            'feedback' => null,
        ]);
    }

    public function test_public_and_admin_review_lists_are_paginated_at_ten_rows(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $product = Product::create([
            'name' => 'Paginated Review Product',
            'category' => '3D Print',
            'code' => 'REV-PAGE-001',
            'stock' => 20,
            'price' => 150,
            'stock_status' => 'in_stock',
            'is_blocked' => false,
        ]);

        foreach (range(1, 11) as $index) {
            $order = Order::create([
                'customer_id' => $customer->id,
                'customer_name' => $customer->name,
                'customer_contact' => $customer->email,
                'quantity' => 1,
                'subtotal' => 150,
                'total' => 150,
                'payment_method' => 'COD',
                'payment_reference' => "Review page {$index}",
                'lifecycle_status' => 'completed',
                'customer_stage' => 'completed',
                'completed_at' => now(),
            ]);
            $item = OrderItem::create([
                'order_id' => $order->id,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'unit_price' => 150,
                'quantity' => 1,
                'line_total' => 150,
            ]);

            ProductRating::create([
                'user_id' => $customer->id,
                'order_id' => $order->id,
                'order_item_id' => $item->id,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'stars' => (($index - 1) % 5) + 1,
                'feedback' => "Pagination review number {$index} has enough useful detail.",
                'is_anonymous' => $index % 2 === 0,
            ]);
        }

        $this->getJson("/api/products/{$product->id}/reviews?page=1")
            ->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.total', 11);

        $this->getJson("/api/products/{$product->id}/reviews?page=2")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.current_page', 2);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $this->getJson('/api/admin/ratings?page=1')
            ->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.total', 11);

        $this->getJson('/api/admin/ratings?page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.current_page', 2);
    }

    public function test_customer_can_toggle_a_persistent_review_like_and_admin_sees_real_identity(): void
    {
        [$customer, $order, $items] = $this->makeCompletedOrder(1);
        Sanctum::actingAs($customer);

        $ratingResponse = $this->postJson("/api/customer/orders/{$order->id}/rating", [
            'order_item_id' => $items[0]->id,
            'stars' => 5,
            'feedback' => 'This review is long enough to verify the saved product feedback.',
            'post_anonymously' => true,
        ])->assertOk();

        $ratingId = $ratingResponse->json('data.id');

        $this->postJson("/api/products/{$items[0]->product_id}/reviews/{$ratingId}/like")
            ->assertOk()
            ->assertJsonPath('data.liked', true)
            ->assertJsonPath('data.likes_count', 1);

        $this->postJson("/api/products/{$items[0]->product_id}/reviews/{$ratingId}/like")
            ->assertOk()
            ->assertJsonPath('data.liked', false)
            ->assertJsonPath('data.likes_count', 0);

        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/ratings')
            ->assertOk()
            ->assertJsonPath('data.0.user.name', $customer->name)
            ->assertJsonPath('data.0.is_anonymous', true)
            ->assertJsonPath('data.0.product_name', $items[0]->product_name);
    }

    /** @return array{0: User, 1: Order, 2: array<int, OrderItem>} */
    private function makeCompletedOrder(int $itemCount): array
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $order = Order::create([
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => $itemCount,
            'subtotal' => 300,
            'total' => 300,
            'payment_method' => 'COD',
            'payment_reference' => 'Test payment',
            'lifecycle_status' => 'completed',
            'customer_stage' => 'completed',
            'completed_at' => now(),
        ]);

        $items = [];
        for ($index = 1; $index <= $itemCount; $index++) {
            $product = Product::create([
                'name' => "Review Product {$index}",
                'category' => '3D Print',
                'code' => "REV-{$order->id}-{$index}",
                'stock' => 10,
                'price' => 150,
                'stock_status' => 'in_stock',
                'is_blocked' => false,
            ]);

            $items[] = OrderItem::create([
                'order_id' => $order->id,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'unit_price' => 150,
                'quantity' => 1,
                'line_total' => 150,
            ]);
        }

        return [$customer, $order, $items];
    }
}
