<?php

namespace Tests\Feature;

use App\Models\{Order, OrderTrackingEvent, Payment, User};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class FocusedOrdersWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake(); Http::preventStrayRequests();
        config(['payments.gateway'=>'paymongo', 'payments.paymongo.enabled'=>true,
            'payments.paymongo.checkout_method'=>'qrph', 'payments.paymongo.secret_key'=>'sk_test_example']);
    }

    public static function roles(): array { return [['admin'], ['staff']]; }

    private function order(string $method='GCash', string $status='pending', array $extra=[]): Order
    {
        $customer=User::factory()->create(['role'=>'customer']);
        $order=Order::create(array_merge(['order_no'=>'ORD-'.Str::random(12),'customer_id'=>$customer->id,
            'customer_name'=>$customer->name,'customer_contact'=>$customer->email,'quantity'=>1,'subtotal'=>100,'total'=>110,
            'payment_method'=>$method,'fulfillment_type'=>$method==='COP'?'pickup':'delivery',
            'lifecycle_status'=>'incoming','customer_stage'=>'to_pay'],$extra));
        Payment::create(['order_id'=>$order->id,'payment_no'=>'PAY-'.$order->id,'method'=>$method,
            'gateway'=>$method==='GCash'?'paymongo':null,'amount'=>110,'status'=>$status]);
        return $order->fresh();
    }

    #[DataProvider('roles')]
    public function test_unpaid_online_approval_is_denied_until_confirmed_and_never_changes_money(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $order=$this->order();$payment=$order->payment->getAttributes();
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.approval.allowed',false);
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertUnprocessable();
        $this->assertSame('incoming',$order->fresh()->lifecycle_status);
        $this->assertSame($payment,$order->payment->fresh()->getAttributes());
        $this->assertDatabaseCount('order_tracking_events',0);
        $order->payment->update(['status'=>'paid','paid_at'=>now()]);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.approval.allowed',true);
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertOk()->assertJsonPath('data.lifecycle_status','pending');
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertUnprocessable();
        $this->assertSame(1,OrderTrackingEvent::where('order_id',$order->id)->where('title','Order approved')->count());
        $this->assertSame('110.00',$order->payment->fresh()->amount);
        Http::assertNothingSent();
    }

    #[DataProvider('roles')]
    public function test_bulk_skips_unpaid_closed_and_cancel_pending_but_keeps_cash_pickup(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $unpaid=$this->order();$paid=$this->order(status:'paid');$cash=$this->order('COP');
        $cancel=$this->order(status:'paid',extra:['cancel_state'=>'requested']);
        $closed=$this->order(status:'paid',extra:['lifecycle_status'=>'cancelled']);
        $ids=[$unpaid->id,$paid->id,$cash->id,$cancel->id,$closed->id];
        $response=$this->postJson('/api/admin/orders/approve-bulk',['ids'=>$ids])->assertOk();
        $this->assertEqualsCanonicalizing([$paid->id,$cash->id],$response->json('processed_ids'));
        $this->assertEqualsCanonicalizing([$unpaid->id,$cancel->id,$closed->id],$response->json('skipped_ids'));
        $this->assertSame('pending',$cash->payment->fresh()->status);
        $this->assertSame('pending',$cash->fresh()->lifecycle_status);
        $this->postJson('/api/admin/orders/approve-bulk',['ids'=>$ids])->assertOk()->assertJsonPath('processed_count',0);
        $this->assertDatabaseCount('order_tracking_events',2);
        Http::assertNothingSent();
    }

    #[DataProvider('roles')]
    public function test_online_refunds_paginate_ten_with_twenty_first_on_page_three(string $role): void
    {
        $operator=User::factory()->create(['role'=>$role]);Sanctum::actingAs($operator);
        for($i=0;$i<21;$i++){
            $order=$this->order(status:'refunded',extra:['lifecycle_status'=>'cancelled']);
            DB::table('payment_refunds')->insert(['payment_id'=>$order->payment->id,'token'=>(string)Str::uuid(),
                'provider_payment_id'=>'pay_'.$i,'requested_by'=>$operator->id,'amount_centavos'=>11000,
                'reason'=>'Fixture refund','livemode'=>false,'status'=>'succeeded','confirmed_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        }
        $ids=[];
        foreach([1=>10,2=>10,3=>1] as $page=>$count){
            $response=$this->getJson('/api/admin/gateway-payments?page='.$page)->assertOk()
                ->assertJsonPath('payments.per_page',10)->assertJsonPath('payments.total',21)->assertJsonPath('payments.last_page',3);
            $this->assertCount($count,$response->json('payments.data'));
            $ids=array_merge($ids,array_column($response->json('payments.data'),'id'));
        }
        $this->assertCount(21,array_unique($ids));Http::assertNothingSent();
    }
}
