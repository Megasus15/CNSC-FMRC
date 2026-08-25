<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderTrackingEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Two fulfillment types, two vocabularies.
 *
 * The four stages in the database are shared - to_pay, to_ship, to_receive,
 * completed - but half of those words only make sense for a parcel that moves.
 * A pickup order is never shipped and never delivered: it is packed for the FMRC
 * counter and then waits there. Telling a customer their pickup order is "out
 * for delivery" sends them home to wait for a courier that was never booked, so
 * the server names the stages per order and everything else - the customer's
 * chip, the admin table, the staff tracking dropdown - reads its wording from
 * that one place.
 */
class OrderFulfillmentStageLabelsTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_delivery_order_keeps_the_courier_wording(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'delivery', 'to_receive');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.is_pickup', false)
            ->assertJsonPath('data.customer_stage_label', 'To Receive')
            ->assertJsonPath('data.stage_labels.to_ship', 'To Ship')
            ->assertJsonPath('data.stage_labels.to_receive', 'To Receive');
    }

    public function test_a_pickup_order_is_named_for_the_counter_it_waits_at(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'pickup', 'to_receive');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.is_pickup', true)
            ->assertJsonPath('data.customer_stage_label', 'Ready for Pickup')
            ->assertJsonPath('data.stage_labels.to_ship', 'Preparing')
            ->assertJsonPath('data.stage_labels.to_receive', 'Ready for Pickup')
            // The first and last stage mean the same thing either way, and they
            // are also the tab names the customer filters by - renaming them
            // would leave the chip disagreeing with the tab holding it.
            ->assertJsonPath('data.stage_labels.to_pay', 'To Pay')
            ->assertJsonPath('data.stage_labels.completed', 'Completed');
    }

    public function test_a_legacy_cash_on_pickup_order_still_gets_pickup_wording(): void
    {
        // Orders taken before `fulfillment_type` existed are covered twice. The
        // migration backfills every Cash-on-Pickup row to `pickup`, and because
        // the column is NOT NULL with a `delivery` default a stored row can
        // never read null afterwards - so the backfill is what real legacy data
        // relies on, and this is the row it leaves behind.
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'pickup', 'to_receive', 'COP');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.customer_stage_label', 'Ready for Pickup');

        // The second cover is `Order::isPickup()` inferring the same thing from
        // the payment method whenever the column is unset - a raw insert, or an
        // order built in memory before the backfill has run. Cash-on-Pickup is
        // the one legacy method that never shipped; Cash-on-Delivery always did.
        $this->assertTrue((new Order(['payment_method' => 'COP']))->isPickup());
        $this->assertFalse((new Order(['payment_method' => 'COD']))->isPickup());
    }

    public function test_timeline_rows_are_named_for_the_order_they_belong_to(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'pickup', 'to_receive');

        // The event stores the stage key only. Whether that key reads "To
        // Receive" or "Ready for Pickup" is a property of the order, which is
        // why the row cannot name itself.
        OrderTrackingEvent::create([
            'order_id' => $order->id,
            'stage' => 'to_receive',
            'event_type' => 'admin_update',
            'title' => 'Order is ready for pickup at the FMRC office',
            'occurred_at' => now(),
        ]);

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.timeline.0.stage', 'to_receive')
            ->assertJsonPath('data.timeline.0.stage_label', 'Ready for Pickup')
            ->assertJsonPath('data.latest_event.stage_label', 'Ready for Pickup');
    }

    public function test_staff_advancing_a_pickup_order_never_writes_delivery_wording(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $order = $this->makeOrder($customer, 'pickup', 'to_ship');

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        // No title supplied: the server writes the default one, and that default
        // is where "Order is out for delivery" would leak onto a pickup order.
        $this->patchJson("/api/admin/orders/{$order->id}/tracking", [
            'stage' => 'to_receive',
        ])->assertOk();

        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $order->id,
            'stage' => 'to_receive',
            'title' => 'Order is ready for pickup at the FMRC office',
        ]);

        // Reaching "ready" is also the moment the counter needs a code to ask
        // the customer for, and the moment the waiting time starts.
        $fresh = $order->fresh();
        $this->assertNotNull($fresh->pickup_code);
        $this->assertNotNull($fresh->pickup_ready_at);
    }

    public function test_a_customer_collecting_a_pickup_order_stamps_the_handover(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'pickup', 'to_receive');

        $this->postJson("/api/customer/orders/{$order->id}/received")
            ->assertOk()
            ->assertJsonPath('data.customer_stage', 'completed');

        // The customer pressing the button *is* the handover for a pickup, so
        // `picked_up_at` has to be stamped here too. Left to `updateTracking`
        // alone it would only ever be filled on orders staff closed by hand.
        $this->assertNotNull($order->fresh()->picked_up_at);

        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $order->id,
            'title' => 'Order collected',
        ]);
    }

    public function test_a_delivery_order_keeps_the_received_wording_on_handover(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'delivery', 'to_receive');

        $this->postJson("/api/customer/orders/{$order->id}/received")->assertOk();

        $this->assertNull($order->fresh()->picked_up_at);

        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $order->id,
            'title' => 'Order Received',
        ]);
    }

    public function test_the_refusal_quotes_the_stage_name_the_customer_can_see(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'pickup', 'to_ship');

        // Naming a chip the customer cannot find is worse than saying nothing:
        // a pickup order has no "To Receive" stage on screen.
        $this->postJson("/api/customer/orders/{$order->id}/received")
            ->assertStatus(422)
            ->assertJsonPath(
                'message',
                'Only orders in "Ready for Pickup" status can be marked as received.',
            );
    }

    private function actingAsCustomer(): User
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        return $customer;
    }

    private function makeOrder(
        User $customer,
        string $fulfillmentType,
        string $stage,
        string $method = 'GCash',
    ): Order {
        $order = Order::create([
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => '09171234567',
            'quantity' => 1,
            'subtotal' => 150,
            'total' => 150,
            'payment_method' => $method,
            'payment_reference' => 'Paid',
            'lifecycle_status' => 'pending',
            'customer_stage' => $stage,
            'fulfillment_type' => $fulfillmentType,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Engraved Keychain',
            'unit_price' => 150,
            'quantity' => 1,
            'line_total' => 150,
        ]);

        return $order->fresh();
    }
}
