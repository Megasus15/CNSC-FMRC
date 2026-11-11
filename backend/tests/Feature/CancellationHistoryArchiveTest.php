<?php

namespace Tests\Feature;

use App\Models\{Order, OrderTrackingEvent, Payment, User, OrderCancellationArchive};
use App\Support\CancellationHistoryArchive;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Http, Mail, Schema};
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class CancellationHistoryArchiveTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp(); Mail::fake(); Http::preventStrayRequests();
    }

    public static function roles(): array { return [['admin'], ['staff']]; }

    private function order(string $state = 'approved'): Order
    {
        $user = User::factory()->create(['role' => 'customer']);
        $order = Order::create(['order_no' => 'ORD-'.Str::random(12), 'customer_id' => $user->id,
            'customer_name' => $user->name, 'quantity' => 1, 'subtotal' => 100, 'total' => 100,
            'payment_method' => 'COP', 'fulfillment_type' => 'pickup',
            'lifecycle_status' => $state === 'approved' ? 'cancelled' : 'pending', 'customer_stage' => 'to_pay',
            'cancel_state' => $state, 'cancel_reason' => 'ordered_by_mistake', 'cancel_requested_at' => now()->subHour(),
            'cancel_decided_at' => $state === 'requested' ? null : now(), 'cancelled_at' => $state === 'approved' ? now() : null]);
        Payment::create(['order_id' => $order->id, 'payment_no' => 'PAY-'.$order->id, 'method' => 'COP', 'status' => 'pending', 'amount' => 100]);
        return $order->fresh();
    }

    private function archive(Order $order, ?string $key = null)
    {
        return $this->patchJson('/api/admin/orders/'.$order->id.'/cancellation/archive', ['request_key' => $key ?? CancellationHistoryArchive::key($order)]);
    }

    #[DataProvider('roles')]
    public function test_archive_and_restore_only_cancellation_visibility_and_preserve_transactions(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
        $order = $this->order(); $attributes = $order->getAttributes(); $payment = $order->payment->getAttributes();
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.cancellation_archive.allowed', true);
        $id = $this->archive($order)->assertOk()->json('data.id');
        $this->archive($order)->assertOk()->assertJsonPath('data.id', $id);
        $this->assertDatabaseCount('order_cancellation_archives', 1);
        $this->assertSame($attributes, $order->fresh()->getAttributes());
        $this->assertSame($payment, $order->payment->fresh()->getAttributes());
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.cancellation_archive.archived', true);
        $this->getJson('/api/admin/archives?module=cancellation')->assertOk()->assertJsonCount(1, 'cancellations')->assertJsonPath('cancellations.0.can_restore', true);
        $this->getJson('/api/admin/dashboard/live-counts')->assertOk()->assertJsonPath('data.archives.cancellations', 1);
        $this->patchJson('/api/admin/archives/restore-bulk', ['module' => 'cancellation', 'ids' => [$id]])->assertOk()->assertJsonPath('processed_ids.0', $id);
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.cancellation_archive.archived', false);
        $this->assertSame($attributes, $order->fresh()->getAttributes());
        $this->assertSame($payment, $order->payment->fresh()->getAttributes());
        $this->assertDatabaseCount('order_tracking_events', 0); Http::assertNothingSent();
    }

    public function test_declined_request_can_be_archived_without_hiding_an_active_paid_order(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $order = $this->order('declined'); $order->payment->update(['status' => 'paid']);
        $this->archive($order)->assertOk();
        $response = $this->getJson('/api/admin/orders')->assertOk();
        $this->assertContains($order->id, array_column($response->json('directory'), 'id'));
        $this->assertFalse($order->fresh()->is_archived);
        $this->assertSame('paid', $order->payment->fresh()->status);
    }

    public function test_pending_missing_dates_and_payment_claims_are_blocked_without_changes(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $order = $this->order('requested'); $this->archive($order)->assertUnprocessable();
        $order->update(['cancel_state' => 'approved', 'lifecycle_status' => 'cancelled', 'cancel_refund_due' => true]);
        $this->archive($order)->assertUnprocessable();
        $order->update(['cancel_refund_due' => false]);
        $order->payment->update(['submitted_at' => now(), 'reference' => '123456789']);
        $this->archive($order)->assertUnprocessable();
        $order->update(['cancel_requested_at' => null]);
        $this->archive($order, str_repeat('a',64))->assertConflict();
        $this->assertDatabaseCount('order_cancellation_archives', 0);
    }

    public function test_failed_pending_and_partial_refunds_stay_visible_until_full_confirmation(): void
    {
        $staff = User::factory()->create(['role' => 'staff']); Sanctum::actingAs($staff);
        $order = $this->order(); $order->payment->update(['method' => 'GCash', 'gateway' => 'paymongo', 'status' => 'paid']);
        $attempt = DB::table('payment_attempts')->insertGetId(['payment_id'=>$order->payment->id,'token'=>(string) Str::uuid(),
            'checkout_id'=>'cs_archive','checkout_method'=>'qrph','api_version'=>'v2','livemode'=>false,
            'amount_centavos'=>10000,'status'=>'paid','provider_payment_id'=>'pay_archive','confirmed_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        DB::table('payment_receipts')->insert(['payment_id'=>$order->payment->id,'attempt_id'=>$attempt,'provider_payment_id'=>'pay_archive',
            'source_type'=>'qrph','amount_centavos'=>10000,'livemode'=>false,'confirmed_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        $refund = ['payment_id' => $order->payment->id, 'token' => (string) Str::uuid(), 'provider_payment_id' => 'pay_archive',
            'requested_by' => $staff->id, 'amount_centavos' => 5000, 'reason' => 'Cancellation refund', 'livemode' => false,
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now()];
        $id = DB::table('payment_refunds')->insertGetId($refund);
        foreach (['pending','unknown','failed','requested'] as $status) {
            DB::table('payment_refunds')->where('id',$id)->update(['status' => $status]);
            $this->archive($order)->assertUnprocessable();
        }
        DB::table('payment_refunds')->where('id',$id)->update(['status' => 'succeeded', 'confirmed_at' => now()]);
        $this->archive($order)->assertUnprocessable(); // A partial refund must not hide the remaining obligation.
        $order->payment->update(['status' => 'refunded', 'refunded_at' => now()]);
        $this->archive($order)->assertUnprocessable();
        DB::table('payment_refunds')->where('id',$id)->update(['amount_centavos'=>10000]);
        $this->archive($order)->assertOk(); Http::assertNothingSent();
    }

    public function test_request_version_prevents_newer_request_archival_and_snapshot_replacement(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $order = $this->order('declined');
        $key = CancellationHistoryArchive::key($order);
        $id = $this->archive($order)->assertOk()->json('data.id');
        $snapshot = OrderCancellationArchive::findOrFail($id)->snapshot;
        OrderTrackingEvent::create(['order_id' => $order->id, 'stage' => 'to_pay', 'event_type' => 'system', 'title' => 'Cancellation requested',
            'occurred_at' => now(), 'metadata' => ['source' => 'customer_cancellation']]);
        $order->update(['cancel_state' => 'requested', 'cancel_requested_at' => now(), 'cancel_decided_at' => null]);
        $this->archive($order, $key)->assertConflict();
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.cancellation_archive.archived',false);
        $this->patchJson('/api/admin/archives/restore-bulk',['module'=>'cancellation','ids'=>[$id]])->assertOk()->assertJsonPath('processed_count',0);
        $this->getJson('/api/admin/archives?module=cancellation')->assertOk()->assertJsonPath('cancellations.0.can_restore',false);
        $this->assertSame($snapshot,OrderCancellationArchive::findOrFail($id)->snapshot);
    }

    public function test_customers_cannot_archive_and_archives_cannot_be_deleted_or_expired(): void
    {
        $order = $this->order(); Sanctum::actingAs($order->customer);
        $this->archive($order)->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $id = $this->archive($order)->assertOk()->json('data.id');
        $this->deleteJson('/api/admin/archives/delete-bulk',['module'=>'cancellation','ids'=>[$id]])->assertUnprocessable();
        OrderCancellationArchive::whereKey($id)->update(['archived_at'=>now()->subYear()]);
        $this->postJson('/api/admin/archives/auto-delete',['retention_days'=>30])->assertOk();
        $this->assertDatabaseHas('order_cancellation_archives',['id'=>$id,'restored_at'=>null]);
        $this->assertDatabaseHas('orders',['id'=>$order->id,'is_archived'=>false]);
    }

    public function test_partial_release_without_archive_storage_keeps_orders_available(): void
    {
        Schema::drop('order_cancellation_archives');
        Sanctum::actingAs(User::factory()->create(['role'=>'staff'])); $order=$this->order();
        $this->getJson('/api/admin/orders/'.$order->id)->assertOk()->assertJsonPath('data.cancellation_archive.allowed',false);
        $this->archive($order)->assertStatus(503);
    }
}
