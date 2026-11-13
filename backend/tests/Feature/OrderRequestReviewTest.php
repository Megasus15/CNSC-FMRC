<?php

namespace Tests\Feature;

use App\Models\{Order, OrderTrackingEvent, Product, User};
use App\Support\OrderReview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail, Schema};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\CommercePolicyFixture;
use Tests\TestCase;

class OrderRequestReviewTest extends TestCase
{
    use RefreshDatabase;
    protected function setUp(): void
    {
        parent::setUp(); Mail::fake(); Http::preventStrayRequests();
        config(['payments.gateway'=>'paymongo','payments.paymongo.enabled'=>true,'payments.paymongo.checkout_method'=>'qrph','payments.paymongo.secret_key'=>'sk_test_fixture']);
    }
    public static function roles(): array {return [['admin'],['staff']];}
    private function submit(string $method='GCash', ?Product $product=null): array
    {
        $customer=User::factory()->create(['role'=>'customer']);Sanctum::actingAs($customer);
        $product ??= Product::create(['name'=>'Review cup','code'=>'REV-'.Str::random(6),'category'=>'Products','price'=>100,'stock'=>3,'stock_status'=>'in_stock']);
        $items=[['product_id'=>$product->id,'product_name'=>$product->name,'quantity'=>2]];
        $quote=$this->postJson('/api/shipping/quote',['fulfillment_type'=>'pickup','items'=>$items])->assertOk()->json('data.quote_token');
        $input=CommercePolicyFixture::acceptance()+['items'=>$items,'fulfillment_type'=>'pickup','payment_method'=>$method,'shipping_quote_token'=>$quote,'checkout_request_key'=>(string)Str::uuid()];
        $created=$this->postJson('/api/orders',$input)->assertCreated()->assertJsonPath('data.awaiting_review',true)->assertJsonPath('data.payment_eligibility.allowed',false);
        $this->assertArrayNotHasKey('checkout_url',$created->json('data'));
        return [Order::findOrFail($created->json('data.id')),$product,$customer,$input];
    }
    #[DataProvider('roles')]
    public function test_review_unlocks_payment_without_starting_preparation_or_changing_prices(string $role): void
    {
        [$order,$product,$customer,$input]=$this->submit();
        $this->assertSame(3,$product->fresh()->stock);$this->assertDatabaseCount('payment_attempts',0);Http::assertNothingSent();
        $this->postJson('/api/orders',$input)->assertCreated()->assertJsonPath('data.id',$order->id);$this->assertDatabaseCount('orders',1);
        $this->getJson('/api/customer/orders')->assertOk()->assertJsonPath('counts.awaiting_review',1)->assertJsonPath('counts.to_pay',0);
        $this->postJson('/api/customer/orders/'.$order->id.'/payment-checkout')->assertUnprocessable();
        $this->getJson('/api/customer/orders/'.$order->id.'/payment-status')->assertOk()->assertJsonPath('retry_allowed',false)->assertJsonPath('checkout_url',null);
        Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $this->getJson('/api/admin/orders')->assertOk()->assertJsonCount(1,'review')->assertJsonCount(0,'incoming');
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertUnprocessable();
        $this->postJson('/api/admin/orders/approve-bulk',['ids'=>[$order->id]])->assertOk()->assertJsonPath('processed_count',0);
        $this->postJson('/api/admin/orders/reject-bulk',['ids'=>[$order->id],'reason'=>'Test'])->assertNotFound();
        $this->patchJson('/api/admin/orders/'.$order->id.'/tracking',['stage'=>'to_ship'])->assertUnprocessable();
        $product->update(['price'=>900]);
        foreach(range(1,2) as $_) $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'approve'])->assertOk()->assertJsonPath('data.review.status','approved')->assertJsonPath('data.lifecycle_status','incoming')->assertJsonPath('data.payment_eligibility.allowed',true);
        $this->assertSame(1,$product->fresh()->stock);$this->assertSame('200.00',$order->fresh()->total);$this->assertNull($order->fresh()->approved_at);
        $this->assertSame(1,OrderTrackingEvent::where('order_id',$order->id)->where('title','Order request approved')->count());
        $this->getJson('/api/admin/orders')->assertOk()->assertJsonCount(0,'review')->assertJsonCount(1,'incoming');
        $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'reject','reason'=>'Stale decision'])->assertConflict();
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertUnprocessable();
        Http::fake(['api.paymongo.com/*'=>Http::response(['data'=>['id'=>'cs_review','attributes'=>['livemode'=>false,'checkout_url'=>'https://checkout.paymongo.com/review','payments'=>[]]]],201)]);
        Sanctum::actingAs($customer);
        $this->postJson('/api/customer/orders/'.$order->id.'/payment-checkout')->assertOk()->assertJsonPath('checkout_url','https://checkout.paymongo.com/review');
        $this->assertDatabaseCount('payment_attempts',1);
    }
    #[DataProvider('roles')]
    public function test_cash_collection_and_fulfillment_are_locked_until_review(string $role): void
    {
        [$order,$product]=$this->submit('COP');Sanctum::actingAs(User::factory()->create(['role'=>$role]));
        $this->patchJson('/api/admin/orders/'.$order->id.'/payment-status',['status'=>'paid','confirmed_received'=>true])->assertUnprocessable();
        $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'approve'])->assertOk();
        $this->postJson('/api/admin/orders/'.$order->id.'/approve')->assertOk()->assertJsonPath('data.lifecycle_status','pending')->assertJsonPath('data.payment_status','pending');
        $this->assertSame(1,$product->fresh()->stock);
    }
    public function test_denial_authorization_and_cancellation_never_add_unreserved_stock(): void
    {
        [$order,$product,$customer]=$this->submit('COP');
        $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'approve'])->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'reject'])->assertUnprocessable();
        foreach(range(1,2) as $_) $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'reject','reason'=>'Unavailable material'])->assertOk();
        $this->assertSame(3,$product->fresh()->stock);$this->assertNull($order->fresh()->stock_reserved_at);
        Sanctum::actingAs($customer);
        $this->getJson('/api/customer/orders/'.$order->id)->assertOk()->assertJsonPath('data.review.reason','Unavailable material')->assertJsonPath('data.payment_eligibility.allowed',false);
        [$other,$product,$customer]=$this->submit('COP');
        $this->postJson('/api/customer/orders/'.$other->id.'/cancel',['reason'=>'no_longer_needed'])->assertOk();
        $this->assertSame(3,$product->fresh()->stock);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->postJson('/api/admin/orders/'.$other->id.'/review',['decision'=>'approve'])->assertConflict();
    }
    public function test_competing_orders_reserve_only_available_stock_and_release_once(): void
    {
        [$first,$product]=$this->submit('COP');[$second]=$this->submit('COP',$product);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->postJson('/api/admin/orders/'.$first->id.'/review',['decision'=>'approve'])->assertOk();
        $this->postJson('/api/admin/orders/'.$second->id.'/review',['decision'=>'approve'])->assertUnprocessable();
        $this->assertSame('pending',$second->fresh()->review_status);$this->assertNull($second->fresh()->stock_reserved_at);
        $this->postJson('/api/admin/orders/'.$first->id.'/reject',['reason'=>'Unable to fulfill'])->assertOk();
        $this->postJson('/api/admin/orders/'.$first->id.'/reject',['reason'=>'Retry'])->assertUnprocessable();
        $this->assertSame(3,$product->fresh()->stock);$this->assertNotNull($first->fresh()->stock_released_at);
        $this->postJson('/api/admin/orders/'.$second->id.'/review',['decision'=>'approve'])->assertOk();
        $this->assertSame(1,$product->fresh()->stock);
    }
    public function test_missing_schema_fails_closed_and_transaction_failure_keeps_stock(): void
    {
        [$order,$product]=$this->submit('COP');
        try {
            DB::transaction(function () use ($order) {OrderReview::decide($order,'approve',null,1);throw new \RuntimeException('Simulated persistence failure');});
        } catch (\RuntimeException $error) {$this->assertSame('Simulated persistence failure',$error->getMessage());}
        $this->assertSame('pending',$order->fresh()->review_status);$this->assertSame(3,$product->fresh()->stock);
        Schema::table('orders',fn($table)=>$table->dropColumn('review_reason'));
        $this->postJson('/api/orders',[])->assertStatus(503);
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$order->id.'/review',['decision'=>'approve'])->assertStatus(503);
    }
    public function test_cart_reservation_is_atomic_and_aggregates_repeated_products(): void
    {
        $cup=Product::create(['name'=>'Cup','code'=>'CART-CUP','category'=>'Products','price'=>100,'stock'=>6,'stock_status'=>'in_stock']);
        $plaque=Product::create(['name'=>'Plaque','code'=>'CART-PLAQUE','category'=>'Products','price'=>200,'stock'=>1,'stock_status'=>'in_stock']);
        [,,$customer,$input]=$this->submit('COP',$cup);
        $input['items']=[['product_id'=>$cup->id,'product_name'=>'Cup','quantity'=>2],['product_id'=>$plaque->id,'product_name'=>'Plaque','quantity'=>1],['product_id'=>$cup->id,'product_name'=>'Cup','quantity'=>2]];
        $input['checkout_request_key']=(string)Str::uuid();
        $input['shipping_quote_token']=$this->postJson('/api/shipping/quote',['fulfillment_type'=>'pickup','items'=>$input['items']])->assertOk()->json('data.quote_token');
        $id=$this->postJson('/api/orders',$input)->assertCreated()->json('data.id');
        $plaque->update(['stock'=>0,'stock_status'=>'out_of_stock']);
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->postJson('/api/admin/orders/'.$id.'/review',['decision'=>'approve'])->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->assertSame(6,$cup->fresh()->stock);$this->assertNull(Order::find($id)->stock_reserved_at);
        $plaque->update(['stock'=>1,'stock_status'=>'in_stock']);
        $this->postJson('/api/admin/orders/'.$id.'/review',['decision'=>'approve'])->assertOk();
        $this->assertSame(2,$cup->fresh()->stock);$this->assertSame(0,$plaque->fresh()->stock);
        $this->assertSame('600.00',Order::find($id)->total);
        Sanctum::actingAs($customer);
        $this->postJson('/api/customer/orders/'.$id.'/cancel',['reason'=>'no_longer_needed'])->assertOk();
        $this->postJson('/api/customer/orders/'.$id.'/cancel',['reason'=>'no_longer_needed']);
        $this->assertSame(6,$cup->fresh()->stock);$this->assertSame(1,$plaque->fresh()->stock);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->postJson('/api/admin/orders/'.$id.'/review',['decision'=>'approve'])->assertConflict();
    }
}
