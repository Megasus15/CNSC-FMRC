<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * When a customer may still call an order off, and when they may not.
 *
 * The cut-off is FMRC accepting the order. Up to that point nothing has been
 * made, so cancelling costs nobody anything. From To Ship onwards a staff member
 * has pulled stock, started engraving or printing, or packed a parcel, and the
 * item is personalised - there is no shelf to put it back on. So the button
 * disappears at that point instead of turning into a request that staff have to
 * sit down and decide.
 *
 * Money is the one thing that stops an outright cancel inside To Pay: a
 * confirmed GCash payment has to be sent back by hand out of FMRC's own wallet,
 * so a human approves it. An unpaid order closes on the spot.
 *
 * The customer's UI is entirely server-driven - the button reads
 * `can_request_cancel` and `cancel_is_immediate` off the payload - so these
 * assertions cover the screen as well as the endpoint.
 */
class OrderCancellationRulesTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_unpaid_to_pay_order_can_be_cancelled_outright(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'to_pay');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.can_request_cancel', true)
            ->assertJsonPath('data.cancel_is_immediate', true)
            ->assertJsonPath('data.cancel_blocked_reason', null);

        $this->postJson("/api/customer/orders/{$order->id}/cancel", [
            'reason' => 'ordered_by_mistake',
        ])->assertOk();

        $order->refresh();
        $this->assertSame('cancelled', $order->lifecycle_status);
        $this->assertSame('approved', $order->cancel_state);
        $this->assertNotNull($order->cancelled_at);
    }

    public function test_a_paid_to_pay_order_becomes_a_request_instead(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'to_pay', paymentStatus: 'paid');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.can_request_cancel', true)
            // Still allowed, but not on the spot: the refund leaves FMRC's own
            // GCash by hand, so a staff member decides.
            ->assertJsonPath('data.cancel_is_immediate', false);

        $this->postJson("/api/customer/orders/{$order->id}/cancel", [
            'reason' => 'change_payment_method',
        ])->assertOk();

        $order->refresh();
        $this->assertSame('requested', $order->cancel_state);
        $this->assertNotSame('cancelled', $order->lifecycle_status);
        $this->assertNotNull($order->cancel_requested_at);
    }

    public function test_an_accepted_order_can_no_longer_be_cancelled(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'to_ship');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.can_request_cancel', false)
            ->assertJsonPath('data.cancel_is_immediate', false)
            ->assertJsonPath(
                'data.cancel_blocked_reason',
                'FMRC has accepted this order and is already preparing it, so it can no longer be cancelled here. Message FMRC if something needs to change.',
            );

        // The endpoint enforces the same rule, so a stale tab cannot slip one
        // through by keeping a button the server has withdrawn.
        $this->postJson("/api/customer/orders/{$order->id}/cancel", [
            'reason' => 'no_longer_needed',
        ])->assertStatus(422);

        $order->refresh();
        $this->assertSame('none', $order->cancel_state);
        $this->assertNotSame('cancelled', $order->lifecycle_status);
    }

    public function test_a_parcel_already_moving_is_refused_in_its_own_words(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'to_receive');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.can_request_cancel', false)
            ->assertJsonPath(
                'data.cancel_blocked_reason',
                'This order is already on its way, so it can no longer be cancelled. You can refuse the delivery or file a return once it arrives.',
            );
    }

    public function test_a_pickup_order_waiting_at_the_counter_is_not_told_it_is_shipping(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'to_receive', fulfillment: 'pickup');

        // A pickup order is never "on its way" - it is sitting on the FMRC
        // counter, and saying otherwise sends the customer to wait for a courier
        // nobody booked.
        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.can_request_cancel', false)
            ->assertJsonPath(
                'data.cancel_blocked_reason',
                'This order is already waiting for you at FMRC, so it can no longer be cancelled here. Message FMRC if you can no longer collect it.',
            );
    }

    public function test_only_to_pay_is_cancellable(): void
    {
        // The one line the whole rule rests on. Kept as its own assertion so a
        // future stage added back to this list has to be a deliberate edit.
        $this->assertSame(['to_pay'], Order::CANCELLABLE_STAGES);
    }

    public function test_a_completed_order_is_pointed_at_returns_instead(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'completed', lifecycle: 'completed');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.can_request_cancel', false)
            ->assertJsonPath(
                'data.cancel_blocked_reason',
                'This order is already completed. Use Return / Refund instead.',
            );
    }

    public function test_the_reason_list_the_sheet_offers_is_the_list_the_api_accepts(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, 'to_pay');

        // Sent once for the whole list rather than per order - the sheet is the
        // same sheet whichever card opened it.
        $response = $this->getJson('/api/customer/orders')->assertOk();
        $offered = collect($response->json('cancel_reason_options'))
            ->pluck('value')
            ->all();

        $this->assertSame(Order::CANCEL_REASONS, $offered);

        // "Other" is the only reason that needs typing, and an empty box is
        // refused rather than filed as a blank reason staff cannot act on.
        $this->postJson("/api/customer/orders/{$order->id}/cancel", [
            'reason' => 'other',
        ])->assertStatus(422);

        $this->postJson("/api/customer/orders/{$order->id}/cancel", [
            'reason' => 'other',
            'reason_detail' => 'Ordered the wrong campus logo.',
        ])->assertOk();

        $this->assertSame('other', $order->fresh()->cancel_reason);
    }

    private function actingAsCustomer(): User
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        return $customer;
    }

    private function makeOrder(
        User $customer,
        string $stage,
        string $fulfillment = 'delivery',
        string $lifecycle = 'pending',
        ?string $paymentStatus = null,
    ): Order {
        $orderNo = 'ORD-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT);

        $order = Order::create([
            'order_no' => $orderNo,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => '09171234567',
            'quantity' => 1,
            'subtotal' => 150,
            'total' => 150,
            'payment_method' => 'GCash',
            'payment_reference' => 'Paid',
            'lifecycle_status' => $lifecycle,
            'customer_stage' => $stage,
            'cancel_state' => 'none',
            'fulfillment_type' => $fulfillment,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Engraved Keychain',
            'unit_price' => 150,
            'quantity' => 1,
            'line_total' => 150,
        ]);

        if ($paymentStatus !== null) {
            Payment::create([
                'order_id' => $order->id,
                'payment_no' => 'PAY-'.$orderNo,
                'method' => 'GCash',
                'reference' => '1234567890',
                'amount' => $order->total,
                'status' => $paymentStatus,
            ]);
        }

        return $order->fresh();
    }
}
