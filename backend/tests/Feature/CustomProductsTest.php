<?php

namespace Tests\Feature;

use App\Models\{CustomProductRequest, CustomProductQuote, Order, Product, Service, User};
use App\Services\{CustomProducts, GatewayPayments};
use App\Support\FinancialMetrics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\{Carbon, Str};
use Illuminate\Support\Facades\{DB, Http, Schema, Storage};
use Laravel\Sanctum\Sanctum;
use Tests\Support\CommercePolicyFixture;
use Tests\TestCase;

class CustomProductsTest extends TestCase
{
    use RefreshDatabase;
    private User $customer;
    private User $staff;
    private Service $service;
    private array $spec;
    private array $session = [];
    private bool $providerUnavailable = false;
    private ?array $refundResponse = null;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-04T04:00:00Z'));
        Storage::fake('local'); Http::preventStrayRequests();
        config(['payments.gateway'=>'paymongo','payments.paymongo.enabled'=>true,'payments.paymongo.secret_key'=>'sk_live_fixture',
            'payments.paymongo.webhook_secret'=>'fixture','payments.paymongo.checkout_method'=>'qrph']);
        Http::fake(['api.paymongo.com/*'=>function($request) {
            if ($this->providerUnavailable) return Http::response([],503);
            if (str_contains($request->url(),'/wallets')) return Http::response(['data'=>[['is_default'=>true,'livemode'=>true,'status'=>'activated','balance'=>['available'=>999999]]]]);
            if (str_contains($request->url(),'/refunds') && $this->refundResponse) return Http::response($this->refundResponse);
            if (str_ends_with($request->url(),'/expire')) return Http::response(['data'=>['attributes'=>['status'=>'expired']]]);
            if ($request->method() === 'POST') {
                $this->session = ['id'=>'cs_customfixture','attributes'=>['livemode'=>true,'status'=>'active','checkout_url'=>'https://checkout.paymongo.com/customfixture',
                    'metadata'=>$request['data']['attributes']['metadata'],'payments'=>[]]];
            }
            return Http::response(['data'=>$this->session]);
        }]);
        $this->customer = User::factory()->create(['role'=>'customer']);
        $this->staff = User::factory()->create(['role'=>'staff']);
        $this->service = Service::create(['title'=>'3D Printing','category'=>'Prototyping','accepts_custom_requests'=>true]);
        $this->spec = ['title'=>'Personal prototype','description'=>'A custom enclosure','quantity'=>2,'size'=>'10 x 10 x 5 cm','material'=>'PLA','colors'=>'Maroon','finish'=>'Matte',
            'contact_name'=>'Customer','contact_phone'=>'09171234567','fulfillment_type'=>'delivery','delivery_recipient_name'=>'Customer','delivery_contact_no'=>'09171234567',
            'delivery_street'=>'1 Test Street','delivery_barangay'=>'Barangay 1','delivery_city'=>'Daet','delivery_province'=>'Camarines Norte','delivery_postal_code'=>'4600','advice_fields'=>[]];
    }
    protected function tearDown(): void { Carbon::setTestNow(); parent::tearDown(); }

    public function test_pending_schema_keeps_regular_portals_available(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            $this->markTestSkipped('This schema rollback test runs inside a SQLite transaction.');
        }

        $migration = require database_path('migrations/2026_11_04_000001_create_custom_product_workflow.php');
        $migration->down();

        Sanctum::actingAs($this->staff);
        $this->getJson('/api/services')->assertOk()->assertJsonPath('custom_requests_available', false);
        foreach (['top-selling', 'sales-by-category', 'product-performance', 'yearly-sales-trend'] as $chart) {
            $this->getJson('/api/admin/product-analytics/'.$chart.'?sales_type=regular')->assertOk();
        }
        $this->getJson('/api/admin/dashboard/summary')->assertOk();
        $this->getJson('/api/admin/orders')->assertOk();
        $this->getJson('/api/admin/reports?category=sales&period=monthly&year=2026&month=11')->assertOk();
        $this->postJson('/api/admin/reports/generate', [
            'category'=>'sales', 'period'=>'monthly', 'year'=>2026, 'month'=>11,
            'sales_type'=>'regular', 'generation_key'=>'regular-report-before-custom-schema',
        ])->assertOk();
        $this->assertDatabaseHas('report_generations', ['generation_key'=>'regular-report-before-custom-schema']);
        $this->getJson('/api/admin/custom-requests-summary')->assertStatus(503)->assertJsonPath('code', 'custom_requests_unavailable');
        $this->getJson('/api/admin/custom-requests/1')->assertStatus(503)->assertJsonPath('code', 'custom_requests_unavailable');
    }

    public function test_partial_schema_keeps_known_custom_orders_separate(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            $this->markTestSkipped('This schema alteration test runs inside a SQLite transaction.');
        }

        $request = $this->createRequest();
        $order = $this->accept($request, $this->quote($request));
        $this->pay($order);
        $order->update(['lifecycle_status' => 'completed', 'customer_stage' => 'completed', 'completed_at' => now()]);
        Schema::table('custom_product_quotes', fn ($table) => $table->dropColumn('snapshot'));

        Sanctum::actingAs($this->staff);
        $this->getJson('/api/admin/custom-requests')->assertStatus(503);
        $this->getJson('/api/admin/product-analytics/product-performance?period=all')->assertStatus(503);
        $this->getJson('/api/admin/product-analytics/product-performance?period=all&sales_type=regular')
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/admin/reports?category=sales&period=monthly&year=2026&month=11')
            ->assertOk()->assertJsonPath('data.table.rows.0.order_type', 'Custom')
            ->assertJsonPath('data.table.rows.0.custom_reference', 'Unavailable');
    }

    private function createRequest(): CustomProductRequest
    {
        Sanctum::actingAs($this->customer);
        $id = $this->postJson('/api/customer/custom-requests',['creation_key'=>(string)Str::uuid(),'service_id'=>$this->service->id])->assertCreated()->json('data.id');
        $r = CustomProductRequest::findOrFail($id);
        $this->action($r,'submit',['service_id'=>$this->service->id,'specifications'=>$this->spec])->assertOk();
        return $r->fresh();
    }
    private function action(CustomProductRequest $r,string $action,array $data=[],bool $operator=false)
    {
        Sanctum::actingAs($operator ? $this->staff : $this->customer);
        return $this->postJson('/api/'.($operator ? 'admin' : 'customer').'/custom-requests/'.$r->id.'/'.$action,
            $data + ['expected_revision'=>$r->fresh()->revision,'request_key'=>(string)Str::uuid()]);
    }
    private function quote(CustomProductRequest $r): CustomProductQuote
    {
        $this->action($r,'send_quote',['specifications'=>$this->spec,'unit_price'=>500,'shipping_fee'=>100,'production_days'=>3,
            'transit_min_days'=>1,'transit_max_days'=>3,'specifications_confirmed'=>true,'delivery_confirmed'=>true],true)->assertOk();
        return $r->quotes()->firstOrFail();
    }
    private function accept(CustomProductRequest $r,CustomProductQuote $q): Order
    {
        $this->action($r,'accept',['quote_id'=>$q->id,'design_accepted'=>true] + CommercePolicyFixture::acceptance())->assertOk()->assertJsonPath('payment.checkout_url','https://checkout.paymongo.com/customfixture');
        return $q->order()->firstOrFail();
    }
    private function pay(Order $order, ?int $paidAt = null): void
    {
        $session = $this->session;
        $session['attributes']['payments'] = [['id'=>'pay_customfixture','attributes'=>['amount'=>GatewayPayments::centavos($order->total),'currency'=>'PHP','livemode'=>true,'status'=>'paid','paid_at'=>$paidAt ?? now()->timestamp,'source'=>['type'=>'qrph']]]];
        $id = DB::table('payment_attempts')->where('payment_id',$order->payment->id)->value('id');
        app(GatewayPayments::class)->applySession($id,$session);
    }

    public function test_custom_order_uses_verified_payment_and_never_catalog_stock(): void
    {
        $stock = Product::create(['name'=>'Catalog part','code'=>'CUSTOM-TEST','category'=>'Parts','price'=>50,'stock'=>5]);
        $r = $this->createRequest(); $q = $this->quote($r);
        $this->assertEquals(0,FinancialMetrics::collected(null,null)['collected']);
        $order = $this->accept($r,$q);
        $this->assertNull($order->items()->first()->product_id);
        $this->assertEquals(1100,$order->total);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertUnprocessable();
        $this->patchJson('/api/admin/orders/'.$order->id.'/tracking',['stage'=>'to_pay','title'=>'Review note'])->assertOk();
        $this->assertSame('incoming',$order->fresh()->lifecycle_status);
        $this->postJson('/api/admin/orders/approve-bulk',['ids'=>[$order->id]])->assertNotFound();
        $this->pay($order); $this->pay($order);
        $this->assertDatabaseCount('payment_receipts',1);
        $this->assertEquals(1100,FinancialMetrics::collected(null,null)['collected']);
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertOk()->assertJsonPath('data.production_status','in_production');
        $this->assertNotNull(\App\Services\ShipmentTracking::eligibility($order->fresh()));
        $this->postJson('/api/admin/orders/'.$order->id.'/production',['action'=>'ready'])->assertOk();
        $this->assertNull(\App\Services\ShipmentTracking::eligibility($order->fresh()));
        $this->assertSame(5,$stock->fresh()->stock);
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonPath('data.0.order_type','custom');
        $this->assertEquals(1100,FinancialMetrics::collected(null,null)['collected']);
    }

    public function test_quotes_are_immutable_and_acceptance_is_idempotent(): void
    {
        $r = $this->createRequest(); $q = $this->quote($r);
        $before = $q->snapshot;
        $this->action($r,'save',['service_id'=>$this->service->id,'specifications'=>array_replace($this->spec,['quantity'=>99])])->assertUnprocessable();
        $payload = ['quote_id'=>$q->id,'design_accepted'=>true,'expected_revision'=>$r->fresh()->revision,'request_key'=>(string)Str::uuid()] + CommercePolicyFixture::acceptance();
        Sanctum::actingAs($this->customer);
        foreach ([1,2] as $_) $this->postJson('/api/customer/custom-requests/'.$r->id.'/accept',$payload)->assertOk();
        $this->assertDatabaseCount('orders',1); $this->assertDatabaseCount('payment_attempts',1);
        $this->assertEquals($before,$q->fresh()->snapshot);
    }

    public function test_roles_and_private_files_are_enforced(): void
    {
        $r = $this->createRequest();
        Sanctum::actingAs($this->customer);
        $this->post('/api/customer/custom-requests/'.$r->id.'/message',['expected_revision'=>$r->revision,'request_key'=>(string)Str::uuid(),'body'=>'My drawing',
            'attachments'=>[UploadedFile::fake()->image('design.png')]],['Accept'=>'application/json'])->assertOk();
        $id = DB::table('custom_product_attachments')->value('id');
        $this->get('/api/customer/custom-requests/'.$r->id.'/attachments/'.$id)->assertOk()->assertHeader('X-Content-Type-Options','nosniff');
        Sanctum::actingAs(User::factory()->create(['role'=>'customer']));
        $this->getJson('/api/customer/custom-requests/'.$r->id)->assertNotFound();
        $this->getJson('/api/customer/custom-requests/'.$r->id.'/attachments/'.$id)->assertNotFound();
        Sanctum::actingAs($this->staff);
        $this->get('/api/admin/custom-requests/'.$r->id.'/attachments/'.$id)->assertOk();
        $this->postJson('/api/admin/custom-requests/'.$r->id.'/accept',['expected_revision'=>1,'request_key'=>(string)Str::uuid()])->assertConflict();
    }

    public function test_expired_quote_closes_checkout_and_preserves_history(): void
    {
        $r = $this->createRequest(); $q = $this->quote($r); $order = $this->accept($r,$q);
        Carbon::setTestNow(now()->addDays(8));
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$order->id.'/payment-checkout')->assertUnprocessable();
        $this->artisan('custom-products:expire')->assertSuccessful();
        $this->assertSame('expired',$q->fresh()->status);
        $this->assertSame('cancelled',$order->fresh()->lifecycle_status);
        $this->assertSame('expired',DB::table('payment_attempts')->value('status'));
        $this->assertEquals(0,FinancialMetrics::collected(null,null)['collected']);
    }

    public function test_stale_edits_disabled_services_and_unresolved_specs_are_rejected(): void
    {
        $r = $this->createRequest();
        $this->action($r,'save',['expected_revision'=>0,'service_id'=>$this->service->id,'specifications'=>$this->spec])->assertConflict();
        $this->service->update(['accepts_custom_requests'=>false]);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/custom-requests',['creation_key'=>(string)Str::uuid(),'service_id'=>$this->service->id])->assertUnprocessable();
        $this->spec['advice_fields'] = ['material'];
        $this->action($r,'send_quote',['specifications'=>$this->spec,'unit_price'=>500,'shipping_fee'=>100,'production_days'=>3,
            'transit_min_days'=>1,'transit_max_days'=>3,'specifications_confirmed'=>true,'delivery_confirmed'=>true],true)->assertUnprocessable();
        $this->assertDatabaseCount('custom_product_quotes',0);
    }

    public function test_custom_financial_fixture_shipping_refunds_and_service_analytics(): void
    {
        $r=$this->createRequest();$q=$this->quote($r);$o=$this->accept($r,$q);$this->pay($o);
        $this->assertEquals(1100,FinancialMetrics::collected(null,null)['collected']);
        Sanctum::actingAs($this->staff);
        $this->getJson('/api/admin/product-analytics/product-performance?period=all&sales_type=custom')->assertOk()->assertJsonCount(0,'data');
        $this->postJson('/api/admin/orders/'.$o->id.'/production',['action'=>'start'])->assertOk();
        $this->postJson('/api/admin/orders/'.$o->id.'/production',['action'=>'ready'])->assertOk();
        config(['ship24.enabled'=>false]);
        $handover=['request_key'=>(string)Str::uuid(),'tracking_number'=>'001234567890','handed_over_at'=>now()->toIso8601String(),'handover_confirmed'=>true,'actual_shipping_cost'=>150];
        $this->postJson('/api/admin/orders/'.$o->id.'/shipment/tracking',$handover)->assertOk();
        $this->assertEquals(1100,$o->fresh()->total);$this->assertEquals(100,$o->fresh()->shipping_fee);
        $this->postJson('/api/admin/orders/'.$o->id.'/complete')->assertUnprocessable();
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/received')->assertOk();
        $this->assertEquals(1100,FinancialMetrics::collected(null,null)['collected']);
        Sanctum::actingAs($this->staff);
        $this->getJson('/api/admin/product-analytics/product-performance?period=all&sales_type=custom')->assertOk()
            ->assertJsonPath('data.0.category','Custom Products')->assertJsonPath('data.0.service_name','3D Printing')
            ->assertJsonPath('data.0.total_sold',2)->assertJsonPath('data.0.total_revenue',1000);
        $this->getJson('/api/admin/product-analytics/product-performance?period=all&sales_type=regular')->assertJsonCount(0,'data');
        $this->getJson('/api/admin/dashboard/summary?sales_type=custom')->assertOk()->assertJsonPath('data.counts.total_revenue',1100);
        $this->getJson('/api/admin/dashboard/summary?sales_type=regular')->assertOk()->assertJsonPath('data.counts.total_revenue',0);
        $url='/api/admin/reports?category=sales&period=monthly&year=2026&month=11&sales_type=custom';
        $report=$this->getJson($url)->assertOk();
        $this->assertSame('Custom',$report->json('data.table.rows.0.order_type'));
        $this->assertSame($r->reference(),$report->json('data.table.rows.0.custom_reference'));
        $refund=$this->postJson('/api/admin/orders/'.$o->id.'/gateway-refunds',['amount_centavos'=>20000,'reason'=>'Partial return','request_key'=>(string)Str::uuid()])->assertCreated()->json('data.id');
        $this->postJson('/api/admin/gateway-refunds/'.$refund.'/approve')->assertForbidden();
        $this->assertEquals(1100,FinancialMetrics::collected(null,null)['collected']);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $attrs=['payment_id'=>'pay_customfixture','amount'=>20000,'currency'=>'PHP','livemode'=>true,'status'=>'pending'];
        $this->refundResponse=['data'=>['id'=>'ref_custom','attributes'=>$attrs]];
        $this->postJson('/api/admin/gateway-refunds/'.$refund.'/approve')->assertOk();
        $this->assertEquals(1100,FinancialMetrics::collected(null,null)['collected']);
        $attrs['status']='succeeded';$this->refundResponse=['data'=>['id'=>'ref_custom','attributes'=>$attrs]];
        app(GatewayPayments::class)->reconcileRefund(DB::table('payment_refunds')->find($refund));
        $this->assertEquals(900,FinancialMetrics::collected(null,null)['collected']);
        $this->getJson('/api/admin/product-analytics/sales-by-category?period=all&sales_type=custom')->assertOk()->assertJsonPath('data.0.total_revenue',1000);
        $o->update(['is_archived'=>true,'archived_at'=>now()]);
        $this->assertEquals(0,FinancialMetrics::collected(null,null)['collected']);
        $this->getJson('/api/admin/product-analytics/product-performance?period=all&sales_type=custom')->assertJsonCount(0,'data');
        $this->getJson($url)->assertOk()->assertJsonCount(2,'data.table.rows');
    }

    public function test_pickup_admin_quote_and_production_retry_are_guarded(): void
    {
        $this->staff=User::factory()->create(['role'=>'admin']);$this->spec['fulfillment_type']='pickup';
        $r=$this->createRequest();$q=$this->quote($r);$o=$this->accept($r,$q);
        $this->assertEquals(0,$o->shipping_fee);$this->assertEquals(1000,$o->total);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$o->id.'/complete')->assertUnprocessable();
        $this->postJson('/api/admin/orders/'.$o->id.'/production',['action'=>'ready'])->assertUnprocessable();
        $this->pay($o);
        $body=['action'=>'start','expected_revision'=>$r->fresh()->revision,'request_key'=>(string)Str::uuid()];
        $this->postJson('/api/admin/orders/'.$o->id.'/production',$body)->assertOk();
        $this->postJson('/api/admin/orders/'.$o->id.'/production',$body)->assertOk();
        $this->postJson('/api/admin/orders/'.$o->id.'/production',array_replace($body,['action'=>'ready']))->assertConflict();
        $this->postJson('/api/admin/orders/'.$o->id.'/production',array_replace($body,['action'=>'ready','request_key'=>(string)Str::uuid()]))->assertConflict();
        $this->postJson('/api/admin/orders/'.$o->id.'/production',['action'=>'ready'])->assertOk();
        $this->postJson('/api/admin/orders/'.$o->id.'/complete')->assertOk();
        $this->postJson('/api/admin/orders/'.$o->id.'/complete')->assertOk();
        $this->assertNotNull($o->fresh()->picked_up_at);
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonPath('data.0.can_rate',false);
    }

    public function test_revision_keeps_sent_specs_and_rejects_stale_acceptance(): void
    {
        $r=$this->createRequest();$q=$this->quote($r);$original=$q->snapshot;
        $this->action($r,'revision',['note'=>'Please use blue PLA.'])->assertOk();
        $this->spec['colors']='Blue';$this->action($r,'submit',['service_id'=>$this->service->id,'specifications'=>$this->spec])->assertOk();
        $this->quote($r);
        $this->action($r,'accept',['quote_id'=>$q->id,'design_accepted'=>true]+CommercePolicyFixture::acceptance())->assertConflict();
        $this->assertEquals($original,$q->fresh()->snapshot);$this->assertDatabaseCount('custom_product_quotes',2);$this->assertDatabaseCount('orders',0);
    }

    public function test_cancel_closes_provider_session_before_a_replacement_quote(): void
    {
        $r=$this->createRequest();$q=$this->quote($r);$o=$this->accept($r,$q);
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/cancel',['reason'=>'change_item'])->assertOk();
        $this->assertSame('cancelled',$o->fresh()->lifecycle_status);
        $this->assertSame('expired',DB::table('payment_attempts')->value('status'));
        $this->action($r,'withdraw',['note'=>'Revising the design'],true)->assertOk();
        $this->quote($r);$this->assertDatabaseCount('custom_product_quotes',2);
    }

    public function test_payment_arriving_during_cancellation_requires_review(): void
    {
        $r = $this->createRequest(); $o = $this->accept($r, $this->quote($r));
        $initialLevel = DB::connection()->transactionLevel();
        $pendingPayment = true;
        DB::connection()->beforeExecuting(function ($query, $bindings, $connection) use ($o, $initialLevel, &$pendingPayment) {
            $readsOrder = str_contains($query, 'from '.$connection->getQueryGrammar()->wrapTable('orders'));
            if ($pendingPayment && $connection->transactionLevel() > $initialLevel && $readsOrder) {
                $pendingPayment = false;
                $this->pay($o);
            }
        });
        Sanctum::actingAs($this->customer);
        $this->postJson('/api/customer/orders/'.$o->id.'/cancel', ['reason'=>'change_item'])->assertOk();
        $this->assertFalse($pendingPayment, 'The confirmed payment arrived before the cancellation lock read.');
        $this->assertSame('incoming', $o->fresh()->lifecycle_status);
        $this->assertSame('requested', $o->fresh()->cancel_state);
        $this->assertSame('paid', $o->fresh()->payment->status);
        $this->assertDatabaseCount('payment_refunds', 0);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$o->id.'/production', ['action'=>'start'])->assertUnprocessable();
    }

    public function test_uncertain_expiry_blocks_replacement_and_late_payment_cannot_start_production(): void
    {
        $r=$this->createRequest();$q=$this->quote($r);$o=$this->accept($r,$q);Carbon::setTestNow(now()->addDays(8));
        $this->providerUnavailable = true;
        $this->artisan('custom-products:expire')->assertSuccessful();
        $this->assertSame('payment_review',$r->fresh()->status);
        $this->action($r,'send_quote',[],true)->assertUnprocessable();
        $this->pay($o);
        $this->assertSame('cancelled',$o->fresh()->lifecycle_status);
        $this->assertDatabaseHas('payment_refunds',['payment_id'=>$o->payment->id,'status'=>'requested']);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$o->id.'/production',['action'=>'start'])->assertUnprocessable();
    }

    public function test_delayed_confirmation_of_payment_before_deadline_remains_valid(): void
    {
        $r=$this->createRequest();$q=$this->quote($r);$o=$this->accept($r,$q);$paidAt=now()->timestamp;Carbon::setTestNow(now()->addDays(8));
        $r->update(['status'=>'payment_review']);$this->pay($o,$paidAt);
        $this->assertSame('ordered',$r->fresh()->status);
        Sanctum::actingAs($this->staff);
        $this->postJson('/api/admin/orders/'.$o->id.'/production',['action'=>'start'])->assertOk();
    }

    public function test_invalid_uploads_do_not_mutate_request_or_leave_private_files(): void
    {
        $r=$this->createRequest();Sanctum::actingAs($this->customer);
        foreach ([UploadedFile::fake()->createWithContent('design.png','<script>alert(1)</script>'),UploadedFile::fake()->createWithContent('design.exe','MZfixture')] as $file) {
            $this->post('/api/customer/custom-requests/'.$r->id.'/message',['expected_revision'=>$r->revision,'request_key'=>(string)Str::uuid(),'body'=>'Design','attachments'=>[$file]],['Accept'=>'application/json'])->assertUnprocessable();
        }
        $this->assertEquals($r->revision,$r->fresh()->revision);$this->assertDatabaseCount('custom_product_attachments',0);$this->assertDatabaseCount('custom_product_messages',0);
        $this->assertCount(0,Storage::disk('local')->allFiles());
        $this->getJson('/api/admin/custom-requests')->assertForbidden();
    }

    public function test_quote_drafts_are_private_and_can_be_incomplete(): void
    {
        $r=$this->createRequest();
        $this->action($r,'save_quote',['specifications'=>['title'=>'Work in progress'],'unit_price'=>null,'production_days'=>null],true)->assertOk();
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/customer/custom-requests/'.$r->id)->assertOk()->assertJsonCount(0,'data.quotes');
        $this->quote($r);$this->assertDatabaseCount('custom_product_quotes',1);
        $this->getJson('/api/admin/custom-requests/'.$r->id)->assertOk()->assertJsonPath('data.quotes.0.version',1);
    }

    public function test_attachment_limit_and_removal_are_transactional(): void
    {
        $r=$this->createRequest();Sanctum::actingAs($this->customer);
        $files=array_map(fn($i)=>UploadedFile::fake()->image('drawing'.$i.'.png'),range(1,5));
        $body=['expected_revision'=>$r->revision,'request_key'=>(string)Str::uuid(),'service_id'=>$this->service->id,'specifications'=>$this->spec,'attachments'=>$files];
        $this->post('/api/customer/custom-requests/'.$r->id.'/save',$body,['Accept'=>'application/json'])->assertOk();
        $body['expected_revision']=$r->fresh()->revision;$body['request_key']=(string)Str::uuid();$body['attachments']=[UploadedFile::fake()->image('sixth.png')];
        $this->post('/api/customer/custom-requests/'.$r->id.'/save',$body,['Accept'=>'application/json'])->assertUnprocessable();
        $file=DB::table('custom_product_attachments')->first();
        $body['remove_attachment_ids']=[$file->id];$body['request_key']=(string)Str::uuid();
        $this->post('/api/customer/custom-requests/'.$r->id.'/save',$body,['Accept'=>'application/json'])->assertOk();
        $this->assertDatabaseCount('custom_product_attachments',5);
        $this->assertDatabaseMissing('custom_product_attachments',['id'=>$file->id]);
    }

    public function test_completed_custom_sales_use_philippine_day_boundaries(): void
    {
        $r=$this->createRequest();$o=$this->accept($r,$this->quote($r));$this->pay($o);
        $o->update(['lifecycle_status'=>'completed','customer_stage'=>'completed','production_status'=>'ready','completed_at'=>'2026-11-03 16:00:00']);
        Sanctum::actingAs($this->staff);
        $this->getJson('/api/admin/product-analytics/product-performance?period=day&sales_type=custom')->assertOk()->assertJsonPath('data.0.total_sold',2);
        $o->update(['completed_at'=>'2026-11-03 15:59:59']);
        $this->getJson('/api/admin/product-analytics/product-performance?period=day&sales_type=custom')->assertOk()->assertJsonCount(0,'data');
    }

    public function test_service_history_and_drilldown_survive_service_changes(): void
    {
        $r = $this->createRequest(); $q = $this->quote($r); $serviceId = $this->service->id;
        $this->service->update(['title'=>'Renamed service']);
        $this->assertSame('3D Printing', $q->fresh()->snapshot['service']['title']);
        $this->service->delete();
        $this->assertNull($r->fresh()->service_id);
        Sanctum::actingAs($this->staff);
        $this->getJson('/api/admin/custom-requests?service_id='.$serviceId)->assertOk()
            ->assertJsonPath('data.0.reference', $r->reference())
            ->assertJsonPath('data.0.service.title', '3D Printing');
    }

    public function test_accepting_from_another_tab_returns_the_same_order_and_rejects_another_customer(): void
    {
        $r=$this->createRequest();$q=$this->quote($r);$revision=$r->fresh()->revision;$o=$this->accept($r,$q);
        $this->action($r,'accept',['quote_id'=>$q->id,'expected_revision'=>$revision,'design_accepted'=>true]+CommercePolicyFixture::acceptance())->assertOk();
        $this->assertDatabaseCount('orders',1);$this->assertDatabaseCount('payment_attempts',1);
        Sanctum::actingAs(User::factory()->create(['role'=>'customer']));
        $this->postJson('/api/customer/custom-requests/'.$r->id.'/accept',['quote_id'=>$q->id,'request_key'=>(string)Str::uuid(),'expected_revision'=>$revision])->assertNotFound();
    }
}
