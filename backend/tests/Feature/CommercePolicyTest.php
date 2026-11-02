<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use App\Services\CommercePolicy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CommercePolicyTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->product = Product::create(['name' => 'Policy test product', 'code' => 'POLICY', 'category' => 'Fabrication', 'price' => 500, 'stock' => 10]);
    }

    private function publish(string $suffix = ''): array
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $draft = CommercePolicy::draft();
        $draft['refund_text'] .= $suffix;
        $revision = DB::table('commerce_policy_settings')->value('revision');
        $this->putJson('/api/admin/commerce-policy/draft', array_merge($draft, ['expected_revision' => $revision]))->assertOk();
        $result = $this->postJson('/api/admin/commerce-policy/publish', ['expected_revision' => $revision + 1, 'approved' => true])->assertOk()->json('data.published');
        Sanctum::actingAs($this->customer);

        return $result;
    }

    private function order(?array $policy = null): array
    {
        Sanctum::actingAs($this->customer);
        $quote = $this->postJson('/api/shipping/quote', ['items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'fulfillment_type' => 'pickup'])->assertOk()->json('data.quote_token');

        return ['product_id' => $this->product->id, 'product_name' => 'Policy test product', 'quantity' => 1, 'total_amount' => 500, 'payment_method' => 'COP',
            'fulfillment_type' => 'pickup', 'shipping_quote_token' => $quote, 'checkout_request_key' => (string) Str::uuid(),
            'policy_version' => $policy['version'] ?? null, 'policy_accepted' => (bool) $policy];
    }

    public function test_proposed_wording_is_a_private_admin_draft_and_publication_requires_approval(): void
    {
        $this->getJson('/api/commerce/policy')->assertOk()->assertJsonPath('data', null);
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->getJson('/api/admin/commerce-policy')->assertOk()->assertJsonPath('data.draft.title', 'FMRC Transaction Terms and Refund Policy');
        $this->postJson('/api/admin/commerce-policy/publish', ['expected_revision' => 0, 'approved' => true])->assertUnprocessable();
        $this->putJson('/api/admin/commerce-policy/draft', array_merge(CommercePolicy::draft(), ['expected_revision' => 0]))->assertOk();
        $this->postJson('/api/admin/commerce-policy/publish', ['expected_revision' => 1, 'approved' => false])->assertUnprocessable();
        $this->getJson('/api/commerce/policy')->assertJsonPath('data', null);
    }

    public function test_staff_reads_only_the_published_policy_and_cannot_write(): void
    {
        $policy = $this->publish();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->getJson('/api/admin/commerce-policy')->assertOk()->assertJsonMissingPath('data.draft')->assertJsonPath('data.published.version', $policy['version']);
        $this->putJson('/api/admin/commerce-policy/draft', [])->assertForbidden();
        $this->postJson('/api/admin/commerce-policy/publish', [])->assertForbidden();
        Sanctum::actingAs($this->customer);
        $this->getJson('/api/admin/commerce-policy')->assertForbidden();
        $this->getJson('/api/commerce/policy')->assertOk()->assertJsonMissingPath('data.published_by');
    }

    public function test_no_published_policy_or_missing_acceptance_prevents_orders_and_stock_changes(): void
    {
        $this->postJson('/api/orders', $this->order())->assertConflict()->assertJsonPath('code', 'policy_changed');
        $policy = $this->publish();
        $payload = $this->order($policy);
        $payload['policy_accepted'] = false;
        $this->postJson('/api/orders', $payload)->assertConflict();
        $this->assertDatabaseCount('orders', 0);
        $this->assertSame(10, $this->product->fresh()->stock);
    }

    public function test_changed_policy_requires_renewed_acceptance_without_charging_or_creating_an_order(): void
    {
        $old = $this->publish();
        $payload = $this->order($old);
        $current = $this->publish("\n\nUpdated FMRC assistance information.");
        $this->postJson('/api/orders', $payload)->assertConflict()->assertJsonPath('code', 'policy_changed')->assertJsonPath('policy.version', $current['version']);
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('payments', 0);
    }

    public function test_order_keeps_the_accepted_text_version_and_timestamp_when_policy_changes(): void
    {
        $old = $this->publish();
        $payload = $this->order($old);
        $payload['refund_text'] = 'Untrusted client wording';
        $payload['policy_accepted_at'] = '2000-01-01';
        $id = $this->postJson('/api/orders', $payload)->assertCreated()->json('data.id');
        $order = Order::findOrFail($id);
        $this->assertSame($old['version'], $order->accepted_policy_version);
        $this->assertSame($old['refund_text'], $order->accepted_policy_text['refund_text']);
        $this->assertTrue($order->policy_accepted_at->isToday());
        $this->publish("\n\nA newer version.");
        $this->getJson('/api/commerce/policy/'.$old['version'])->assertOk()->assertJsonPath('data.refund_text', $old['refund_text']);
        foreach (['customer', 'admin', 'staff'] as $role) {
            Sanctum::actingAs($role === 'customer' ? $this->customer : User::factory()->create(['role' => $role]));
            $endpoint = $role === 'customer' ? '/api/customer/orders/' : '/api/admin/orders/';
            $this->getJson($endpoint.$id)->assertOk()->assertJsonPath('data.accepted_policy.version', $old['version'])->assertJsonPath('data.accepted_policy.refund_text', $old['refund_text']);
        }
    }

    public function test_stale_draft_revision_cannot_replace_or_publish_newer_wording(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $draft = array_merge(CommercePolicy::draft(), ['expected_revision' => 0]);
        $this->putJson('/api/admin/commerce-policy/draft', $draft)->assertOk();
        $this->putJson('/api/admin/commerce-policy/draft', $draft)->assertConflict();
        $this->postJson('/api/admin/commerce-policy/publish',['expected_revision' => 0, 'approved' => true])->assertConflict();
        $this->assertDatabaseCount('commerce_policies',0);
    }
}
