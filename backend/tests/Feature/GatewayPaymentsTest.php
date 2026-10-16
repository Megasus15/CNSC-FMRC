<?php
namespace Tests\Feature;

use App\Models\{Order, Payment, Product, User};
use App\Services\{GatewayPayments, PayMongoService};
use App\Support\GatewayFinancials;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GatewayPaymentsTest extends TestCase {
    use RefreshDatabase;
    protected function setUp(): void {
        parent::setUp(); Mail::fake();
        config(['payments.gateway'=>'paymongo','payments.paymongo.enabled'=>true,'payments.paymongo.secret_key'=>'sk_test_example','payments.paymongo.webhook_secret'=>'whsec_example']);
        Http::preventStrayRequests();
    }
    private function order(array $orderFields = []): Order {
        $u = User::factory()->create(['role'=>'customer']);
        $o = Order::create(array_merge(['order_no'=>'ORD-'.Str::random(8),'customer_id'=>$u->id,'customer_name'=>$u->name,'customer_contact'=>$u->email,'quantity'=>1,'subtotal'=>500,'total'=>500,'payment_method'=>'GCash','payment_reference'=>'Awaiting payment','fulfillment_type'=>'pickup','lifecycle_status'=>'incoming','customer_stage'=>'to_pay'], $orderFields));
        Payment::create(['order_id'=>$o->id,'payment_no'=>'PAY-'.$o->id,'method'=>'GCash','gateway'=>'paymongo','reference'=>'Awaiting payment','amount'=>500,'status'=>'pending']);
        return $o->fresh();
    }
    private function attempt(Order $o, bool $live=false, string $method='gcash'): object {
        $id = DB::table('payment_attempts')->insertGetId(['payment_id'=>$o->payment->id,'token'=>(string)Str::uuid(),'checkout_id'=>'cs_'.Str::random(12),'checkout_url'=>'https://checkout.paymongo.com/test','api_version'=>'v2','checkout_method'=>$method,'livemode'=>$live,'amount_centavos'=>50000,'status'=>'pending','created_at'=>now(),'updated_at'=>now()]);
        return DB::table('payment_attempts')->find($id);
    }
    private function providerSession(object $a, array $paymentOverrides=[]): array {
        $p = Payment::findOrFail($a->payment_id);
        return ['id'=>$a->checkout_id,'attributes'=>['livemode'=>(bool)$a->livemode,'status'=>'active','metadata'=>['attempt_token'=>$a->token,'payment_id'=>(string)$p->id,'order_id'=>(string)$p->order_id],
            'payments'=>[['id'=>'pay_'.str_replace('-','',$a->token),'attributes'=>array_merge(['amount'=>50000,'currency'=>'PHP','livemode'=>(bool)$a->livemode,'status'=>'paid','source'=>['type'=>'gcash']],$paymentOverrides)]]]];
    }
    public function test_saved_phone_never_pays_and_duplicate_submission_reserves_stock_once(): void {
        $u=User::factory()->create(['role'=>'customer','gcash_phone'=>'09171234567']); Sanctum::actingAs($u);
        $p=Product::create(['name'=>'Test','category'=>'Fabrication','code'=>'PAYTEST','stock'=>10,'price'=>500,'unit_price'=>500]);
        Http::fake(['api.paymongo.com/v2/checkout_sessions'=>function($r){
            $this->assertSame(100000,$r['data']['attributes']['line_items'][0]['amount']);
            $this->assertTrue($r->hasHeader('Idempotency-Key'));
            return Http::response(['data'=>['id'=>'cs_created','attributes'=>['checkout_url'=>'https://checkout.paymongo.com/test','livemode'=>false]]]);
        },'api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>['id'=>'cs_created','attributes'=>['livemode'=>false,'payments'=>[]]]])]);
        $body=['product_id'=>$p->id,'product_name'=>'Test','quantity'=>2,'unit_price'=>0.01,'total_amount'=>0.02,'payment_method'=>'GCash','fulfillment_type'=>'pickup','checkout_request_key'=>(string)Str::uuid()];
        $r=$this->postJson('/api/orders',$body)->assertCreated()->assertJsonPath('data.payment_status','pending')->assertJsonPath('data.checkout_url','https://checkout.paymongo.com/test');
        $this->postJson('/api/orders',$body)->assertCreated()->assertJsonPath('data.id',$r->json('data.id'));
        $this->assertDatabaseCount('orders',1); $this->assertDatabaseCount('payment_attempts',1); $this->assertSame(8,$p->fresh()->stock);
        $this->postJson('/api/orders',array_merge($body,['quantity'=>3]))->assertStatus(409);
    }
    public function test_unavailable_gateway_never_falls_back_to_manual(): void {
        Sanctum::actingAs(User::factory()->create(['role'=>'customer'])); config(['payments.paymongo.enabled'=>false]);
        $this->postJson('/api/orders',['product_name'=>'Test','quantity'=>1,'total_amount'=>500,'payment_method'=>'GCash','fulfillment_type'=>'pickup','checkout_request_key'=>(string)Str::uuid()])->assertUnprocessable()->assertJsonPath('code','gcash_unavailable');
        $this->assertDatabaseCount('orders',0); Http::assertNothingSent();
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.payment_gcash_ready','0');
    }
    public function test_fake_link_endpoint_is_gone(): void {
        Sanctum::actingAs(User::factory()->create(['role'=>'customer']));
        $this->postJson('/api/customer/gcash-account/link',['phone'=>'09171234567','otp'=>'123456'])->assertStatus(410);
    }
    public function test_confirmation_is_idempotent_and_keeps_order_approval_separate(): void {
        $o=$this->order(); $a=$this->attempt($o); $g=app(GatewayPayments::class);
        $this->assertTrue($g->applySession($a->id,$this->providerSession($a)));
        $g->applySession($a->id,$this->providerSession($a));
        $this->assertSame('paid',$o->fresh()->payment->status);$this->assertSame('incoming',$o->fresh()->lifecycle_status);$this->assertSame('to_pay',$o->fresh()->customer_stage);
        $this->assertDatabaseCount('order_tracking_events',1);$this->assertDatabaseCount('admin_notifications',1);
        Sanctum::actingAs($o->customer);$this->getJson('/api/customer/orders/'.$o->id)->assertOk()->assertJsonPath('data.payment_awaiting_approval',true);
        $this->assertSame(0.0,GatewayFinancials::total('receipts'));
    }
    public function test_failed_payment_in_nonempty_payments_array_is_not_confirmation(): void {
        $o=$this->order();$a=$this->attempt($o); app(GatewayPayments::class)->applySession($a->id,$this->providerSession($a,['status'=>'failed']));
        $this->assertSame('pending',$o->fresh()->payment->status);
    }
    public function test_wrong_amount_currency_mode_source_and_association_are_rejected(): void {
        foreach ([['amount'=>1],['currency'=>'USD'],['livemode'=>true],['source'=>['type'=>'card']]] as $fields) {
            $o=$this->order();$a=$this->attempt($o);$this->assertFalse(app(GatewayPayments::class)->applySession($a->id,$this->providerSession($a,$fields)));$this->assertSame('pending',$o->fresh()->payment->status);
        }
        $o=$this->order();$a=$this->attempt($o);$s=$this->providerSession($a);$s['attributes']['metadata']['order_id']='999';
        $this->assertFalse(app(GatewayPayments::class)->applySession($a->id,$s));
    }
    public function test_missing_invalid_and_stale_signatures_fail_closed(): void {
        $this->postJson('/api/webhooks/paymongo',[])->assertForbidden();
        config(['payments.paymongo.webhook_secret'=>'']);
        $this->postJson('/api/webhooks/paymongo',[])->assertForbidden();
        config(['payments.paymongo.webhook_secret'=>'whsec_example']);
        $body='{}';$ts=time()-600;$sig=hash_hmac('sha256',$ts.'.'.$body,'whsec_example');
        $this->call('POST','/api/webhooks/paymongo',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_PAYMONGO_SIGNATURE'=>'t='.$ts.',te='.$sig],$body)->assertForbidden();
    }
    public function test_webhook_is_durable_deduplicated_and_processed_by_scheduler(): void {
        $o=$this->order();$a=$this->attempt($o);$session=$this->providerSession($a);
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>$session])]);
        $event=['data'=>['id'=>'evt_1','attributes'=>['type'=>'checkout_session.payment.paid','livemode'=>false,'data'=>$session]]];
        $body=json_encode($event);$ts=time();$sig=hash_hmac('sha256',$ts.'.'.$body,'whsec_example');
        for($i=0;$i<2;$i++)$this->call('POST','/api/webhooks/paymongo',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_PAYMONGO_SIGNATURE'=>'t='.$ts.',te='.$sig],$body)->assertOk();
        $this->assertDatabaseCount('payment_webhook_events',1);$this->assertSame('paid',$o->fresh()->payment->status);
        $this->artisan('payments:reconcile')->assertSuccessful();$this->assertSame('paid',$o->fresh()->payment->status);
        $this->assertDatabaseHas('payment_webhook_events',['event_key'=>'evt_1','status'=>'processed']);
    }
    public function test_early_webhook_recovers_missing_session_association(): void {
        $o=$this->order();$a=$this->attempt($o);$session=$this->providerSession($a);
        DB::table('payment_attempts')->where('id',$a->id)->update(['checkout_id'=>null,'status'=>'creating']);
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>$session])]);
        $id=DB::table('payment_webhook_events')->insertGetId(['event_key'=>'evt_early','event_type'=>'checkout_session.payment.paid','resource_id'=>$a->checkout_id,'attempt_token'=>$a->token,'livemode'=>false,'created_at'=>now(),'updated_at'=>now()]);
        $this->assertTrue(app(GatewayPayments::class)->processEvent(DB::table('payment_webhook_events')->find($id)));
        $this->assertSame('paid',$o->fresh()->payment->status);
    }
    public function test_late_payment_does_not_reopen_cancelled_order(): void {
        $o=$this->order(['lifecycle_status'=>'cancelled']);$a=$this->attempt($o);
        app(GatewayPayments::class)->applySession($a->id,$this->providerSession($a));
        $this->assertSame('cancelled',$o->fresh()->lifecycle_status);$this->assertSame('to_pay',$o->fresh()->customer_stage);
        $this->assertDatabaseHas('payment_attempts',['id'=>$a->id,'exception'=>'late_payment_refund_review']);
    }
    public function test_customer_cannot_read_or_retry_another_customers_payment(): void {
        $o=$this->order();Sanctum::actingAs(User::factory()->create(['role'=>'customer']));
        $this->getJson('/api/customer/orders/'.$o->id.'/payment-status')->assertForbidden();
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertForbidden();
        $this->getJson('/api/admin/gateway-payments')->assertForbidden();
    }
    public function test_gateway_record_without_session_cannot_be_manually_marked_paid(): void {
        $o=$this->order();Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->patchJson('/api/admin/orders/'.$o->id.'/payment-status',['status'=>'paid','confirmed_received'=>true])->assertUnprocessable();
        Sanctum::actingAs($o->customer);$this->postJson('/api/customer/orders/'.$o->id.'/payment',['payment_reference'=>'1234567890123'])->assertUnprocessable();
    }
    public function test_refunds_require_admin_and_provider_confirmation_with_cumulative_limits(): void {
        $o=$this->order();$a=$this->attempt($o);app(GatewayPayments::class)->applySession($a->id,$this->providerSession($a));
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $body=['amount_centavos'=>20000,'reason'=>'Partial return','request_key'=>(string)Str::uuid()];
        $id=$this->postJson('/api/admin/orders/'.$o->id.'/gateway-refunds',$body)->assertCreated()->json('data.id');
        $this->postJson('/api/admin/orders/'.$o->id.'/gateway-refunds',$body)->assertCreated();$this->assertDatabaseCount('payment_refunds',1);
        $this->postJson('/api/admin/gateway-refunds/'.$id.'/approve')->assertForbidden();
        $this->postJson('/api/admin/orders/'.$o->id.'/gateway-refunds',['amount_centavos'=>40000,'reason'=>'Too much','request_key'=>(string)Str::uuid()])->assertUnprocessable();
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $attrs=['payment_id'=>$o->fresh()->payment->paymongo_payment_id,'amount'=>20000,'currency'=>'PHP','livemode'=>false,'status'=>'pending'];
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::response(['data'=>['id'=>'ref_one','attributes'=>$attrs]])]);
        $this->postJson('/api/admin/gateway-refunds/'.$id.'/approve')->assertOk();
        $this->assertDatabaseHas('payment_refunds',['id'=>$id,'status'=>'pending']);$this->assertSame('paid',$o->fresh()->payment->status);
        $attrs['status']='succeeded';Http::fake(['api.paymongo.com/v1/refunds/ref_one'=>Http::response(['data'=>['id'=>'ref_one','attributes'=>$attrs]])]);
        app(GatewayPayments::class)->reconcileRefund(DB::table('payment_refunds')->find($id));
        $this->assertDatabaseHas('payment_refunds',['id'=>$id,'status'=>'succeeded']);$this->assertSame('paid',$o->fresh()->payment->status);
    }
    public function test_live_ledger_counts_receipts_and_confirmed_refunds_separately(): void {
        config(['payments.paymongo.secret_key'=>'sk_live_example']);$o=$this->order();$a=$this->attempt($o,true);
        app(GatewayPayments::class)->applySession($a->id,$this->providerSession($a));$this->assertSame(500.0,GatewayFinancials::total('receipts'));
        $this->assertSame(0.0,GatewayFinancials::total('refunds'));
    }
    public function test_timeout_retry_reuses_provider_key_and_never_creates_second_attempt(): void {
        $o=$this->order(); Sanctum::actingAs($o->customer);$keys=[];
        Http::fake(['api.paymongo.com/v2/checkout_sessions'=>function($r)use(&$keys){$keys[]=$r->header('Idempotency-Key')[0];return Http::response([],503);}]);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk()->assertJsonPath('attempt_status','unknown')->assertJsonPath('checkout_url',null);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk();
        $this->assertDatabaseCount('payment_attempts',1);$this->assertSame($keys[0],$keys[1]);
        DB::table('payment_attempts')->update(['created_at'=>now()->subHours(24)]);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk();$this->assertCount(2,$keys);
    }
    public function test_expired_session_is_verified_before_a_new_attempt_is_created(): void {
        $o=$this->order();$a=$this->attempt($o);$s=$this->providerSession($a);$s['attributes']['payments']=[];$s['attributes']['status']='expired';
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>$s]),'api.paymongo.com/v2/checkout_sessions'=>Http::response(['data'=>['id'=>'cs_retried','attributes'=>['livemode'=>false,'checkout_url'=>'https://checkout.paymongo.com/retry']]])]);
        Sanctum::actingAs($o->customer);$this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk()->assertJsonPath('checkout_url','https://checkout.paymongo.com/retry');
        $this->assertDatabaseCount('payment_attempts',2);
    }
    public function test_disabled_new_checkout_does_not_disable_confirmation(): void {
        $o=$this->order();$a=$this->attempt($o);config(['payments.paymongo.enabled'=>false]);
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>$this->providerSession($a)])]);
        Sanctum::actingAs($o->customer);$this->getJson('/api/customer/orders/'.$o->id.'/payment-status')->assertOk()->assertJsonPath('status','paid');
    }
    public function test_v1_checkout_without_new_metadata_can_be_reconciled_by_stored_id(): void {
        $o=$this->order();$o->payment->update(['paymongo_checkout_id'=>'cs_legacy']);$g=app(GatewayPayments::class);$a=$g->attempt($o->fresh()->payment);$s=$this->providerSession($a);unset($s['attributes']['metadata']);
        $this->assertTrue($g->applySession($a->id,$s));$this->assertSame('paid',$o->fresh()->payment->status);
    }
    public function test_out_of_order_failure_never_reverses_paid_payment(): void {
        $o=$this->order();$a=$this->attempt($o);$g=app(GatewayPayments::class);$g->applySession($a->id,$this->providerSession($a));
        $g->applySession($a->id,$this->providerSession($a,['status'=>'failed']));$this->assertSame('paid',$o->fresh()->payment->status);
        $this->assertDatabaseHas('payment_attempts',['id'=>$a->id,'status'=>'paid']);
    }
    public function test_full_refund_is_closed_only_when_provider_confirms(): void {
        $o=$this->order();$a=$this->attempt($o);$g=app(GatewayPayments::class);$g->applySession($a->id,$this->providerSession($a));
        $admin=User::factory()->create(['role'=>'admin']);$r=$g->requestRefund($o->fresh()->payment,50000,'Cancelled',$admin->id,(string)Str::uuid());
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::response(['data'=>['id'=>'ref_full','attributes'=>['amount'=>50000,'currency'=>'PHP','livemode'=>false,'payment_id'=>$o->fresh()->payment->paymongo_payment_id,'status'=>'succeeded']]])]);
        $g->approveRefund($r->id,$admin->id);$g->approveRefund($r->id,$admin->id);Http::assertSentCount(1);
        $this->assertSame('refunded',$o->fresh()->payment->status);
    }
    public function test_definitive_refund_failure_releases_reserved_amount_for_new_request(): void {
        $o=$this->order();$a=$this->attempt($o);$g=app(GatewayPayments::class);$g->applySession($a->id,$this->providerSession($a));
        $admin=User::factory()->create(['role'=>'admin']);$r=$g->requestRefund($o->fresh()->payment,50000,'Cancelled',$admin->id,(string)Str::uuid());
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::response([],422)]);$g->approveRefund($r->id,$admin->id);
        $this->assertDatabaseHas('payment_refunds',['id'=>$r->id,'status'=>'failed']);
        $next=$g->requestRefund($o->fresh()->payment,50000,'Retry after rejection',$admin->id,(string)Str::uuid());$this->assertNotSame($r->id,$next->id);
    }
    public function test_fake_simulator_never_confirms_and_production_rejects_test_keys(): void {
        $this->assertNull(app(PayMongoService::class)->retrieveCheckoutSession('cs_sim_fake'));
        config(['payments.paymongo.sandbox_simulator'=>true]);
        $this->assertFalse(app(PayMongoService::class)->verifyWebhookSignature('{}','simulated_test_signature'));
        $this->app->instance('env','production');$this->assertFalse(app(PayMongoService::class)->isConfigured());
    }
    public function test_legacy_linked_paid_rows_do_not_inflate_receipts(): void {
        $o=$this->order(['lifecycle_status'=>'completed']);$o->payment->update(['gateway'=>null,'status'=>'paid','reference'=>'GCASH-4567-FAKE','paid_at'=>now()]);
        $this->assertFalse(Order::legacyReceipts()->whereKey($o->id)->exists());
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->getJson('/api/admin/gateway-payments?review=1')->assertOk()->assertJsonPath('payments.total',1);
    }


    public function test_duplicate_provider_receipts_are_preserved_without_reopening_fulfillment(): void {
        $o=$this->order(['lifecycle_status'=>'cancelled']); $a=$this->attempt($o); $g=app(GatewayPayments::class);
        $session=$this->providerSession($a);
        $session['attributes']['payments'][]=array_merge($session['attributes']['payments'][0],['id'=>'pay_second']);
        $g->applySession($a->id,$session);
        $g->applySession($a->id,$session);
        $this->assertDatabaseCount('payment_receipts',2);
        $this->assertSame('cancelled',$o->fresh()->lifecycle_status);
        $this->assertNotNull(DB::table('payment_attempts')->find($a->id)->exception);
    }
    public function test_environment_change_does_not_offer_an_old_checkout(): void {
        $o=$this->order(); $this->attempt($o);
        config(['payments.paymongo.secret_key'=>'sk_live_example']);
        $state=app(GatewayPayments::class)->state($o);
        $this->assertNull($state['checkout_url']);
        $this->assertFalse($state['retry_allowed']);
    }

    public function test_qrph_checkout_requests_only_the_active_method_and_keeps_fees_with_merchant(): void {
        config(['payments.paymongo.checkout_method'=>'qrph']);
        $o=$this->order(); Sanctum::actingAs($o->customer);
        Http::fake(['api.paymongo.com/v2/checkout_sessions'=>function($request) use ($o) {
            $attrs=$request['data']['attributes'];
            $this->assertSame(['qrph'],$attrs['payment_method_types']);
            $this->assertFalse($attrs['pass_on_fees']);
            $this->assertSame(50000,$attrs['line_items'][0]['amount']);
            $this->assertSame((string)$o->id,$attrs['metadata']['order_id']);
            return Http::response(['data'=>['id'=>'cs_qrph','attributes'=>['checkout_url'=>'https://checkout.paymongo.com/qrph','livemode'=>false]]]);
        }]);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk()
            ->assertJsonPath('checkout_method','qrph')->assertJsonPath('checkout_label','GCash / QR Ph')
            ->assertJsonPath('checkout_url','https://checkout.paymongo.com/qrph');
        $this->assertDatabaseHas('payment_attempts',['payment_id'=>$o->payment->id,'checkout_method'=>'qrph']);
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.payment_checkout_method','qrph')
            ->assertJsonPath('data.payment_gcash_ready','1');
    }

    public function test_signed_v2_qrph_notification_confirms_once_using_retrieved_payment(): void {
        config(['payments.paymongo.checkout_method'=>'qrph']);
        $o=$this->order(); $a=$this->attempt($o,false,'qrph');
        $session=$this->providerSession($a,['source'=>['type'=>'qrph']]);
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>$session])]);
        $event=['event_type'=>'send.webhook','data'=>['type'=>'checkout_session.payment.paid','livemode'=>false,'data'=>$session]];
        $body=json_encode($event);$ts=time();$sig=hash_hmac('sha256',$ts.'.'.$body,'whsec_example');
        for($i=0;$i<2;$i++) $this->call('POST','/api/webhooks/paymongo',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_PAYMONGO_SIGNATURE'=>'t='.$ts.',te='.$sig],$body)->assertOk();
        $this->assertDatabaseCount('payment_webhook_events',1);
        $this->assertDatabaseCount('payment_receipts',1);
        $this->assertDatabaseHas('payment_receipts',['payment_id'=>$o->payment->id,'source_type'=>'qrph']);
        $this->assertDatabaseHas('order_tracking_events',['order_id'=>$o->id,'title'=>'QR Ph payment confirmed']);
        $this->assertSame('incoming',$o->fresh()->lifecycle_status);
        config(['payments.paymongo.checkout_method'=>'gcash']);
        Sanctum::actingAs($o->customer);
        $this->getJson('/api/customer/orders/'.$o->id)->assertOk()->assertJsonPath('data.payment_method_label','QR Ph')
            ->assertJsonPath('data.payment_checkout_method','qrph')->assertJsonPath('data.payment_awaiting_approval',true);
        $this->getJson('/api/customer/orders/'.$o->id.'/payment-status')->assertOk()
            ->assertJsonPath('status','paid')->assertJsonPath('method_label','QR Ph')->assertJsonPath('checkout_url',null);
    }

    public function test_qrph_attempt_rejects_other_sources_and_unverified_amounts(): void {
        foreach ([['source'=>['type'=>'gcash']],['source'=>['type'=>'card']],['amount'=>49999],['currency'=>'USD'],['livemode'=>true]] as $override) {
            $o=$this->order(); $a=$this->attempt($o,false,'qrph');
            $session=$this->providerSession($a,array_merge(['source'=>['type'=>'qrph']],$override));
            $this->assertFalse(app(GatewayPayments::class)->applySession($a->id,$session));
            $this->assertSame('pending',$o->fresh()->payment->status);
        }
        $this->assertDatabaseCount('payment_receipts',0);
    }

    public function test_pending_retry_keeps_original_method_and_idempotency_payload_after_config_change(): void {
        $requests=[];
        Http::fake(['api.paymongo.com/v2/checkout_sessions'=>function($request) use (&$requests) {
            $requests[]=['attributes'=>$request['data']['attributes'],'key'=>$request->header('Idempotency-Key')[0]];
            return Http::response([],503);
        }]);
        foreach (['qrph'=>'gcash','gcash'=>'qrph'] as $original=>$changed) {
            config(['payments.paymongo.checkout_method'=>$original]);
            $o=$this->order();$requests=[];Sanctum::actingAs($o->customer);
            $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk()->assertJsonPath('attempt_status','unknown');
            config(['payments.paymongo.checkout_method'=>$changed]);
            $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk()->assertJsonPath('checkout_method',$original);
            $this->assertCount(2,$requests);$this->assertSame($requests[0],$requests[1]);
            $this->assertSame([$original],$requests[1]['attributes']['payment_method_types']);
        }
    }

    public function test_invalid_checkout_method_blocks_new_payments_without_provider_call(): void {
        config(['payments.paymongo.checkout_method'=>'unsupported']);
        $o=$this->order();Sanctum::actingAs($o->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertUnprocessable();
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.payment_gcash_ready','0');
        Http::assertNothingSent();$this->assertDatabaseCount('payment_attempts',0);
    }

    public function test_expired_qr_event_does_not_replace_an_active_checkout_session(): void {
        $o=$this->order();$a=$this->attempt($o,false,'qrph');
        $session=$this->providerSession($a);$session['attributes']['payments']=[];
        Http::fake(['api.paymongo.com/v1/checkout_sessions/*'=>Http::response(['data'=>$session])]);
        $body=json_encode(['data'=>['id'=>'evt_qrexpired','attributes'=>['type'=>'qrph.expired','livemode'=>false,'data'=>['id'=>'pi_expiredqr']]]]);
        $ts=time();$sig=hash_hmac('sha256',$ts.'.'.$body,'whsec_example');
        $this->call('POST','/api/webhooks/paymongo',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_PAYMONGO_SIGNATURE'=>'t='.$ts.',te='.$sig],$body)->assertOk();
        Sanctum::actingAs($o->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/payment-checkout')->assertOk()->assertJsonPath('checkout_url',$a->checkout_url)
            ->assertJsonPath('retry_allowed',false);
        $this->assertDatabaseCount('payment_attempts',1);
        Http::assertNotSent(fn($request)=>$request->method()==='POST');
    }

    public function test_qrph_refund_preserves_original_payment_reference_and_method(): void {
        $o=$this->order();$a=$this->attempt($o,false,'qrph');$gateway=app(GatewayPayments::class);
        $gateway->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        $payment=$o->fresh()->payment;$admin=User::factory()->create(['role'=>'admin']);
        $refund=$gateway->requestRefund($payment,50000,'Cancelled order',$admin->id,(string)Str::uuid());
        config(['payments.paymongo.checkout_method'=>'gcash']);
        Http::fake(['api.paymongo.com/v1/refunds'=>function($request) use ($payment) {
            $this->assertSame($payment->paymongo_payment_id,$request['data']['attributes']['payment_id']);
            return Http::response(['data'=>['id'=>'ref_qr','attributes'=>['payment_id'=>$payment->paymongo_payment_id,'amount'=>50000,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded']]]);
        }]);
        $gateway->approveRefund($refund->id,$admin->id);
        $this->assertSame('refunded',$o->fresh()->payment->status);
        $this->assertDatabaseHas('order_tracking_events',['order_id'=>$o->id,'title'=>'QR Ph refund confirmed']);
    }

    public function test_staff_rejection_queues_live_qr_refund_and_admin_confirmation_adjusts_revenue_once(): void {
        config(['payments.paymongo.secret_key'=>'sk_live_example']);
        $o=$this->order(); $a=$this->attempt($o,true,'qrph'); $g=app(GatewayPayments::class);
        $g->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$o->id.'/reject',['reason'=>'Unable to fulfill'])->assertOk();
        $refund=DB::table('payment_refunds')->first();
        $this->assertSame('requested',$refund->status); $this->assertSame(50000,$refund->amount_centavos);
        $this->assertSame($o->fresh()->payment->paymongo_payment_id,$refund->provider_payment_id);
        Http::assertNothingSent();
        $this->postJson('/api/admin/gateway-refunds/'.$refund->id.'/approve')->assertForbidden();
        $g->queueClosedOrderRefunds($o->fresh(),$o->customer_id); $this->assertDatabaseCount('payment_refunds',1);
        Sanctum::actingAs($o->customer);
        $this->getJson('/api/customer/orders/'.$o->id)->assertOk()->assertJsonPath('data.payment_refund_status','requested');
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $attrs=['payment_id'=>$refund->provider_payment_id,'amount'=>50000,'currency'=>'PHP','livemode'=>true,'status'=>'pending'];
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::response(['data'=>['id'=>'ref_closed','attributes'=>$attrs]])]);
        $this->postJson('/api/admin/gateway-refunds/'.$refund->id.'/approve')->assertOk()->assertJsonPath('data.status','pending');
        $this->postJson('/api/admin/gateway-refunds/'.$refund->id.'/approve')->assertOk(); Http::assertSentCount(1);
        $this->assertSame(500.0,GatewayFinancials::total('receipts')); $this->assertSame(0.0,GatewayFinancials::total('refunds'));
        $attrs['status']='succeeded'; Http::fake(['api.paymongo.com/v1/refunds/ref_closed'=>Http::response(['data'=>['id'=>'ref_closed','attributes'=>$attrs]])]);
        $g->reconcileRefund(DB::table('payment_refunds')->find($refund->id));
        $g->reconcileRefund(DB::table('payment_refunds')->find($refund->id));
        $this->assertSame('refunded',$o->fresh()->payment->status); $this->assertSame('rejected',$o->fresh()->lifecycle_status);
        $this->assertSame(500.0,GatewayFinancials::total('refunds'));
        $this->assertSame(1,DB::table('order_tracking_events')->where('order_id',$o->id)->where('title','QR Ph refund confirmed')->count());
    }

    public function test_bulk_rejection_queues_only_confirmed_online_payments(): void {
        $paid=$this->order(); $a=$this->attempt($paid,false,'qrph');
        app(GatewayPayments::class)->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        $unpaid=$this->order(); Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/reject-bulk',['ids'=>[$paid->id,$unpaid->id]])->assertOk();
        $this->assertDatabaseCount('payment_refunds',1);
        $this->assertDatabaseHas('payment_refunds',['payment_id'=>$paid->payment->id,'status'=>'requested','amount_centavos'=>50000]);
        Http::assertNothingSent();
    }

    public function test_approved_cancellation_queues_refund_and_clears_due_only_on_confirmation(): void {
        $o=$this->order(); $a=$this->attempt($o,false,'qrph'); $g=app(GatewayPayments::class);
        $g->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        Sanctum::actingAs($o->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/cancel',['reason'=>'no_longer_needed'])->assertOk();
        $this->assertDatabaseCount('payment_refunds',0);
        $admin=User::factory()->create(['role'=>'admin']); Sanctum::actingAs($admin);
        $this->postJson('/api/admin/orders/'.$o->id.'/cancellation',['decision'=>'approve'])->assertOk();
        $r=DB::table('payment_refunds')->first(); $this->assertNotNull($r);
        $this->assertTrue($o->fresh()->cancel_refund_due); $this->assertSame('cancelled',$o->fresh()->lifecycle_status);
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::response(['data'=>['id'=>'ref_cancel','attributes'=>['payment_id'=>$r->provider_payment_id,'amount'=>50000,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded']]])]);
        $g->approveRefund($r->id,$admin->id);
        $this->assertFalse($o->fresh()->cancel_refund_due);
    }

    public function test_scheduler_backfills_remaining_balance_without_duplicating_or_resending_declined_refunds(): void {
        $o=$this->order(); $a=$this->attempt($o,false,'qrph'); $g=app(GatewayPayments::class);
        $g->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        $admin=User::factory()->create(['role'=>'admin']);
        $g->requestRefund($o->fresh()->payment,10000,'Partial adjustment',$admin->id,(string)Str::uuid());
        $o->update(['lifecycle_status'=>'rejected']);
        $this->artisan('payments:reconcile')->assertSuccessful(); $this->artisan('payments:reconcile')->assertSuccessful();
        $this->assertDatabaseCount('payment_refunds',2);
        $auto=DB::table('payment_refunds')->orderByDesc('id')->first(); $this->assertSame(40000,$auto->amount_centavos);
        Sanctum::actingAs($admin);
        $this->postJson('/api/admin/gateway-refunds/'.$auto->id.'/reject',['reason'=>'Duplicate request requires review'])->assertOk();
        $this->artisan('payments:reconcile')->assertSuccessful();
        $this->assertDatabaseCount('payment_refunds',2); Http::assertNothingSent();
        $this->getJson('/api/admin/gateway-payments?refunds=1&order_id='.$o->id)->assertOk()->assertJsonPath('payments.total',1);
        $this->assertDatabaseHas('order_tracking_events',['order_id'=>$o->id,'title'=>'Refund request declined']);
    }

    public function test_late_qr_payment_on_rejected_order_reserves_one_refund_without_reopening(): void {
        $o=$this->order(['lifecycle_status'=>'rejected']); $a=$this->attempt($o,false,'qrph'); $g=app(GatewayPayments::class);
        $session=$this->providerSession($a,['source'=>['type'=>'qrph']]);
        $g->applySession($a->id,$session); $g->applySession($a->id,$session);
        $this->assertDatabaseCount('payment_refunds',1); $this->assertSame('rejected',$o->fresh()->lifecycle_status);
        $state=$g->state($o->fresh()); $this->assertSame('rejected',$state['order_status']); $this->assertNull($state['checkout_url']);
        $this->assertSame('requested',$state['refunds'][0]->status); Http::assertNothingSent();
    }

    public function test_return_refund_can_retry_definitive_failure_with_a_new_key_and_keeps_return_link(): void {
        $o=$this->order(['lifecycle_status'=>'completed','customer_stage'=>'completed']); $a=$this->attempt($o); $g=app(GatewayPayments::class);
        $g->applySession($a->id,$this->providerSession($a));
        $return=\App\Models\OrderReturn::create(['order_id'=>$o->id,'customer_id'=>$o->customer_id,'return_no'=>'RTN-RETRY','status'=>'approved','resolution'=>'refund','reason'=>'damaged','requested_amount'=>500,'approved_amount'=>500]);
        $admin=User::factory()->create(['role'=>'admin']); Sanctum::actingAs($admin);
        $url='/api/admin/returns/'.$return->id.'/refund'; $body=['amount'=>500,'request_key'=>(string)Str::uuid()];
        $id=$this->postJson($url,$body)->assertOk()->json('refund_request.id');
        $this->postJson($url,$body)->assertOk(); $this->assertDatabaseCount('payment_refunds',1);
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::sequence()->push([],422)->push(['data'=>['id'=>'ref_return','attributes'=>['payment_id'=>$o->fresh()->payment->paymongo_payment_id,'amount'=>50000,'currency'=>'PHP','livemode'=>false,'status'=>'succeeded']]])]);
        $g->approveRefund($id,$admin->id);
        $body['request_key']=(string)Str::uuid();
        $retry=$this->postJson($url,$body)->assertOk()->json('refund_request.id'); $this->assertNotSame($id,$retry);
        $g->approveRefund($retry,$admin->id); $this->assertSame('refunded',$return->fresh()->status);
        $this->assertDatabaseHas('order_return_events',['order_return_id'=>$return->id,'title'=>'Refund confirmed']);
        $this->postJson($url,$body)->assertOk(); $this->assertSame('refunded',$return->fresh()->status);
    }

    public function test_failed_refund_diagnostics_and_retry_permissions_are_safe(): void {
        config(['payments.paymongo.secret_key'=>'sk_live_example']);
        $o=$this->order();$a=$this->attempt($o,true,'qrph');$g=app(GatewayPayments::class);
        $g->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        $admin=User::factory()->create(['role'=>'admin']);
        $r=$g->requestRefund($o->fresh()->payment,50000,'Order rejected',$admin->id,(string)Str::uuid());
        Http::fake(['api.paymongo.com/v1/refunds'=>Http::sequence()
            ->push(['errors'=>[['code'=>'insufficient_balance','detail'=>'Insufficient funds private@example.test sk_live_do_not_expose']]],422)
            ->push(['data'=>['id'=>'ref_retry','attributes'=>['payment_id'=>$r->provider_payment_id,'amount'=>50000,'currency'=>'PHP','livemode'=>true,'status'=>'processing']]])]);
        Sanctum::actingAs($admin);
        $response=$this->postJson('/api/admin/gateway-refunds/'.$r->id.'/approve')->assertOk()->assertJsonPath('data.status','failed')->assertJsonPath('data.error_code','insufficient_balance');
        $this->assertStringContainsString('available funds',$response->json('data.failure_message'));
        $this->assertStringNotContainsString('sk_live_do_not_expose',$response->getContent());
        $this->assertStringNotContainsString('private@example.test',DB::table('order_tracking_events')->where('title','Refund needs attention')->value('metadata'));
        $this->assertSame(0.0,GatewayFinancials::total('refunds'));
        $url='/api/admin/gateway-refunds/'.$r->id.'/retry';$body=['request_key'=>(string)Str::uuid(),'issue'=>true];
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson($url,$body)->assertForbidden();$body['issue']=false;
        $next=$this->postJson($url,$body)->assertOk()->assertJsonPath('data.status','requested')->json('data.id');
        $this->postJson($url,$body)->assertOk()->assertJsonPath('data.id',$next);Http::assertSentCount(1);
        Sanctum::actingAs($admin);$body['issue']=true;
        $this->postJson($url,$body)->assertOk()->assertJsonPath('data.status','pending');
        $this->postJson($url,$body)->assertOk()->assertJsonPath('data.status','pending');Http::assertSentCount(2);
        $this->getJson('/api/admin/gateway-payments?refund_status=processing&search='.$o->order_no)->assertOk()->assertJsonPath('payments.total',1)->assertJsonPath('refund_summary.failed',0)->assertJsonPath('refund_summary.processing',1);
        $this->postJson('/api/admin/gateway-refunds/'.$next.'/retry',['request_key'=>(string)Str::uuid(),'issue'=>true])->assertUnprocessable();
    }

    public function test_status_check_never_issues_money_and_refund_reduces_both_portals_revenue_once(): void {
        config(['payments.paymongo.secret_key'=>'sk_live_example']);
        $o=$this->order();$a=$this->attempt($o,true,'qrph');$g=app(GatewayPayments::class);
        $g->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        $admin=User::factory()->create(['role'=>'admin']);$staff=User::factory()->create(['role'=>'staff']);
        $r=$g->requestRefund($o->fresh()->payment,50000,'Rejected order',$admin->id,(string)Str::uuid());
        Sanctum::actingAs($staff);
        $this->postJson('/api/admin/gateway-refunds/'.$r->id.'/check')->assertOk()->assertJsonPath('data.status','requested');Http::assertNothingSent();
        DB::table('payment_refunds')->where('id',$r->id)->update(['status'=>'pending','approved_by'=>$admin->id,'provider_refund_id'=>'ref_check']);
        Http::fake(['api.paymongo.com/v1/refunds/ref_check'=>Http::response(['data'=>['id'=>'ref_check','attributes'=>['payment_id'=>$r->provider_payment_id,'amount'=>50000,'currency'=>'PHP','livemode'=>true,'status'=>'succeeded']]])]);
        foreach([$admin,$staff] as $user){Sanctum::actingAs($user);$this->getJson('/api/admin/dashboard/summary')->assertOk()->assertJsonPath('data.counts.total_revenue',500);}
        DB::table('payment_receipts')->update(['confirmed_at'=>now()->subDays(2)]);
        Sanctum::actingAs($staff);
        $this->postJson('/api/admin/gateway-refunds/'.$r->id.'/check')->assertOk()->assertJsonPath('data.status','succeeded');
        $this->postJson('/api/admin/gateway-refunds/'.$r->id.'/check')->assertOk();Http::assertSentCount(1);
        Http::assertNotSent(fn($request)=>$request->method()==='POST');
        foreach([$admin,$staff] as $user){
            Sanctum::actingAs($user);
            $this->getJson('/api/admin/dashboard/summary')->assertOk()->assertJsonPath('data.counts.total_revenue',0);
            $this->getJson('/api/admin/dashboard/revenue?period=day')->assertOk()->assertJsonPath('data.period.collected',-500);
        }
        DB::table('payment_refunds')->insert(['payment_id'=>$r->payment_id,'provider_payment_id'=>$r->provider_payment_id,'token'=>(string)Str::uuid(),'requested_by'=>$admin->id,'amount_centavos'=>50000,'reason'=>'Previous failed attempt','livemode'=>true,'status'=>'failed','created_at'=>now(),'updated_at'=>now()]);
        $this->assertSame('succeeded',GatewayPayments::displayFields($o->fresh()->payment)['payment_refund_status']);
    }

    public function test_live_qrph_report_labels_receipt_and_refund_without_guessing_wallet(): void {
        config(['payments.paymongo.secret_key'=>'sk_live_example','payments.paymongo.checkout_method'=>'gcash']);
        $o=$this->order();$a=$this->attempt($o,true,'qrph');$gateway=app(GatewayPayments::class);
        $gateway->applySession($a->id,$this->providerSession($a,['source'=>['type'=>'qrph']]));
        $admin=User::factory()->create(['role'=>'admin']);$payment=$o->fresh()->payment;
        DB::table('payment_refunds')->insert(['payment_id'=>$payment->id,'token'=>(string)Str::uuid(),'provider_payment_id'=>$payment->paymongo_payment_id,
            'requested_by'=>$admin->id,'approved_by'=>$admin->id,'amount_centavos'=>10000,'reason'=>'Partial refund',
            'livemode'=>true,'status'=>'succeeded','confirmed_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        Sanctum::actingAs($admin);
        $response=$this->getJson('/api/admin/reports?'.http_build_query(['category'=>'sales','period'=>'monthly','year'=>now()->year,'month'=>now()->month]))->assertOk();
        $rows=collect($response->json('data.table.rows'))->where('transaction_no',$o->order_no);
        $this->assertCount(2,$rows);$this->assertSame(['QR Ph'],$rows->pluck('payment_method')->unique()->values()->all());
        $this->assertEqualsCanonicalizing(['QR Ph Provider Payment','QR Ph Provider Refund'],$rows->pluck('source')->all());
        $this->assertEquals(400,$rows->sum('amount'));
    }
}
