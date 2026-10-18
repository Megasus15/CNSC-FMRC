<?php

namespace Tests\Feature;

use App\Models\{Order, OrderItem, OrderTrackingEvent, Payment, Product, User};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\{DB, Http, Mail};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Mime\Email;
use Tests\TestCase;

class OrderRejectionReasonTest extends TestCase
{
    use RefreshDatabase;

    private array $emails = [];

    protected function setUp(): void
    {
        parent::setUp(); Http::preventStrayRequests();
        Mail::shouldReceive('html')->andReturnUsing(function ($html, $callback) {
            $message = new Message(new Email()); $callback($message);
            $this->emails[] = ['html'=>$html,'to'=>$message->getSymfonyMessage()->getTo()[0]->getAddress()];
        });
    }

    private function order(): Order
    {
        $customer=User::factory()->create(['role'=>'customer']);
        $product=Product::create(['name'=>'Engraved Coaster', 'code'=>'REJ-'.Str::random(8), 'category'=>'Fabrication', 'stock'=>3, 'price'=>10, 'unit_price'=>10]);
        $order=Order::create(['order_no'=>'ORD-'.Str::random(10), 'customer_id'=>$customer->id,
            'customer_name'=>$customer->name, 'customer_contact'=>$customer->email, 'quantity'=>2,
            'subtotal'=>20, 'total'=>20, 'payment_method'=>'COP', 'fulfillment_type'=>'pickup',
            'lifecycle_status'=>'incoming', 'customer_stage'=>'to_pay', 'notes'=>'Customer instruction: Handle with care.']);
        OrderItem::create(['order_id'=>$order->id, 'product_id'=>$product->id, 'product_name'=>$product->name, 'quantity'=>2, 'unit_price'=>10, 'line_total'=>20]);
        Payment::create(['order_id'=>$order->id,'payment_no'=>'PAY-'.$order->id,'method'=>'COP','amount'=>20,'status'=>'pending','reference'=>'Pay at pickup']);
        return $order;
    }

    public static function rolesAndActions(): array
    {
        return [['admin',false], ['staff',false], ['admin',true], ['staff',true]];
    }
    public static function invalidReasons(): array
    {
        return [[null], [''], [" \n\t "], [str_repeat('a',501)], [['invalid']]];
    }

    #[DataProvider('rolesAndActions')]
    public function test_reason_reaches_only_the_order_owner_in_timeline_email_and_notification(string $role, bool $bulk): void
    {
        $order=$this->order(); $second=$bulk?$this->order():null;
        $actor=User::factory()->create(['role'=>$role]); Sanctum::actingAs($actor);
        $reason="  The requested <material> is unavailable.\n Please contact FMRC for alternatives.  ";
        $expected='The requested <material> is unavailable. Please contact FMRC for alternatives.';
        $ids=$second?[$order->id,$second->id]:[$order->id];
        $endpoint=$bulk?'/api/admin/orders/reject-bulk':'/api/admin/orders/'.$order->id.'/reject';
        $body=['reason'=>$reason]+($bulk?['ids'=>$ids]:[]);
        $this->postJson($endpoint,$body)->assertOk();
        foreach (array_filter([$order,$second]) as $rejected) {
            $this->assertSame('rejected',$rejected->fresh()->lifecycle_status);
            $this->assertSame($expected,$rejected->fresh()->rejectionReason());
            $this->assertStringContainsString('Customer instruction: Handle with care.', $rejected->fresh()->notes);
            $this->assertDatabaseHas('order_tracking_events',['order_id'=>$rejected->id,'created_by_user_id'=>$actor->id,'title'=>'Order rejected','description'=>$expected]);
            $this->assertSame(5,$rejected->items->first()->product->fresh()->stock);
            $alert=DB::table('customer_notifications')->where('user_id',$rejected->customer_id)->where('message','like','%Reason:%')->first();
            $this->assertNotNull($alert); $this->assertStringContainsString($expected,$alert->message);
            $this->assertStringContainsString('order_id='.$rejected->id,$alert->target);
            $matching=collect($this->emails)->firstWhere('to',$rejected->customer->email);
            $this->assertNotNull($matching); $this->assertStringContainsString(e($expected),$matching['html']);
            $this->assertStringNotContainsString('<material>',$matching['html']);
            $this->assertStringContainsString('Rejected',$matching['html']);
            Sanctum::actingAs($rejected->customer);
            $this->getJson('/api/customer/orders/'.$rejected->id)->assertOk()->assertJsonFragment(['description'=>$expected]);
            Sanctum::actingAs($actor);
        }
        // A repeated action cannot restore inventory, notify or create refunds twice.
        if (!$bulk) $this->postJson($endpoint,$body)->assertUnprocessable();
        $this->assertDatabaseCount('order_tracking_events',count($ids));
        $this->assertDatabaseCount('payment_refunds',0); Http::assertNothingSent();
    }

    #[DataProvider('invalidReasons')]
    public function test_missing_invalid_and_long_reasons_cannot_change_orders(mixed $reason): void
    {
        $order=$this->order(); Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        foreach (['/api/admin/orders/'.$order->id.'/reject','/api/admin/orders/reject-bulk'] as $endpoint) {
            $this->postJson($endpoint,['ids'=>[$order->id],'reason'=>$reason])->assertUnprocessable()->assertJsonValidationErrors('reason');
        }
        $this->assertSame('incoming',$order->fresh()->lifecycle_status);
        $this->assertSame(3,$order->items->first()->product->fresh()->stock);
        $this->assertSame([],$this->emails); $this->assertDatabaseCount('order_tracking_events',0);
        Http::assertNothingSent();
    }

    public function test_customer_cannot_reject_an_order_with_a_reason(): void
    {
        $order=$this->order(); Sanctum::actingAs($order->customer);
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'Cannot fulfill'])->assertForbidden();
        $this->postJson('/api/admin/orders/reject-bulk',['ids'=>[$order->id],'reason'=>'Cannot fulfill'])->assertForbidden();
        $this->assertSame('incoming',$order->fresh()->lifecycle_status);
    }

    public function test_timeline_failure_rolls_back_rejection_stock_and_customer_alert(): void
    {
        $order=$this->order(); Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        OrderTrackingEvent::creating(fn()=>throw new \RuntimeException('Fixture timeline failure'));
        try {
            $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'Cannot fulfill'])->assertStatus(500);
        } finally { OrderTrackingEvent::flushEventListeners(); }
        $this->assertSame('incoming',$order->fresh()->lifecycle_status);
        $this->assertSame(3,$order->items->first()->product->fresh()->stock);
        $this->assertDatabaseMissing('customer_notifications',['user_id'=>$order->customer_id,'message'=>'Your order '.$order->order_no.' was rejected. Reason: Cannot fulfill']);
        $this->assertSame([],$this->emails); Http::assertNothingSent();
    }
}
