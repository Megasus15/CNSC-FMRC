<?php

namespace Tests\Feature;

use App\Models\{Order, Payment, User};
use App\Services\GatewayPayments;
use App\Support\GatewayFinancials;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class OnlineRefundArchiveTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp(); Mail::fake(); Http::preventStrayRequests();
        config(['payments.gateway'=>'paymongo', 'payments.paymongo.enabled'=>true,
            'payments.paymongo.checkout_method'=>'qrph', 'payments.paymongo.secret_key'=>'sk_test_example']);
    }

    private function payment(): Payment
    {
        $customer=User::factory()->create(['role'=>'customer']);
        $order=Order::create(['order_no'=>'ORD-'.Str::random(10), 'customer_id'=>$customer->id,
            'customer_name'=>$customer->name, 'customer_contact'=>$customer->email, 'quantity'=>1,
            'subtotal'=>10, 'total'=>10, 'payment_method'=>'GCash', 'payment_reference'=>'pay_fixture',
            'fulfillment_type'=>'pickup', 'lifecycle_status'=>'completed', 'customer_stage'=>'completed']);
        $payment=Payment::create(['order_id'=>$order->id, 'payment_no'=>'PAY-'.$order->id, 'method'=>'GCash',
            'gateway'=>'paymongo', 'reference'=>'pay_fixture', 'paymongo_payment_id'=>'pay_fixture', 'amount'=>10,
            'status'=>'paid', 'paid_at'=>now()]);
        $attempt=DB::table('payment_attempts')->insertGetId(['payment_id'=>$payment->id, 'token'=>(string)Str::uuid(),
            'checkout_id'=>'cs_fixture', 'checkout_method'=>'qrph', 'api_version'=>'v2', 'livemode'=>false,
            'amount_centavos'=>1000, 'status'=>'paid', 'provider_payment_id'=>'pay_fixture',
            'confirmed_at'=>now(), 'created_at'=>now(), 'updated_at'=>now()]);
        DB::table('payment_receipts')->insert(['payment_id'=>$payment->id, 'attempt_id'=>$attempt,
            'provider_payment_id'=>'pay_fixture', 'source_type'=>'qrph', 'amount_centavos'=>1000,
            'livemode'=>false, 'confirmed_at'=>now(), 'created_at'=>now(), 'updated_at'=>now()]);
        return $payment;
    }

    private function refund(Payment $payment, string $status, int $amount=1000, array $extra=[]): int
    {
        return DB::table('payment_refunds')->insertGetId(array_merge([
            'payment_id'=>$payment->id, 'token'=>(string)Str::uuid(), 'provider_payment_id'=>'pay_fixture',
            'requested_by'=>User::factory()->create(['role'=>'staff'])->id, 'amount_centavos'=>$amount,
            'reason'=>'Return refund', 'livemode'=>false, 'status'=>$status,
            'confirmed_at'=>$status==='succeeded'?now():null, 'created_at'=>now(), 'updated_at'=>now(),
        ], $extra));
    }

    public static function roles(): array { return [['admin'], ['staff']]; }
    public static function unresolved(): array { return [['requested'], ['pending'], ['unknown'], ['submitting'], ['failed'], ['rejected']]; }

    #[DataProvider('roles')]
    public function test_archive_restore_preserves_customer_history_and_financial_totals(string $role): void
    {
        $payment=$this->payment(); $this->refund($payment, 'succeeded');
        // Real-money totals are live-only; no provider requests are used by archiving.
        DB::table('payment_receipts')->update(['livemode'=>true]);
        DB::table('payment_refunds')->update(['livemode'=>true]);
        $totals=[GatewayFinancials::total('receipts'), GatewayFinancials::total('refunds')];
        $actor=User::factory()->create(['role'=>$role]); Sanctum::actingAs($actor);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.data.0.can_archive_refunds', true);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertOk();
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertOk();
        $this->assertDatabaseHas('payments', ['id'=>$payment->id, 'online_refund_archived_by'=>$actor->id]);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total', 0);
        $this->getJson('/api/admin/orders/'.$payment->order_id.'/gateway-payment')->assertOk()->assertJsonCount(1,'refunds');
        $this->getJson('/api/admin/archives?module=online_refund')->assertOk()
            ->assertJsonPath('online_refunds.0.source_id', $payment->id)->assertJsonPath('online_refunds.0.refunded_label', '₱ 10.00');
        $this->getJson('/api/admin/dashboard/live-counts')->assertOk()->assertJsonPath('data.archives.online_refunds',1);
        $this->assertEquals($totals, [GatewayFinancials::total('receipts'), GatewayFinancials::total('refunds')]);
        $this->assertFalse((bool)$payment->order->fresh()->is_archived);
        Sanctum::actingAs($payment->order->customer);
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonCount(1, 'data');
        Sanctum::actingAs($actor);
        $this->patchJson('/api/admin/archives/restore-bulk', ['module'=>'online_refund','ids'=>[$payment->id]])
            ->assertOk()->assertJsonPath('processed_ids.0', $payment->id);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total', 1);
        $this->assertDatabaseCount('payment_refunds',1); Http::assertNothingSent();
    }

    #[DataProvider('unresolved')]
    public function test_open_or_failed_refunds_cannot_be_hidden(string $status): void
    {
        $payment=$this->payment(); $this->refund($payment,$status);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.data.0.can_archive_refunds',false);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertUnprocessable();
        $this->assertNull($payment->fresh()->online_refund_archived_at); Http::assertNothingSent();
    }

    public function test_resolved_retry_can_be_archived_and_a_new_partial_refund_reopens_the_queue(): void
    {
        $payment=$this->payment(); $this->refund($payment,'failed',100); $this->refund($payment,'succeeded',100);
        $actor=User::factory()->create(['role'=>'admin']); Sanctum::actingAs($actor);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertOk();
        app(GatewayPayments::class)->requestRefund($payment,100,'Additional approved refund',$actor->id,(string)Str::uuid());
        $this->assertNull($payment->fresh()->online_refund_archived_at);
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.total',1)
            ->assertJsonPath('payments.data.0.can_archive_refunds',false);
        $this->getJson('/api/admin/archives?module=online_refund')->assertOk()->assertJsonCount(0,'online_refunds');
        Http::assertNothingSent();
    }

    public function test_confirmed_refunds_are_restorable_and_excluded_from_permanent_and_automatic_deletion(): void
    {
        $payment=$this->payment(); $this->refund($payment,'succeeded');
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertOk();
        DB::table('payments')->where('id',$payment->id)->update(['online_refund_archived_at'=>now()->subDays(120)]);
        $this->postJson('/api/admin/archives/auto-delete',['retention_days'=>30])->assertOk();
        $this->deleteJson('/api/admin/archives/delete-bulk',['module'=>'online_refund','ids'=>[$payment->id]])->assertUnprocessable();
        $this->assertDatabaseCount('payment_refunds',1); $this->assertNotNull($payment->fresh()->online_refund_archived_at);
    }

    public function test_customer_cannot_check_archive_or_restore_team_records(): void
    {
        $payment=$this->payment(); $this->refund($payment,'succeeded');
        Sanctum::actingAs($payment->order->customer);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertForbidden();
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/payment-check')->assertForbidden();
        $this->patchJson('/api/admin/archives/restore-bulk',['module'=>'online_refund','ids'=>[$payment->id]])->assertForbidden();
        Http::assertNothingSent();
    }

    #[DataProvider('roles')]
    public function test_customer_claim_enables_archive_only_after_provider_confirms_the_refund(string $role): void
    {
        $payment=$this->payment(); $actor=User::factory()->create(['role'=>$role]); Sanctum::actingAs($actor);
        $id=$this->refund($payment,'pending',1000,['provider_refund_id'=>'ref_claim','approved_by'=>$actor->id,'checked_at'=>now()]);
        \App\Models\OrderTrackingEvent::create(['order_id'=>$payment->order_id,'stage'=>'completed','event_type'=>'system',
            'title'=>'Refund ready to claim','occurred_at'=>now(),'metadata'=>['refund_id'=>$id,
                'transfer_link'=>'https://transfer.paymongo.com/claim-fixture','claim_expires_at'=>now()->addDays(3)->toIso8601String()]]);
        $this->getJson('/api/admin/gateway-payments')->assertOk()
            ->assertJsonPath('payments.data.0.can_archive_refunds',false)
            ->assertJsonPath('refunds.0.transfer_link','https://transfer.paymongo.com/claim-fixture');
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertUnprocessable();
        $this->assertDatabaseHas('payment_refunds',['id'=>$id,'status'=>'pending']);
        Http::assertNothingSent();
        // Check only the already-issued refund; this does not submit another transfer.
        Http::fake([
            'api.paymongo.com/v1/checkout_sessions/cs_fixture'=>Http::response(['data'=>[]]),
            'api.paymongo.com/v1/refunds/ref_claim'=>Http::response(['data'=>['id'=>'ref_claim','attributes'=>[
                'payment_id'=>'pay_fixture','amount'=>1000,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded',
            ]]]),
        ]);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/payment-check')->assertOk()->assertJsonPath('status','refunded');
        $this->getJson('/api/admin/gateway-payments')->assertOk()->assertJsonPath('payments.data.0.can_archive_refunds',true);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/archive-refunds')->assertOk();
        $this->assertDatabaseHas('payment_refunds',['id'=>$id,'status'=>'succeeded','amount_centavos'=>1000]);
        Http::assertNotSent(fn($request)=>$request->method() !== 'GET');
    }

    public function test_archive_rechecks_refund_evidence_and_pending_cancellation(): void
    {
        $payment=$this->payment(); Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $endpoint='/api/admin/orders/'.$payment->order_id.'/archive-refunds';
        $this->postJson($endpoint)->assertUnprocessable();
        $this->refund($payment,'failed',1000); $this->refund($payment,'succeeded',100);
        $this->postJson($endpoint)->assertUnprocessable(); // Smaller retry does not resolve the failed amount.
        DB::table('payment_refunds')->where('payment_id',$payment->id)->where('status','failed')->update(['amount_centavos'=>100]);
        $payment->order->update(['cancel_state'=>'requested']);
        $this->postJson($endpoint)->assertUnprocessable();
        $payment->order->update(['cancel_state'=>'none']);
        $this->postJson($endpoint)->assertOk();
        // A stale archive confirmation must see a newly created request.
        $this->refund($payment,'requested',100);
        $this->postJson($endpoint)->assertUnprocessable();
        Http::assertNothingSent();
    }

    #[DataProvider('roles')]
    public function test_one_status_check_reads_payment_and_refunds_without_submitting_money(string $role): void
    {
        $payment=$this->payment(); $actor=User::factory()->create(['role'=>$role]); Sanctum::actingAs($actor);
        $pending=$this->refund($payment,'pending',100,['provider_refund_id'=>'ref_existing','approved_by'=>$actor->id]);
        $unknown=$this->refund($payment,'unknown',100,['approved_by'=>$actor->id]);
        $requested=$this->refund($payment,'requested',100);
        $attempt=DB::table('payment_attempts')->where('payment_id',$payment->id)->first();
        Http::fake([
            'api.paymongo.com/v1/checkout_sessions/cs_fixture'=>Http::response(['data'=>['id'=>'cs_fixture','attributes'=>[
                'livemode'=>false,'status'=>'active','metadata'=>['attempt_token'=>$attempt->token,'payment_id'=>(string)$payment->id,'order_id'=>(string)$payment->order_id],
                'payments'=>[['id'=>'pay_fixture','attributes'=>['amount'=>1000,'currency'=>'PHP','livemode'=>false,'status'=>'paid','source'=>['type'=>'qrph']]]],
            ]]]),
            'api.paymongo.com/v1/refunds/ref_existing'=>Http::response(['data'=>['id'=>'ref_existing','attributes'=>[
                'payment_id'=>'pay_fixture','amount'=>100,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded',
            ]]]),
        ]);
        $this->postJson('/api/admin/orders/'.$payment->order_id.'/payment-check')->assertOk()->assertJsonPath('status','paid');
        $this->assertDatabaseHas('payment_refunds',['id'=>$pending,'status'=>'succeeded']);
        $this->assertDatabaseHas('payment_refunds',['id'=>$unknown,'status'=>'unknown','provider_refund_id'=>null]);
        $this->assertDatabaseHas('payment_refunds',['id'=>$requested,'status'=>'requested','approved_by'=>null]);
        Http::assertSentCount(2); Http::assertNotSent(fn($request)=>$request->method() !== 'GET');
    }
}
