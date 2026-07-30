<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerOrderReceiveTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_mark_to_receive_order_as_received(): void
    {
        $customer = User::factory()->create([
            'role' => 'customer',
        ]);

        Sanctum::actingAs($customer);

        $order = Order::create([
            'customer_id' => $customer->id,
            'customer_name' => 'Test Customer',
            'customer_contact' => '09123456789',
            'quantity' => 1,
            'subtotal' => 150,
            'total' => 150,
            'payment_method' => 'COD',
            'payment_reference' => 'Pending',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_receive',
            'notes' => 'Test receive flow',
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Engraved Coaster',
            'unit_price' => 150,
            'quantity' => 1,
            'line_total' => 150,
        ]);

        $response = $this->postJson("/api/customer/orders/{$order->id}/received");

        $response->assertOk()
            ->assertJsonPath('message', 'Order marked as received.')
            ->assertJsonPath('data.customer_stage', 'completed')
            ->assertJsonPath('data.lifecycle_status', 'completed');

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'customer_stage' => 'completed',
            'lifecycle_status' => 'completed',
        ]);

        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $order->id,
            'event_type' => 'system',
            'title' => 'Order Received',
        ]);
    }

    public function test_customer_cannot_mark_non_to_receive_order_as_received(): void
    {
        $customer = User::factory()->create([
            'role' => 'customer',
        ]);

        Sanctum::actingAs($customer);

        $order = Order::create([
            'customer_id' => $customer->id,
            'customer_name' => 'Test Customer',
            'customer_contact' => '09123456789',
            'quantity' => 1,
            'subtotal' => 150,
            'total' => 150,
            'payment_method' => 'COD',
            'payment_reference' => 'Pending',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
            'notes' => 'Invalid receive stage',
        ]);

        $response = $this->postJson("/api/customer/orders/{$order->id}/received");

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Only orders in "To Receive" status can be marked as received.');

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'customer_stage' => 'to_ship',
            'lifecycle_status' => 'pending',
        ]);
    }
}
