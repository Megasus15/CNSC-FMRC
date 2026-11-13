<?php

namespace Tests\Feature;

use App\Models\{Order, OrderItem, OrderTrackingEvent, Payment, Product, User};
use App\Services\GatewayPayments;
use App\Support\RefundedOrderReview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class OrderRefundRestrictionsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();Mail::fake();Http::preventStrayRequests();
        config(['payments.gateway'=>'paymongo','payments.paymongo.enabled'=>true,'payments.paymongo.secret_key'=>'sk_test_fixture','payments.paymongo.checkout_method'=>'gcash']);
    }
    private function order(string $lifecycle='pending', string $stage='to_ship'): array
    {
        $customer=User::factory()->create(['role'=>'customer']);
        $product=Product::create(['name'=>'Refund cup','category'=>'Products','code'=>'RF-'.Str::random(6),'price'=>100,'stock'=>5,'stock_status'=>'in_stock']);
        $order=Order::create(['order_no'=>'RF-'.Str::random(8),'customer_id'=>$customer->id,'customer_name'=>$customer->name,'customer_contact'=>$customer->email,
            'quantity'=>2,'subtotal'=>200,'total'=>200,'payment_method'=>'GCash','fulfillment_type'=>'pickup','lifecycle_status'=>'pending','customer_stage'=>$stage,
            'review_status'=>'approved','stock_reserved_at'=>now(),'approved_at'=>now()]);
        OrderItem::create(['order_id'=>$order->id,'product_id'=>$product->id,'product_name'=>$product->name,'quantity'=>2,'unit_price'=>100,'line_total'=>200]);
        Payment::create(['order_id'=>$order->id,'payment_no'=>'PAY-'.$order->id,'method'=>'GCash','gateway'=>'paymongo','amount'=>200,'status'=>'pending']);
        $this->receipt($order);
        $order->update(['lifecycle_status'=>$lifecycle]);
        return [$order->fresh(),$product,$customer];
    }
    private function receipt(Order $order): object
    {
        $payment=$order->fresh()->payment;$token=(string)Str::uuid();$checkout='cs_'.Str::random(12);$provider='pay_'.Str::random(15);
        $id=DB::table('payment_attempts')->insertGetId(['payment_id'=>$payment->id,'token'=>$token,'checkout_id'=>$checkout,'api_version'=>'v2','checkout_method'=>'gcash',
            'livemode'=>false,'amount_centavos'=>20000,'status'=>'pending','created_at'=>now(),'updated_at'=>now()]);
        app(GatewayPayments::class)->applySession($id,['id'=>$checkout,'attributes'=>['livemode'=>false,'metadata'=>['attempt_token'=>$token,'order_id'=>(string)$order->id,'payment_id'=>(string)$payment->id],
            'payments'=>[['id'=>$provider,'attributes'=>['status'=>'paid','amount'=>20000,'currency'=>'PHP','livemode'=>false,'source'=>['type'=>'gcash']]]]]]);
        return DB::table('payment_receipts')->where('provider_payment_id',$provider)->first();
    }
    private function refunded(Order $order, int $amount=20000, ?string $provider=null): int
    {
        $payment=$order->fresh()->payment;
        $id=DB::table('payment_refunds')->insertGetId(['payment_id'=>$payment->id,'token'=>(string)Str::uuid(),'requested_by'=>$order->customer_id,
            'approved_by'=>$order->customer_id,'provider_payment_id'=>$provider??$payment->paymongo_payment_id,'provider_refund_id'=>'ref_'.Str::random(12),
            'amount_centavos'=>$amount,'reason'=>'Historical refund','livemode'=>false,'status'=>'succeeded','confirmed_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        if($amount===20000&&(!$provider||$provider===$payment->paymongo_payment_id))$payment->update(['status'=>'refunded','refunded_at'=>now(),'refund_reference'=>'ref_historical']);
        return $id;
    }
    public static function states(): array
    {
        $rows=[];foreach(['admin','staff'] as $role)foreach([['incoming','to_pay',false],['pending','to_ship',false],['pending','to_receive',false],['completed','completed',false],['cancelled','to_pay',true],['rejected','to_pay',true]] as $state)$rows[]=[$role,...$state];return $rows;
    }
    #[DataProvider('states')]
    public function test_refunds_require_closed_orders_or_returns(string $role,string $lifecycle,string $stage,bool $allowed): void
    {
        [$order]=$this->order($lifecycle,$stage);Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $response=$this->postJson('/api/admin/orders/'.$order->id.'/gateway-refunds',['amount_centavos'=>10000,'reason'=>'Customer refund','request_key'=>(string)Str::uuid()]);
        $response->assertStatus($allowed?201:422);Http::assertNothingSent();
        $this->getJson('/api/admin/orders/'.$order->id.'/gateway-payment')->assertOk()->assertJsonPath('payments.data.0.refund_action.allowed',$allowed);
    }
    public function test_stale_requests_and_failed_refund_retries_cannot_bypass_active_order_policy(): void
    {
        [$order]=$this->order();$admin=User::factory()->create(['role'=>'admin']);Sanctum::actingAs($admin);
        foreach(['requested','failed'] as $status){
            $id=DB::table('payment_refunds')->insertGetId(['payment_id'=>$order->payment->id,'requested_by'=>$admin->id,'token'=>(string)Str::uuid(),'provider_payment_id'=>$order->payment->paymongo_payment_id,
                'amount_centavos'=>10000,'reason'=>'Old unrestricted request','status'=>$status,'livemode'=>false,'created_at'=>now(),'updated_at'=>now()]);
            $this->postJson('/api/admin/gateway-refunds/'.$id.($status==='requested'?'/approve':'/retry'),['request_key'=>(string)Str::uuid(),'issue'=>true])->assertUnprocessable();
            $this->assertSame($status,DB::table('payment_refunds')->where('id',$id)->value('status'));
        }
        Http::assertNothingSent();$this->assertSame('paid',$order->fresh()->payment->status);
    }
    public function test_admin_returns_only_extra_receipt_and_keeps_primary_order_paid(): void
    {
        [$order,$product]=$this->order();$extra=$this->receipt($order);$admin=User::factory()->create(['role'=>'admin']);
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $body=['amount_centavos'=>20000,'reason'=>'Duplicate payment','request_key'=>(string)Str::uuid(),'provider_payment_id'=>$extra->provider_payment_id];
        $this->postJson('/api/admin/orders/'.$order->id.'/gateway-refunds',$body)->assertUnprocessable();
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/orders/'.$order->id.'/gateway-payment')->assertOk()->assertJsonPath('payments.data.0.refund_action.kind','extra_payment')->assertJsonPath('payments.data.0.refund_action.label','Return extra payment');
        $id=$this->postJson('/api/admin/orders/'.$order->id.'/gateway-refunds',$body)->assertCreated()->json('data.id');
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::response(['data'=>['id'=>'ref_extra','attributes'=>['payment_id'=>$extra->provider_payment_id,'amount'=>20000,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded']]])]);
        $this->postJson('/api/admin/gateway-refunds/'.$id.'/approve')->assertOk();
        $this->assertSame('paid',$order->fresh()->payment->status);$this->assertSame('pending',$order->fresh()->lifecycle_status);$this->assertSame(5,$product->fresh()->stock);
        $this->assertFalse(RefundedOrderReview::required($order->fresh()));
        $order->update(['customer_stage'=>'to_receive','pickup_ready_at'=>now()]);
        $this->assertNull(\App\Services\OrderCompletion::collectionBlocker($order->fresh()));
        config(['track17.allow_demo_handover'=>true]);
        $order->update(['fulfillment_type'=>'delivery','customer_stage'=>'to_ship','shipment_tracking_mode'=>'jnt_dropoff',
            'delivery_recipient_name'=>'Test Customer','delivery_contact_no'=>'09171234567','delivery_street'=>'One Street','delivery_barangay'=>'Barangay 1',
            'delivery_city'=>'Daet','delivery_province'=>'Camarines Norte','delivery_postal_code'=>'4600']);
        $this->assertNull(\App\Services\ShipmentTracking::eligibility($order->fresh()));
    }
    public function test_historical_refund_closure_requires_admin_and_explicit_bounded_stock_then_restores_once(): void
    {
        [$order,$product,$customer]=$this->order();$this->refunded($order);
        Sanctum::actingAs($customer);
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonPath('counts.to_ship',0)->assertJsonPath('counts.all',1);
        $this->getJson('/api/customer/orders/'.$order->id)->assertOk()->assertJsonPath('data.refund_review.required',true)->assertJsonPath('data.refund_review.can_close',false);
        $input=['reason'=>'Order never fulfilled; refund verified','non_fulfillment_confirmed'=>true,'stock_items'=>[['product_id'=>$product->id,'quantity'=>1]]];
        foreach(['customer','staff'] as $role){Sanctum::actingAs(User::factory()->create(['role'=>$role]));$this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',$input)->assertForbidden();}
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->getJson('/api/admin/orders')->assertOk()->assertJsonCount(1,'directory')->assertJsonCount(0,'incoming');
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'Bypass'])->assertUnprocessable();
        $this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',array_replace($input,['stock_items'=>[]]))->assertUnprocessable();
        $this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',array_replace($input,['stock_items'=>[['product_id'=>$product->id,'quantity'=>3]]]))->assertUnprocessable();
        foreach(range(1,2) as $_)$this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',$input)->assertOk()->assertJsonPath('data.lifecycle_status','cancelled');
        $this->assertSame(6,$product->fresh()->stock);$this->assertSame('none',$order->fresh()->cancel_state);
        $this->assertSame('ref_historical',$order->fresh()->payment->refund_reference);
        $this->assertSame(1,$order->trackingEvents()->where('metadata->source',RefundedOrderReview::SOURCE)->count());
        Sanctum::actingAs($customer);$this->getJson('/api/customer/orders')->assertOk()->assertJsonPath('counts.cancelled',1)->assertJsonPath('counts.to_ship',0);
        $detail=$this->getJson('/api/customer/orders/'.$order->id)->assertOk();
        $closure=collect($detail->json('data.timeline'))->firstWhere('title','Order closed after confirmed refund');
        $this->assertSame(['source'=>RefundedOrderReview::SOURCE],$closure['metadata']);
    }
    public function test_shipment_evidence_and_failed_transaction_leave_order_and_stock_intact(): void
    {
        [$order,$product]=$this->order();$this->refunded($order);$admin=User::factory()->create(['role'=>'admin']);Sanctum::actingAs($admin);
        $input=['reason'=>'Verified refund','non_fulfillment_confirmed'=>true,'stock_items'=>[['product_id'=>$product->id,'quantity'=>1]]];
        try{DB::transaction(function()use($order,$input,$admin){RefundedOrderReview::close($order,$input,$admin->id);throw new \RuntimeException('Rollback');});}catch(\RuntimeException $e){$this->assertSame('Rollback',$e->getMessage());}
        $this->assertSame('pending',$order->fresh()->lifecycle_status);$this->assertSame(5,$product->fresh()->stock);
        OrderTrackingEvent::create(['order_id'=>$order->id,'stage'=>'to_receive','event_type'=>'shipped','title'=>'Historical handover','occurred_at'=>now()]);
        $this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',$input)->assertUnprocessable();
        $this->assertSame('pending',$order->fresh()->lifecycle_status);
    }
    public function test_previously_submitted_refund_still_reconciles_without_approving_or_closing_order(): void
    {
        [$order]=$this->order();$id=$this->refunded($order,10000);
        DB::table('payment_refunds')->where('id',$id)->update(['status'=>'pending','provider_refund_id'=>'ref_inflight','confirmed_at'=>null]);
        Http::fake(['api.paymongo.com/v1/refunds/ref_inflight'=>Http::response(['data'=>['id'=>'ref_inflight','attributes'=>['payment_id'=>$order->payment->paymongo_payment_id,'amount'=>10000,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded']]])]);
        app(GatewayPayments::class)->reconcileRefund(DB::table('payment_refunds')->find($id));
        $this->assertDatabaseHas('payment_refunds',['id'=>$id,'status'=>'succeeded']);
        $this->assertSame('paid',$order->fresh()->payment->status);$this->assertSame('pending',$order->fresh()->lifecycle_status);
    }
    public function test_closure_cannot_restore_released_or_unreserved_stock_or_close_unverified_refunds(): void
    {
        [$order,$product]=$this->order();$this->refunded($order);Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        OrderTrackingEvent::create(['order_id'=>$order->id,'stage'=>'to_ship','event_type'=>'admin_update','title'=>'Earlier stock correction','occurred_at'=>now(),
            'metadata'=>['restocked'=>[['product_id'=>$product->id,'quantity'=>1]]]]);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.refund_review.stock_items.0.max_restore',1);
        $input=['reason'=>'Close verified refund','non_fulfillment_confirmed'=>true,'stock_items'=>[['product_id'=>$product->id,'quantity'=>2]]];
        $this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',$input)->assertUnprocessable();
        $order->update(['stock_released_at'=>now()]);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.refund_review.stock_items.0.max_restore',0);
        $order->update(['stock_released_at'=>null,'stock_reserved_at'=>null]);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.refund_review.stock_items.0.max_restore',0);
        DB::table('payment_refunds')->where('payment_id',$order->payment->id)->update(['status'=>'pending']);
        $input['stock_items'][0]['quantity']=0;
        $this->postJson('/api/admin/orders/'.$order->id.'/close-refunded',$input)->assertUnprocessable();
        $this->assertSame(5,$product->fresh()->stock);$this->assertSame('pending',$order->fresh()->lifecycle_status);
    }
    public function test_extra_recovery_cannot_use_another_orders_receipt_or_refund_underfunded_primary(): void
    {
        [$order]=$this->order();[$other]=$this->order();$extra=$this->receipt($order);Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $body=['amount_centavos'=>20000,'reason'=>'Return duplicate','request_key'=>(string)Str::uuid(),'provider_payment_id'=>$other->payment->paymongo_payment_id];
        $this->postJson('/api/admin/orders/'.$order->id.'/gateway-refunds',$body)->assertUnprocessable();
        $body['provider_payment_id']=$extra->provider_payment_id;$body['amount_centavos']=20001;
        $this->postJson('/api/admin/orders/'.$order->id.'/gateway-refunds',$body)->assertUnprocessable();
        $this->refunded($order,10000);$body['amount_centavos']=20000;
        $this->postJson('/api/admin/orders/'.$order->id.'/gateway-refunds',$body)->assertUnprocessable();Http::assertNothingSent();
    }
}
