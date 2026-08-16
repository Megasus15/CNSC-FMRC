<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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

        $productImageBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
            . str_repeat('A', 512 * 1024);
        $productImage = 'data:image/png;base64,' . base64_encode($productImageBytes);

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
        $this->assertStringContainsString(
            'no-cache',
            (string) $customerResponse->headers->get('Cache-Control'),
        );

        $customerSummary = $customerResponse->json('data.0');
        $this->assertIsArray($customerSummary);
        $this->assertArrayNotHasKey('product_image', $customerSummary);
        $this->assertArrayNotHasKey('product_image', $customerSummary['items'][0]);
        $this->assertStringContainsString(
            "/customer/orders/{$order->id}/items/{$customerSummary['items'][0]['id']}/image?thumbnail=1",
            $customerSummary['product_image_endpoint'],
        );
        $this->assertSame(
            "/customer/orders/{$order->id}/items/{$customerSummary['items'][0]['id']}/image",
            $customerSummary['product_image_full_endpoint'],
        );
        $this->assertLessThan(100_000, strlen($customerResponse->getContent()));

        $detailResponse = $this->getJson("/api/customer/orders/{$order->id}");
        $detailResponse->assertOk();
        $detailEtag = $detailResponse->headers->get('ETag');
        $this->assertNotEmpty($detailEtag);
        $detail = $detailResponse->json('data');
        $this->assertArrayNotHasKey('product_image', $detail);
        $this->assertArrayNotHasKey('product_image', $detail['items'][0]);
        $this->assertSame(
            $customerSummary['product_image_full_endpoint'],
            $detail['items'][0]['product_image_full_endpoint'],
        );
        $this->assertLessThan(100_000, strlen($detailResponse->getContent()));

        $this->flushHeaders();
        $this
            ->withHeader('If-None-Match', $detailEtag)
            ->getJson("/api/customer/orders/{$order->id}")
            ->assertStatus(304)
            ->assertHeader('ETag', $detailEtag);

        $imagePath = '/api' . $customerSummary['product_image_full_endpoint'];
        $imageResponse = $this->get($imagePath);
        $imageResponse->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->assertSame($productImageBytes, $imageResponse->getContent());
    }

    public function test_customer_orders_support_conditional_realtime_refreshes(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        $order = Order::create([
            'order_no' => 'ORD-REALTIME-001',
            'customer_id' => $customer->id,
            'customer_name' => 'Realtime Customer',
            'customer_contact' => 'realtime@example.test',
            'quantity' => 1,
            'subtotal' => 250,
            'total' => 250,
            'payment_method' => 'COD',
            'payment_reference' => 'Pending',
            'lifecycle_status' => 'incoming',
            'customer_stage' => 'to_pay',
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Realtime Product',
            'unit_price' => 250,
            'quantity' => 1,
            'line_total' => 250,
        ]);

        $firstResponse = $this->getJson('/api/customer/orders');
        $firstResponse->assertOk();
        $etag = $firstResponse->headers->get('ETag');
        $this->assertNotEmpty($etag);

        $this->flushHeaders();
        $corsResponse = $this
            ->withHeader('Origin', 'http://127.0.0.1:5500')
            ->getJson('/api/customer/orders');
        $corsResponse
            ->assertOk()
            ->assertHeader('Access-Control-Expose-Headers', 'etag');

        $this->flushHeaders();
        $notModifiedResponse = $this
            ->withHeader('If-None-Match', $etag)
            ->getJson('/api/customer/orders');
        $notModifiedResponse
            ->assertStatus(304)
            ->assertHeader('ETag', $etag);

        $this->flushHeaders();
        $order->update([
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
        ]);

        $updatedResponse = $this
            ->withHeader('If-None-Match', $etag)
            ->getJson('/api/customer/orders');
        $updatedResponse
            ->assertOk()
            ->assertJsonPath('data.0.customer_stage', 'to_ship');
        $this->assertNotSame($etag, $updatedResponse->headers->get('ETag'));
    }

    public function test_customer_order_thumbnails_are_lazy_and_owner_protected(): void
    {
        Storage::fake('local');

        $customer = User::factory()->create(['role' => 'customer']);
        $otherCustomer = User::factory()->create(['role' => 'customer']);
        $order = Order::create([
            'order_no' => 'ORD-THUMB-001',
            'customer_id' => $customer->id,
            'customer_name' => 'Thumbnail Customer',
            'customer_contact' => 'thumb@example.test',
            'quantity' => 1,
            'subtotal' => 100,
            'total' => 100,
            'payment_method' => 'COD',
            'payment_reference' => 'Pending',
            'lifecycle_status' => 'incoming',
            'customer_stage' => 'to_pay',
        ]);
        $item = OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Thumbnail Product',
            'product_image' => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'unit_price' => 100,
            'quantity' => 1,
            'line_total' => 100,
        ]);

        $path = "/api/customer/orders/{$order->id}/items/{$item->id}/image?thumbnail=1";

        Sanctum::actingAs($customer);
        $thumbnailResponse = $this->get($path);
        $thumbnailResponse->assertOk();
        $this->assertStringStartsWith('image/', (string) $thumbnailResponse->headers->get('Content-Type'));
        $dimensions = getimagesizefromstring($thumbnailResponse->getContent());
        $this->assertSame(240, $dimensions[0]);
        $this->assertSame(240, $dimensions[1]);

        $cachedThumbnailBytes = $thumbnailResponse->getContent();
        $this->assertCount(
            1,
            Storage::disk('local')->allFiles('order-thumbnails/items'),
        );

        // A cached request must not need the large database snapshot again.
        // Query builder updates do not touch updated_at, so the item cache key
        // remains stable while this proves the fast path is self-contained.
        DB::table('order_items')
            ->where('id', $item->id)
            ->update(['product_image' => null]);
        $cachedThumbnailResponse = $this->get($path);
        $cachedThumbnailResponse->assertOk();
        $this->assertSame(
            $cachedThumbnailBytes,
            $cachedThumbnailResponse->getContent(),
        );

        Sanctum::actingAs($otherCustomer);
        $this->get($path)->assertForbidden();
    }
}
