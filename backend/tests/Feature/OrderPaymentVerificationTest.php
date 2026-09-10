<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderPaymentVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_and_staff_verify_payment_then_explicitly_approve_the_incoming_order(): void
    {
        foreach (['admin', 'staff'] as $role) {
            $order = $this->makeOrder();
            $operator = User::factory()->create(['role' => $role]);
            Sanctum::actingAs($operator);

            $this->patchJson($this->endpoint($order), $this->action('paid'))
                ->assertOk()
                ->assertJsonPath('order.lifecycle_status', 'incoming')
                ->assertJsonPath('order.customer_stage', 'to_pay')
                ->assertJsonPath('order.payment_awaiting_approval', true)
                ->assertJsonPath('order.payment_actions.paid.allowed', false)
                ->assertJsonPath('order.payment_actions.pending.allowed', true)
                ->assertJsonPath('order.payment_actions.refunded.allowed', false);
            $this->assertNull($order->fresh()->approved_at);
            $this->getJson('/api/admin/orders')->assertOk()->assertJsonFragment(['id' => $order->id, 'lifecycle_status' => 'incoming']);

            Sanctum::actingAs($order->customer);
            $this->getJson("/api/customer/orders/{$order->id}")
                ->assertOk()
                ->assertJsonPath('data.payment_is_confirmed', true)
                ->assertJsonPath('data.payment_awaiting_approval', true)
                ->assertJsonPath('data.customer_stage_label', 'Awaiting approval')
                ->assertJsonPath('data.awaiting_customer_payment', false)
                ->assertJsonPath('data.payment_under_review', false);

            Sanctum::actingAs($operator);
            $this->postJson("/api/admin/orders/{$order->id}/approve")
                ->assertOk()
                ->assertJsonPath('data.lifecycle_status', 'pending')
                ->assertJsonPath('data.customer_stage', 'to_ship')
                ->assertJsonPath('data.payment_awaiting_approval', false);
            $this->assertNotNull($order->fresh()->approved_at);
        }
    }

    public function test_verifying_an_already_approved_order_starts_preparation(): void
    {
        $order = $this->makeOrder(['lifecycle_status' => 'pending', 'approved_at' => now()]);
        $this->asStaff();

        $this->patchJson($this->endpoint($order), $this->action('paid'))
            ->assertOk()
            ->assertJsonPath('order.customer_stage', 'to_ship')
            ->assertJsonPath('order.lifecycle_status', 'pending');
    }

    public function test_correction_requires_a_reason_and_reopens_customer_review_without_erasing_the_receipt(): void
    {
        $order = $this->makeOrder(['lifecycle_status' => 'pending', 'customer_stage' => 'to_ship', 'approved_at' => now()], [
            'status' => 'paid', 'paid_at' => now(), 'reference' => '1234567890123', 'submitted_at' => now(), 'proof_path' => 'payment-proofs/receipt.png',
        ]);
        $this->asStaff();
        $this->patchJson($this->endpoint($order), ['status' => 'pending'])
            ->assertUnprocessable()->assertJsonValidationErrors('correction_reason');
        $reason = 'The received amount did not match this order.';
        $this->patchJson($this->endpoint($order), ['status' => 'pending', 'correction_reason' => $reason, 'expected_status' => 'paid'])
            ->assertOk()
            ->assertJsonPath('order.customer_stage', 'to_pay')
            ->assertJsonPath('order.lifecycle_status', 'pending')
            ->assertJsonPath('order.payment_under_review', true)
            ->assertJsonPath('order.awaiting_customer_payment', false);
        $payment = $order->fresh()->payment;
        $this->assertNull($payment->paid_at);
        $this->assertSame('1234567890123', $payment->reference);
        $this->assertSame('payment-proofs/receipt.png', $payment->proof_path);
        $this->assertNotNull($order->fresh()->approved_at);
        $this->assertStringContainsString($reason, $order->fresh()->latestTrackingEvent->description);

        Sanctum::actingAs($order->customer);
        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()->assertJsonPath('data.payment_under_review', true);
        $this->postJson("/api/customer/orders/{$order->id}/payment", ['payment_reference' => '9876543210987'])
            ->assertOk()->assertJsonPath('data.payment_status', 'pending');
    }

    public function test_invalid_buttons_are_also_blocked_by_the_server(): void
    {
        $this->asStaff();
        $order = $this->makeOrder();
        $this->patchJson($this->endpoint($order), $this->action('pending'))->assertUnprocessable();
        $this->patchJson($this->endpoint($order), $this->action('refunded'))->assertUnprocessable();
        $this->patchJson($this->endpoint($order), $this->action('paid'))->assertOk();
        $events = $order->trackingEvents()->count();
        $this->patchJson($this->endpoint($order), $this->action('paid'))->assertUnprocessable();
        $this->patchJson($this->endpoint($order), $this->action('refunded'))->assertUnprocessable();
        $this->assertSame($events, $order->trackingEvents()->count());
        $this->assertSame('paid', $order->fresh()->payment->status);
    }

    public function test_a_stale_tab_cannot_overwrite_a_payment_that_another_operator_changed(): void
    {
        $order = $this->makeOrder();
        $this->asStaff();
        $this->patchJson($this->endpoint($order), $this->action('paid') + ['expected_status' => 'pending'])->assertOk();
        $this->patchJson($this->endpoint($order), $this->action('pending') + ['expected_status' => 'pending'])
            ->assertStatus(409);
        $this->assertSame('paid', $order->fresh()->payment->status);
    }

    public function test_a_customer_reference_change_requires_staff_to_review_the_new_evidence(): void
    {
        $order = $this->makeOrder();
        $this->asStaff();
        $snapshot = $this->getJson("/api/admin/orders/{$order->id}")->assertOk()->json('data');
        $this->assertIsNumeric($snapshot['payment_amount']);

        Sanctum::actingAs($order->customer);
        $this->postJson("/api/customer/orders/{$order->id}/payment", ['payment_reference' => '9876543210987'])->assertOk();
        $events = $order->trackingEvents()->count();

        $this->asStaff();
        $this->patchJson($this->endpoint($order), $this->action('paid') + [
            'expected_status' => 'pending',
            'expected_reference' => $snapshot['payment_reference'],
            'expected_amount' => $snapshot['payment_amount'],
        ])->assertStatus(409);
        $this->assertSame('pending', $order->fresh()->payment->status);
        $this->assertNull($order->fresh()->payment->paid_at);
        $this->assertSame($events, $order->trackingEvents()->count());

        $this->patchJson($this->endpoint($order), $this->action('paid') + [
            'expected_status' => 'pending', 'expected_reference' => '9876543210987', 'expected_amount' => 1000,
        ])->assertOk()->assertJsonPath('order.payment_is_confirmed', true);
    }

    public function test_a_changed_payment_amount_cannot_be_confirmed_from_an_old_review(): void
    {
        $order = $this->makeOrder();
        $this->asStaff();
        $snapshot = $this->getJson("/api/admin/orders/{$order->id}")->assertOk()->json('data');
        $order->payment->update(['amount' => 1100.50]);

        $this->patchJson($this->endpoint($order), $this->action('paid') + [
            'expected_reference' => $snapshot['payment_reference'], 'expected_amount' => $snapshot['payment_amount'],
        ])->assertStatus(409);
        $this->assertSame('pending', $order->fresh()->payment->status);
        $this->assertNull($order->fresh()->payment->paid_at);

        $this->patchJson($this->endpoint($order), $this->action('paid') + [
            'expected_reference' => $snapshot['payment_reference'], 'expected_amount' => '1100.50',
        ])->assertOk()->assertJsonPath('order.payment_amount', 1100.5);
    }

    public function test_gcash_confirmation_waits_for_a_customer_claim_but_cash_does_not(): void
    {
        $this->asStaff();
        foreach (['Awaiting GCash reference', 'GCASH-LEGACY'] as $reference) {
            $order = $this->makeOrder(['payment_reference' => $reference]);
            $this->getJson("/api/admin/orders/{$order->id}")
                ->assertOk()->assertJsonPath('data.payment_actions.paid.allowed', false)
                ->assertJsonPath('data.awaiting_customer_payment', true);
            $this->patchJson($this->endpoint($order), $this->action('paid'))->assertUnprocessable();
            $this->assertNull($order->fresh()->payment->paid_at);
        }

        $cash = $this->makeOrder(['payment_method' => 'COP', 'payment_reference' => 'Cash on pickup']);
        $this->patchJson($this->endpoint($cash), $this->action('paid'))
            ->assertOk()->assertJsonPath('order.payment_is_confirmed', true)
            ->assertJsonPath('order.lifecycle_status', 'incoming');
    }

    public function test_actual_receipt_must_be_acknowledged_before_confirming(): void
    {
        $order = $this->makeOrder();
        $this->asStaff();
        foreach ([['status' => 'paid'], ['status' => 'paid', 'confirmed_received' => false]] as $payload) {
            $this->patchJson($this->endpoint($order), $payload)->assertUnprocessable()->assertJsonValidationErrors('confirmed_received');
        }
        $this->assertSame('pending', $order->fresh()->payment->status);
    }

    public function test_shipped_ready_and_completed_payments_cannot_be_unconfirmed_or_refunded_here(): void
    {
        $this->asStaff();
        foreach (['to_receive', 'completed'] as $stage) {
            $order = $this->makeOrder([
                'lifecycle_status' => $stage === 'completed' ? 'completed' : 'pending', 'customer_stage' => $stage,
            ], ['status' => 'paid', 'paid_at' => now()]);
            foreach (['pending', 'refunded'] as $action) {
                $this->patchJson($this->endpoint($order), $this->action($action))->assertUnprocessable();
            }
            $this->assertSame('paid', $order->fresh()->payment->status);
        }
    }

    public function test_cancelled_and_rejected_payments_can_only_be_closed_with_an_audited_refund(): void
    {
        foreach (['cancelled', 'rejected'] as $lifecycle) {
            foreach (['paid', 'pending'] as $status) {
                $order = $this->makeOrder(['lifecycle_status' => $lifecycle, 'cancel_refund_due' => true], [
                    'status' => $status, 'paid_at' => $status === 'paid' ? now() : null,
                    'reference' => '1234567890123', 'submitted_at' => now(),
                ]);
                $this->asStaff();
                $this->patchJson($this->endpoint($order), $this->action('paid'))->assertUnprocessable();
                $this->patchJson($this->endpoint($order), $this->action('pending'))->assertUnprocessable();
                $this->patchJson($this->endpoint($order), ['status' => 'refunded', 'refund_reference' => ' '])
                    ->assertUnprocessable()->assertJsonValidationErrors('refund_reference');
                $this->patchJson($this->endpoint($order), $this->action('refunded'))
                    ->assertOk()
                    ->assertJsonPath('order.lifecycle_status', $lifecycle)
                    ->assertJsonPath('order.cancel_refund_due', false)
                    ->assertJsonPath('order.payment_is_refunded', true)
                    ->assertJsonPath('order.payment_refund_reference', 'REFUND-123')
                    ->assertJsonPath('order.payment_actions.paid.allowed', false)
                    ->assertJsonPath('order.payment_actions.pending.allowed', false)
                    ->assertJsonPath('order.payment_actions.refunded.allowed', false);
                $this->assertNotNull($order->fresh()->payment->refunded_at);
                foreach (['paid', 'pending', 'refunded'] as $next) {
                    $this->patchJson($this->endpoint($order), $this->action($next))->assertUnprocessable();
                }
                Sanctum::actingAs($order->customer);
                $this->getJson("/api/customer/orders/{$order->id}")
                    ->assertOk()->assertJsonPath('data.awaiting_customer_payment', false)->assertJsonPath('data.payment_under_review', false);
                $this->postJson("/api/customer/orders/{$order->id}/payment", ['payment_reference' => '9876543210987'])->assertUnprocessable();
            }
        }
    }

    public function test_an_unpaid_cancelled_order_without_a_customer_claim_has_nothing_to_refund(): void
    {
        $order = $this->makeOrder(['lifecycle_status' => 'cancelled', 'payment_reference' => 'Awaiting GCash reference']);
        $this->asStaff();
        $this->patchJson($this->endpoint($order), $this->action('refunded'))->assertUnprocessable();
        $this->assertNull($order->fresh()->payment->refunded_at);
        Sanctum::actingAs($order->customer);
        $this->postJson("/api/customer/orders/{$order->id}/payment", ['payment_reference' => '9876543210987'])->assertUnprocessable();
    }

    public function test_real_provider_ids_disable_manual_changes_but_a_reference_prefix_does_not(): void
    {
        $this->asStaff();
        foreach (['paymongo_checkout_id' => 'cs_123', 'paymongo_payment_id' => 'pay_123'] as $field => $id) {
            $gateway = $this->makeOrder([], [$field => $id]);
            $this->getJson("/api/admin/orders/{$gateway->id}")
                ->assertOk()->assertJsonPath('data.payment_is_automated', true)->assertJsonPath('data.payment_actions.paid.allowed', false);
            foreach (['paid', 'pending', 'refunded'] as $next) {
                $this->patchJson($this->endpoint($gateway), $this->action($next))->assertUnprocessable();
            }
            Sanctum::actingAs($gateway->customer);
            $this->getJson("/api/customer/orders/{$gateway->id}")
                ->assertOk()->assertJsonPath('data.awaiting_customer_payment', false)
                ->assertJsonPath('data.payment_under_review', false);
            $this->postJson("/api/customer/orders/{$gateway->id}/payment", ['payment_reference' => '9876543210987'])
                ->assertUnprocessable();
            $this->asStaff();
        }
        $manual = $this->makeOrder([], ['reference' => 'GCASH-LEGACY', 'submitted_at' => now()]);
        $this->patchJson($this->endpoint($manual), $this->action('paid'))
            ->assertOk()->assertJsonPath('order.payment_is_automated', false);
    }

    public function test_legacy_refunded_rows_never_offer_customer_payment_again(): void
    {
        $order = $this->makeOrder([], ['status' => 'refunded']);
        Sanctum::actingAs($order->customer);
        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()->assertJsonPath('data.awaiting_customer_payment', false)->assertJsonPath('data.payment_under_review', false);
        $this->postJson("/api/customer/orders/{$order->id}/payment", ['payment_reference' => '9876543210987'])->assertUnprocessable();
    }

    public function test_customers_cannot_confirm_their_own_payment(): void
    {
        $order = $this->makeOrder();
        Sanctum::actingAs($order->customer);
        $this->patchJson($this->endpoint($order), $this->action('paid'))->assertForbidden();
    }

    private function asStaff(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
    }

    private function action(string $status): array
    {
        return match ($status) {
            'paid' => ['status' => $status, 'confirmed_received' => true],
            'pending' => ['status' => $status, 'correction_reason' => 'The confirmation was entered on the wrong order.'],
            'refunded' => ['status' => $status, 'refund_reference' => 'REFUND-123'],
        };
    }

    private function endpoint(Order $order): string
    {
        return "/api/admin/orders/{$order->id}/payment-status";
    }

    private function makeOrder(array $attributes = [], array $paymentAttributes = []): Order
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $order = Order::create(array_merge([
            'order_no' => 'ORD-PAY-'.fake()->unique()->numerify('######'),
            'customer_id' => $customer->id, 'customer_name' => $customer->name, 'customer_contact' => $customer->email,
            'quantity' => 1, 'subtotal' => 1000, 'total' => 1000,
            'payment_method' => 'GCash', 'payment_reference' => '1234567890123',
            'fulfillment_type' => 'pickup', 'lifecycle_status' => 'incoming', 'customer_stage' => 'to_pay',
        ], $attributes));
        Payment::create(array_merge([
            'order_id' => $order->id, 'payment_no' => 'PAY-'.$order->id, 'method' => $order->payment_method,
            'reference' => $order->payment_reference, 'amount' => 1000, 'status' => 'pending',
        ], $paymentAttributes));

        return $order->fresh();
    }
}
