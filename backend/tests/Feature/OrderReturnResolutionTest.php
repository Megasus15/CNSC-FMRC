<?php

namespace Tests\Feature;

use App\Models\{Order, OrderReturn, OrderReturnEvent, Payment, User};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{Http, Mail};
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

class OrderReturnResolutionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Http::preventStrayRequests();
        Http::fake();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
    }

    private function returnedOrder(string $status = 'item_received'): OrderReturn
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $order = Order::create([
            'order_no' => 'ORD-RESOLUTION', 'customer_id' => $customer->id,
            'customer_name' => $customer->name, 'customer_contact' => $customer->email,
            'quantity' => 1, 'subtotal' => 1, 'total' => 1, 'payment_method' => 'GCash',
            'fulfillment_type' => 'pickup', 'lifecycle_status' => 'completed', 'customer_stage' => 'completed',
        ]);
        Payment::create(['order_id' => $order->id, 'payment_no' => 'PAY-RESOLUTION', 'method' => 'GCash', 'amount' => 1, 'status' => 'paid']);
        return OrderReturn::create([
            'order_id' => $order->id, 'customer_id' => $customer->id, 'return_no' => 'RTN-RESOLUTION',
            'status' => $status, 'resolution' => 'replacement', 'reason' => 'other',
            'requested_amount' => 1, 'approved_amount' => 1,
            'decided_at' => now()->subHour(), 'item_received_at' => $status === 'item_received' ? now()->subMinute() : null,
        ]);
    }

    private function change(OrderReturn $return, array $overrides = [])
    {
        return $this->postJson('/api/admin/returns/'.$return->id.'/resolution', array_merge([
            'resolution' => 'refund', 'expected_resolution' => 'replacement',
            'note' => 'Customer agreed to a refund.',
        ], $overrides));
    }

    public function test_admin_can_correct_resolution_without_resetting_receipt_or_sending_money(): void
    {
        $return = $this->returnedOrder();
        $received = $return->item_received_at;
        $decided = $return->decided_at;
        $this->getJson('/api/admin/returns/'.$return->id)->assertOk()
            ->assertJsonPath('data.can_refund', false)->assertJsonPath('data.can_change_resolution', true);
        $this->change($return)->assertOk()->assertJsonPath('data.resolution', 'refund')
            ->assertJsonPath('data.status', 'item_received')->assertJsonPath('data.can_refund', true);
        $return->refresh();
        $this->assertTrue($received->equalTo($return->item_received_at));
        $this->assertTrue($decided->equalTo($return->decided_at));
        $this->assertSame('1.00', $return->approved_amount);
        $event = OrderReturnEvent::where('order_return_id', $return->id)->sole();
        $this->assertSame('replacement', $event->metadata['previous_resolution']);
        $this->assertSame('refund', $event->metadata['resolution']);
        $this->assertSame('admin', $event->actor_role);
        $this->assertSame('paid', $return->order->payment->status);
        $this->assertDatabaseCount('payment_refunds', 0);
        Http::assertNothingSent();
    }

    public function test_staff_and_customer_cannot_change_an_approved_resolution(): void
    {
        $return = $this->returnedOrder();
        foreach (['staff', 'customer'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            $this->change($return)->assertForbidden();
        }
        $this->assertSame('replacement', $return->fresh()->resolution);
        $this->assertDatabaseCount('order_return_events', 0);
    }

    public function test_stale_missing_reason_and_invalid_choices_do_not_change_resolution(): void
    {
        $return = $this->returnedOrder();
        $this->change($return, ['expected_resolution' => 'repair'])->assertConflict();
        $this->change($return, ['note' => ' '])->assertUnprocessable();
        $this->change($return, ['resolution' => 'anything'])->assertUnprocessable();
        $this->assertSame('replacement', $return->fresh()->resolution);
        $this->assertDatabaseCount('order_return_events', 0);
    }

    public function test_closed_and_processing_returns_cannot_change_resolution(): void
    {
        $return = $this->returnedOrder();
        foreach (['requested', 'refund_processing', 'refunded', 'cancelled', 'rejected'] as $status) {
            $return->update(['status' => $status]);
            $this->change($return)->assertUnprocessable();
            $this->getJson('/api/admin/returns/'.$return->id)->assertOk()->assertJsonPath('data.can_change_resolution', false);
        }
        Http::assertNothingSent();
    }

    public function test_initial_review_can_explicitly_approve_refund_instead_of_replacement(): void
    {
        $return = $this->returnedOrder('requested');
        $this->postJson('/api/admin/returns/'.$return->id.'/decision', [
            'decision' => 'approve', 'resolution' => 'refund', 'approved_amount' => 1, 'decision_note' => 'Refund agreed.',
        ])->assertOk()->assertJsonPath('data.resolution', 'refund')->assertJsonPath('data.status', 'approved');
        $this->assertDatabaseCount('payment_refunds', 0);
        Http::assertNothingSent();
    }

    public static function cashMethods(): array { return [['COP'], ['COD']]; }

    #[DataProvider('cashMethods')]
    public function test_cash_returns_record_manual_refunds_without_creating_online_transfers(string $method): void
    {
        $return=$this->returnedOrder();$return->update(['resolution'=>'refund']);
        $return->order->update(['payment_method'=>$method]);$return->order->payment->update(['method'=>$method]);
        $this->postJson('/api/admin/returns/'.$return->id.'/refund',[
            'stage'=>'released','refund_method'=>'cash','amount'=>1,'refund_reference'=>'CASH-RETURN-001',
        ])->assertOk()->assertJsonPath('data.status','refunded')->assertJsonPath('data.refund_method','cash');
        $this->assertSame('refunded',$return->order->payment->fresh()->status);
        $this->assertDatabaseHas('order_returns',['id'=>$return->id,'refunded_amount'=>1,'refund_reference'=>'CASH-RETURN-001']);
        $this->assertDatabaseCount('payment_refunds',0);Http::assertNothingSent();
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',0);
        Http::assertNotSent(fn($request)=>$request->method()==='POST');
    }

    public function test_manual_refund_also_requires_an_approved_refund_resolution(): void
    {
        $return = $this->returnedOrder();
        $this->postJson('/api/admin/returns/'.$return->id.'/refund', [
            'stage' => 'released', 'refund_method' => 'cash', 'amount' => 1, 'refund_reference' => 'SHOULD-NOT-SAVE',
        ])->assertUnprocessable();
        $this->assertSame('paid', $return->order->payment->status);
        $this->assertSame('item_received', $return->fresh()->status);
        $this->assertNull($return->fresh()->refunded_amount);
        Http::assertNothingSent();
    }
}
