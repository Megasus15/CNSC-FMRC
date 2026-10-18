<?php

namespace Tests\Feature;

use App\Models\{Order, Payment, User};
use App\Services\GatewayPayments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RejectedOrderRoutingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake(); Http::preventStrayRequests(); Http::fake();
        config(['payments.gateway'=>'paymongo', 'payments.paymongo.enabled'=>true,
            'payments.paymongo.checkout_method'=>'qrph', 'payments.paymongo.secret_key'=>'sk_test_example',
            'payments.paymongo.webhook_secret'=>'whsec_example']);
    }

    public static function roles(): array { return [['admin'], ['staff']]; }
    public static function cashRoles(): array
    {
        return [['admin','COP'], ['staff','COP'], ['admin','COD'], ['staff','COD'], ['admin','GCash'], ['staff','GCash']];
    }
    public static function zeroPayments(): array { return [['COP',false], ['COD',false], ['GCash',false], ['GCash',true]]; }

    private function order(string $method='GCash', string $status='paid', bool $online=true, bool $receipt=true): Order
    {
        $customer=User::factory()->create(['role'=>'customer']);
        $order=Order::create(['order_no'=>'ORD-'.Str::random(10), 'customer_id'=>$customer->id,
            'customer_name'=>$customer->name, 'customer_contact'=>$customer->email, 'quantity'=>1,
            'subtotal'=>10, 'total'=>10, 'payment_method'=>$method, 'payment_reference'=>'Awaiting payment',
            'fulfillment_type'=>$method==='COD'?'delivery':'pickup', 'lifecycle_status'=>'incoming', 'customer_stage'=>'to_pay']);
        $providerId=$online && $status==='paid'?'pay_'.Str::random(12):null;
        $payment=Payment::create(['order_id'=>$order->id, 'payment_no'=>'PAY-'.$order->id, 'method'=>$method,
            'gateway'=>$online?'paymongo':null, 'reference'=>$providerId ?? ($status==='paid'?'MANUAL-RECEIPT':'Awaiting payment'),
            'paymongo_payment_id'=>$providerId, 'amount'=>10, 'status'=>$status, 'paid_at'=>$status==='paid'?now():null]);
        if ($online && $providerId && $receipt) {
            $attempt=DB::table('payment_attempts')->insertGetId(['payment_id'=>$payment->id,'token'=>(string)Str::uuid(),
                'checkout_id'=>'cs_'.Str::random(12),'checkout_method'=>'qrph','api_version'=>'v2','livemode'=>false,
                'amount_centavos'=>1000,'status'=>'paid','provider_payment_id'=>$providerId,
                'confirmed_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
            DB::table('payment_receipts')->insert([
                'payment_id'=>$payment->id, 'attempt_id'=>$attempt, 'provider_payment_id'=>$providerId, 'source_type'=>'qrph',
                'amount_centavos'=>1000, 'livemode'=>false, 'confirmed_at'=>now(), 'created_at'=>now(), 'updated_at'=>now(),
            ]);
        }
        return $order->fresh();
    }

    #[DataProvider('roles')]
    public function test_paid_qr_rejection_reserves_one_refund_and_moves_to_the_online_queue(string $role): void
    {
        $order=$this->order(); Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()
            ->assertJsonPath('data.rejected_order_workspace','online_refunds')
            ->assertJsonPath('data.payment_has_refund_record',true)
            ->assertJsonPath('data.payment_refund_status','requested');
        $this->assertDatabaseHas('payment_refunds',['payment_id'=>$order->payment->id,'amount_centavos'=>1000,'status'=>'requested']);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',1)
            ->assertJsonPath('payments.data.0.order_id',$order->id);
        $this->getJson('/api/admin/orders')->assertOk()->assertJsonCount(0,'incoming')
            ->assertJsonPath('directory.0.rejected_order_workspace','online_refunds');
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertUnprocessable();
        $this->assertDatabaseCount('payment_refunds',1);
        $this->assertSame('paid',$order->payment->fresh()->status);
        $this->assertSame('rejected',$order->fresh()->lifecycle_status);
        Http::assertNothingSent(); // Rejection reserves a refund; it does not send money.
    }

    #[DataProvider('cashRoles')]
    public function test_unpaid_rejections_stay_in_rejected_orders_without_a_refund(string $role, string $method): void
    {
        $order=$this->order($method,'pending',$method==='GCash');
        Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()
            ->assertJsonPath('data.rejected_order_workspace','rejected')->assertJsonPath('data.payment_has_refund_record',false);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',0);
        $this->assertDatabaseCount('payment_refunds',0); Http::assertNothingSent();
    }

    #[DataProvider('cashRoles')]
    public function test_paid_cash_and_legacy_rejections_remain_visible_for_manual_repayment(string $role, string $method): void
    {
        $order=$this->order($method,'paid',false);
        Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()
            ->assertJsonPath('data.rejected_order_workspace','manual_refunds')
            ->assertJsonPath('data.payment_actions.refunded.allowed',true);
        $this->patchJson('/api/admin/orders/'.$order->id.'/payment-status',[
            'status'=>'refunded', 'expected_status'=>'paid', 'refund_reference'=>'RETURN-RECEIPT-001',
        ])->assertOk()->assertJsonPath('order.rejected_order_workspace','manual_refunds')
            ->assertJsonPath('order.payment_is_refunded',true);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',0);
        $this->assertDatabaseCount('payment_refunds',0); Http::assertNothingSent();
    }

    #[DataProvider('roles')]
    public function test_bulk_rejection_routes_mixed_payments_without_losing_or_sending_money(string $role): void
    {
        $online=$this->order(); $unpaid=$this->order('GCash','pending');
        $cop=$this->order('COP','pending',false); $cod=$this->order('COD','pending',false);
        $legacy=$this->order('GCash','paid',false); $cash=$this->order('COP','paid',false);
        Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $this->postJson('/api/admin/orders/reject-bulk',['reason'=>'The requested material is unavailable.','ids'=>[$online->id,$unpaid->id,$cop->id,$cod->id,$legacy->id,$cash->id]])->assertOk();
        $rows=collect($this->getJson('/api/admin/orders')->assertOk()->json('directory'))->keyBy('id');
        foreach ([$online->id=>'online_refunds', $unpaid->id=>'rejected', $cop->id=>'rejected', $cod->id=>'rejected', $legacy->id=>'manual_refunds', $cash->id=>'manual_refunds'] as $id=>$workspace) {
            $this->assertSame($workspace,$rows[$id]['rejected_order_workspace']);
        }
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',1)->assertJsonPath('payments.data.0.order_id',$online->id);
        $this->assertDatabaseCount('payment_refunds',1); Http::assertNothingSent();
    }

    public function test_late_provider_payment_moves_an_unpaid_rejection_to_online_refunds_once(): void
    {
        $order=$this->order('GCash','pending'); Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()->assertJsonPath('data.rejected_order_workspace','rejected');
        $token=(string)Str::uuid();
        $id=DB::table('payment_attempts')->insertGetId(['payment_id'=>$order->payment->id, 'token'=>$token,
            'checkout_id'=>'cs_late', 'checkout_method'=>'qrph', 'api_version'=>'v2', 'livemode'=>false,
            'amount_centavos'=>1000, 'status'=>'pending', 'created_at'=>now(), 'updated_at'=>now()]);
        $session=['id'=>'cs_late','attributes'=>['livemode'=>false,'metadata'=>['attempt_token'=>$token,
            'payment_id'=>(string)$order->payment->id,'order_id'=>(string)$order->id],
            'payments'=>[['id'=>'pay_late','attributes'=>['amount'=>1000,'currency'=>'PHP','livemode'=>false,'status'=>'paid','source'=>['type'=>'qrph']]]]]];
        $gateway=app(GatewayPayments::class);
        $this->assertTrue($gateway->applySession($id,$session)); $gateway->applySession($id,$session);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.rejected_order_workspace','online_refunds');
        $this->assertDatabaseCount('payment_refunds',1);
        $this->assertSame('rejected',$order->fresh()->lifecycle_status); Http::assertNothingSent();
    }

    public function test_missing_provider_receipt_is_flagged_for_review_instead_of_inventing_a_refund(): void
    {
        $order=$this->order(receipt:false); Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()
            ->assertJsonPath('data.rejected_order_workspace','online_refunds')
            ->assertJsonPath('data.payment_has_refund_record',false);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',0);
        $this->getJson('/api/admin/orders/'.$order->id.'/gateway-payment')->assertOk()->assertJsonPath('payments.total',1)->assertJsonCount(0,'receipts');
        $this->assertDatabaseCount('payment_refunds',0); Http::assertNothingSent();
    }

    public function test_unconfirmed_legacy_claim_needs_manual_review_instead_of_assuming_no_money(): void
    {
        $order=$this->order('GCash','pending',false); $order->payment->update(['reference'=>'1234567890123']);
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()
            ->assertJsonPath('data.rejected_order_workspace','manual_refunds')->assertJsonPath('data.payment_status','pending');
        $this->assertDatabaseCount('payment_refunds',0); Http::assertNothingSent();
    }

    #[DataProvider('zeroPayments')]
    public function test_zero_value_rejections_need_no_refund_even_with_a_paid_flag(string $method, bool $online): void
    {
        $order=$this->order($method,'paid',$online,false);
        $order->update(['subtotal'=>0,'total'=>0]); $order->payment->update(['amount'=>0]);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->postJson('/api/admin/orders/'.$order->id.'/reject',['reason'=>'The requested material is unavailable.'])->assertOk()
            ->assertJsonPath('data.rejected_order_workspace','rejected')->assertJsonPath('data.payment_has_refund_record',false);
        $this->assertDatabaseCount('payment_refunds',0); Http::assertNothingSent();
    }
}
