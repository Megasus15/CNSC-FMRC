<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PickupCollectionTest extends TestCase
{
    use RefreshDatabase;

    private function order(): Order
    {
        Mail::fake();
        $customer = User::factory()->create(['role' => 'customer']);
        $order = Order::create(['order_no' => 'PICKUP-'.Str::random(8), 'customer_id' => $customer->id, 'customer_name' => 'Pickup customer',
            'customer_contact' => '09171234567', 'quantity' => 1, 'subtotal' => 150, 'total' => 150, 'payment_method' => 'COP', 'fulfillment_type' => 'pickup',
            'lifecycle_status' => 'pending', 'customer_stage' => 'to_receive', 'approved_at' => now(), 'pickup_ready_at' => now(), 'pickup_code' => 'FM1234']);
        Payment::create(['order_id' => $order->id, 'payment_no' => 'PAY-'.Str::random(8), 'method' => 'COP', 'amount' => 150, 'status' => 'paid', 'paid_at' => now()]);

        return $order;
    }

    public function test_admin_and_staff_collect_paid_ready_orders_once_without_changing_payment(): void
    {
        foreach (['admin', 'staff'] as $role) {
            $order = $this->order();
            $payment = $order->payment->getAttributes();
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.can_confirm_collection', true);
            $this->postJson('/api/admin/orders/'.$order->id.'/complete', ['pickup_code' => 'fm1234'])->assertOk()
                ->assertJsonPath('data.customer_stage', 'completed')->assertJsonPath('data.completion_source', 'fmrc_collection');
            $at = $order->fresh()->completed_at;
            $this->postJson('/api/admin/orders/'.$order->id.'/complete', ['pickup_code' => 'FM1234'])->assertOk();
            $this->assertTrue($at->equalTo($order->fresh()->completed_at));
            $this->patchJson('/api/admin/orders/'.$order->id.'/tracking', ['stage' => 'to_ship', 'title' => 'Go back'])->assertUnprocessable();
            $this->assertSame('completed', $order->fresh()->customer_stage);
            $this->assertSame($payment, $order->fresh()->payment->getAttributes());
            $this->assertSame(1, DB::table('order_tracking_events')->where('order_id', $order->id)->where('metadata->source', 'fmrc_collection')->count());
        }
    }

    public function test_missing_wrong_code_unpaid_or_unready_pickups_cannot_be_collected(): void
    {
        $order = $this->order();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $path = '/api/admin/orders/'.$order->id.'/complete';
        $this->postJson($path, [])->assertUnprocessable();
        $this->postJson($path, ['pickup_code' => 'WRONG'])->assertUnprocessable();
        $order->payment->update(['status' => 'pending']);
        $this->postJson($path, ['pickup_code' => 'FM1234'])->assertUnprocessable();
        $order->payment->update(['status' => 'paid']);
        $order->update(['pickup_ready_at' => null]);
        $this->postJson($path, ['pickup_code' => 'FM1234'])->assertUnprocessable();
        $this->assertSame('to_receive', $order->fresh()->customer_stage);
        $this->assertDatabaseCount('order_tracking_events', 0);
    }

    public function test_customer_or_generic_tracking_cannot_bypass_collection(): void
    {
        $order = $this->order();
        Sanctum::actingAs($order->customer);
        $this->postJson('/api/admin/orders/'.$order->id.'/complete', ['pickup_code' => 'FM1234'])->assertForbidden();
        $this->postJson('/api/customer/orders/'.$order->id.'/received')->assertConflict();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->patchJson('/api/admin/orders/'.$order->id.'/tracking', ['stage' => 'completed', 'title' => 'Collected'])->assertUnprocessable();
        $this->assertNull($order->fresh()->completed_at);
    }
}
