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

    public function test_customer_receipt_route_is_retired_without_modifying_the_order(): void
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

        $response->assertConflict()->assertJsonPath('code', 'order_completion_managed');
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'customer_stage' => 'to_receive', 'lifecycle_status' => 'pending']);
        $this->assertDatabaseCount('order_tracking_events', 0);
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

        $response->assertConflict()->assertJsonPath('code', 'order_completion_managed');

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'customer_stage' => 'to_ship',
            'lifecycle_status' => 'pending',
        ]);
    }
}
