<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminOrdersIndexPayloadTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_orders_index_does_not_embed_product_images_in_the_list_payload(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $order = Order::create([
            'order_no' => 'ORD-INDEX-IMAGE-001',
            'customer_id' => $customer->id,
            'customer_name' => 'Payload Test Customer',
            'customer_contact' => 'payload@example.test',
            'quantity' => 1,
            'subtotal' => 250,
            'total' => 250,
            'payment_method' => 'COD',
            'payment_reference' => 'Pending',
            'lifecycle_status' => 'incoming',
            'customer_stage' => 'to_pay',
        ]);

        $productImage = 'data:image/png;base64,' . str_repeat('A', 512 * 1024);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Large Embedded Image Product',
            'product_image' => $productImage,
            'unit_price' => 250,
            'quantity' => 1,
            'line_total' => 250,
        ]);

        $response = $this->getJson('/api/admin/orders');

        $response->assertOk()
            ->assertJsonPath('incoming.0.id', $order->id)
            ->assertJsonPath('incoming.0.items.0.product_name', 'Large Embedded Image Product');

        $summary = $response->json('incoming.0');
        $this->assertIsArray($summary);
        $this->assertArrayNotHasKey('product_image', $summary);
        $this->assertArrayNotHasKey('product_image', $summary['items'][0]);
        $this->assertLessThan(100_000, strlen($response->getContent()));

        Sanctum::actingAs($customer);
        $customerResponse = $this->getJson('/api/customer/orders');

        $customerResponse->assertOk();
        $this->assertSame($productImage, $customerResponse->json('data.0.product_image'));
        $this->assertSame($productImage, $customerResponse->json('data.0.items.0.product_image'));
    }
}
