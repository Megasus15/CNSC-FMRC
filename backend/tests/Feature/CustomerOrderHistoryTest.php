<?php

namespace Tests\Feature;

use App\Models\{Order, OrderItem, OrderReturn, OrderReturnEvent, OrderTrackingEvent, Payment, User};
use App\Support\CustomerOrderHistory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerOrderHistoryTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
        $this->customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($this->customer);
        Http::preventStrayRequests();
    }

    private function order(array $fields = [], string $paymentStatus = 'paid'): Order
    {
        $order = Order::create(array_merge(['order_no' => 'ORD-'.Str::random(10), 'customer_id' => $this->customer->id,
            'customer_name' => 'Customer', 'quantity' => 1, 'subtotal' => 150, 'total' => 150,
            'payment_method' => 'COP', 'fulfillment_type' => 'pickup', 'lifecycle_status' => 'completed',
            'customer_stage' => 'completed', 'completed_at' => now()->subDays(8)], $fields));
        OrderItem::create(['order_id' => $order->id, 'product_name' => 'Prototype', 'quantity' => 1, 'unit_price' => 150, 'line_total' => 150]);
        Payment::create(['order_id' => $order->id, 'payment_no' => 'PAY-'.$order->id, 'method' => 'COP', 'amount' => $order->total, 'status' => $paymentStatus]);
        return $order;
    }

    private function remove(Order $order)
    {
        return $this->deleteJson('/api/customer/orders/'.$order->id.'/history');
    }

    private function refund(Order $order, string $status, int $amount = 15000, array $extra = []): int
    {
        return DB::table('payment_refunds')->insertGetId(array_merge(['payment_id' => $order->payment->id, 'token' => (string) Str::uuid(),
            'provider_payment_id' => 'pay_'.$order->id, 'requested_by' => $this->customer->id, 'amount_centavos' => $amount,
            'reason' => 'Test return', 'livemode' => false, 'status' => $status, 'created_at' => now()->subDays(8), 'updated_at' => now()->subDays(8),
            'confirmed_at' => $status === 'succeeded' ? now()->subDays(8) : null], $extra));
    }

    public function test_removal_waits_seven_full_days_and_does_not_follow_ordinary_updates(): void
    {
        $order = $this->order(['completed_at' => now()->subDays(7)]);
        $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'waiting_period');
        $this->travel(1)->seconds();
        $order->update(['notes' => 'A later courier note']);
        $before = $order->fresh()->updated_at;
        $this->remove($order)->assertOk()->assertJsonPath('removed_ids.0', $order->id);
        $this->assertTrue($order->fresh()->updated_at->equalTo($before));
        $this->assertNotNull($order->fresh()->customer_hidden_at);
        $this->assertFalse($order->fresh()->is_archived);
        $this->remove($order)->assertOk()->assertJsonPath('removed_ids.0', $order->id);
        Http::assertNothingSent();
    }

    public function test_processing_orders_and_missing_closure_dates_cannot_be_removed(): void
    {
        $processing = $this->order(['customer_stage' => 'to_receive', 'lifecycle_status' => 'pending', 'completed_at' => null]);
        $this->refund($processing, 'succeeded', 1000);
        $this->remove($processing)->assertConflict()->assertJsonPath('skipped.0.code', 'in_progress');
        $missing = $this->order(['completed_at' => null]);
        $this->remove($missing)->assertConflict()->assertJsonPath('skipped.0.code', 'closure_date_missing');
        foreach ([['lifecycle_status' => 'completed', 'customer_stage' => 'to_receive'], ['lifecycle_status' => 'pending', 'customer_stage' => 'completed']] as $inconsistent) {
            $order = $this->order($inconsistent);
            $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'in_progress');
        }
    }

    public function test_unpaid_cancellations_and_rejections_are_closed_but_paid_cancellations_require_a_refund(): void
    {
        foreach (['cancelled', 'rejected'] as $status) {
            $order = $this->order(['lifecycle_status' => $status, 'customer_stage' => 'to_pay', 'completed_at' => null,
                $status === 'cancelled' ? 'cancelled_at' : 'rejected_at' => now()->subDays(8)], 'pending');
            $this->remove($order)->assertOk();
        }
        $paid = $this->order(['lifecycle_status' => 'cancelled', 'cancelled_at' => now()->subDays(8)]);
        $this->remove($paid)->assertConflict()->assertJsonPath('skipped.0.code', 'refund_due');
        $free = $this->order(['lifecycle_status' => 'cancelled', 'cancelled_at' => now()->subDays(8), 'total' => 0, 'subtotal' => 0]);
        $this->remove($free)->assertOk();
    }

    public function test_open_claims_block_removal_even_when_the_claim_was_administratively_archived(): void
    {
        $order = $this->order();
        $return = OrderReturn::create(['order_id' => $order->id, 'customer_id' => $this->customer->id,
            'status' => 'requested', 'reason' => 'damaged', 'resolution' => 'refund', 'requested_amount' => 150, 'is_archived' => true]);
        $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'return_open');
        $return->update(['status' => 'rejected', 'decided_at' => now()]);
        OrderReturnEvent::create(['order_return_id' => $return->id, 'status' => 'rejected', 'actor_role' => 'admin', 'title' => 'Request reviewed', 'occurred_at' => now()]);
        $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'waiting_period');
    }

    public function test_pending_failed_and_partial_refunds_keep_unresolved_orders_visible(): void
    {
        foreach (['requested', 'submitting', 'pending', 'unknown', 'failed', 'rejected'] as $status) {
            $order = $this->order();
            $this->refund($order, $status);
            $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'refund_unresolved');
        }
        $order = $this->order(['lifecycle_status' => 'cancelled', 'cancelled_at' => now()->subDays(10)]);
        $this->refund($order, 'succeeded', 10000);
        $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'refund_due');
    }

    public function test_confirmed_refund_restarts_waiting_period_and_successful_retry_resolves_a_failed_attempt(): void
    {
        $order = $this->order(['lifecycle_status' => 'cancelled', 'cancelled_at' => now()->subDays(20)], 'refunded');
        $order->payment->update(['refunded_at' => now()->subDays(2)]);
        $this->refund($order, 'failed');
        $this->refund($order, 'succeeded', 15000, ['confirmed_at' => now()->subDays(2)]);
        $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'waiting_period');
        $this->travel(6)->days();
        $this->remove($order)->assertOk();
        $missing = $this->order([], 'refunded');
        $this->remove($missing)->assertConflict()->assertJsonPath('skipped.0.code', 'refund_date_missing');
    }

    public function test_bulk_clear_uses_confirmed_ids_rechecks_rules_and_keeps_business_records(): void
    {
        $closed = $this->order();
        $changed = $this->order();
        $notSelected = $this->order();
        $changed->update(['cancel_state' => 'requested']);
        $this->postJson('/api/customer/orders/history/clear', ['order_ids' => [$closed->id, $changed->id]])->assertOk()
            ->assertJsonPath('removed_ids', [$closed->id])->assertJsonPath('skipped.0.id', $changed->id);
        $this->assertNull($notSelected->fresh()->customer_hidden_at);
        $this->assertNull($changed->fresh()->customer_hidden_at);
        $this->assertDatabaseCount('orders', 3);
        $this->assertDatabaseCount('payments', 3);
        $this->assertDatabaseCount('order_items', 3);
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('counts.all', 2);
        $this->getJson('/api/customer/orders/'.$closed->id)->assertStatus(410)->assertJsonPath('code', 'order_history_removed');
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->getJson('/api/admin/orders/'.$closed->id)->assertOk()->assertJsonPath('data.id', $closed->id);
    }

    public function test_other_accounts_and_staff_cannot_remove_customer_history(): void
    {
        $order = $this->order();
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->remove($order)->assertForbidden();
        $this->postJson('/api/customer/orders/history/clear', ['order_ids' => [$order->id]])->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->remove($order)->assertForbidden();
        $this->assertNull($order->fresh()->customer_hidden_at);
    }

    public function test_hidden_return_history_is_not_exposed_and_etags_change(): void
    {
        $order = $this->order();
        $return = OrderReturn::create(['order_id' => $order->id, 'customer_id' => $this->customer->id, 'status' => 'refunded',
            'reason' => 'damaged', 'resolution' => 'refund', 'requested_amount' => 150, 'refunded_amount' => 150, 'refunded_at' => now()->subDays(8)]);
        $before = $this->getJson('/api/customer/orders')->assertOk();
        $this->remove($order)->assertOk();
        $this->getJson('/api/customer/orders', ['If-None-Match' => $before->headers->get('ETag')])->assertOk()
            ->assertJsonPath('data', [])->assertJsonPath('returns', [])->assertJsonPath('counts.all', 0);
        $this->getJson('/api/customer/returns')->assertOk()->assertJsonPath('data', []);
        $this->getJson('/api/customer/returns/'.$return->id)->assertStatus(410);
        $this->assertDatabaseHas('order_returns', ['id' => $return->id]);
    }

    public function test_unreconciled_checkout_and_duplicate_payment_balances_block_removal(): void
    {
        $order = $this->order(['lifecycle_status' => 'cancelled', 'cancelled_at' => now()->subDays(10)], 'pending');
        $attempt = DB::table('payment_attempts')->insertGetId(['payment_id' => $order->payment->id, 'token' => (string) Str::uuid(),
            'livemode' => false, 'amount_centavos' => 15000, 'status' => 'pending', 'expires_at' => now()->subDays(8)]);
        $this->remove($order)->assertConflict()->assertJsonPath('skipped.0.code', 'payment_review');
        DB::table('payment_attempts')->where('id', $attempt)->update(['status' => 'expired']);
        $this->remove($order)->assertOk();

        $duplicate = $this->order(['lifecycle_status' => 'cancelled', 'cancelled_at' => now()->subDays(10)], 'refunded');
        $a = DB::table('payment_attempts')->insertGetId(['payment_id' => $duplicate->payment->id, 'token' => (string) Str::uuid(),
            'livemode' => false, 'amount_centavos' => 15000, 'status' => 'paid', 'confirmed_at' => now()->subDays(9)]);
        foreach (['pay_'.$duplicate->id, 'pay_duplicate'] as $id) DB::table('payment_receipts')->insert([
            'payment_id' => $duplicate->payment->id, 'attempt_id' => $a, 'provider_payment_id' => $id,
            'amount_centavos' => 15000, 'livemode' => false, 'confirmed_at' => now()->subDays(9)]);
        $this->refund($duplicate, 'succeeded');
        $this->remove($duplicate)->assertConflict()->assertJsonPath('skipped.0.code', 'refund_due');
        $this->refund($duplicate, 'succeeded', 15000, ['provider_payment_id' => 'pay_duplicate']);
        $this->remove($duplicate)->assertOk();
    }
}
