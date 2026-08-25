<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The manual GCash rail, end to end.
 *
 * FMRC has no payment gateway: the customer sends money to the FMRC GCash number
 * themselves and types the reference from their receipt. Everything here exists
 * to keep one rule true - a reference the customer typed is a *claim*, and only
 * staff finding that reference inside the FMRC GCash account turns it into money.
 * Marking an order paid on the strength of the claim would push an unpaid job
 * into the shipping queue and into Total Revenue.
 */
class GcashManualPaymentRailTest extends TestCase
{
    use RefreshDatabase;

    private const REFERENCE = '1234567890123';

    public function test_a_gcash_order_is_placed_first_and_paid_afterwards(): void
    {
        $customer = $this->actingAsCustomer();
        $product = $this->makeProduct(['stock' => 25]);

        // No reference number: the customer has not sent anything yet. Refusing
        // the order here is what forced them to pay before they knew the order
        // would even go through.
        $response = $this->postJson('/api/orders', [
            'product_id' => $product->id,
            'product_name' => $product->name,
            'quantity' => 2,
            'unit_price' => 500,
            'total_amount' => 1000,
            'payment_method' => 'GCash',
            'fulfillment_type' => 'pickup',
        ]);

        $response->assertCreated();

        $order = Order::query()->latest('id')->firstOrFail();

        $this->assertSame('GCash', $order->payment_method);
        $this->assertSame('to_pay', $order->customer_stage);
        $this->assertSame('incoming', $order->lifecycle_status);
        $this->assertSame('Awaiting GCash reference', $order->payment_reference);
        $this->assertSame((int) $customer->id, (int) $order->customer_id);

        // The deadline is stamped on the order at checkout rather than derived
        // on read, so the countdown the customer was promised never moves when
        // the configured window changes.
        $expectedWindow = max(1, (int) config('payments.gcash.payment_window_hours', 48));
        $this->assertNotNull($order->payment_due_at);
        $this->assertSame(
            $expectedWindow,
            (int) round(now()->diffInMinutes($order->payment_due_at, false) / 60),
        );

        // A payment row exists from the start, unpaid, so staff see the order in
        // their verification queue instead of it appearing only after a claim.
        $this->assertDatabaseHas('payments', [
            'order_id' => $order->id,
            'method' => 'GCash',
            'status' => 'pending',
            'paid_at' => null,
        ]);

        // Stock is committed at checkout: the item is reserved for this order
        // whether or not the money has landed.
        $this->assertSame(23, (int) $product->fresh()->stock);
    }

    public function test_cash_orders_get_no_payment_deadline(): void
    {
        $this->actingAsCustomer();
        $product = $this->makeProduct();

        $this->postJson('/api/orders', [
            'product_id' => $product->id,
            'product_name' => $product->name,
            'quantity' => 1,
            'unit_price' => 500,
            'total_amount' => 500,
            'payment_method' => 'COP',
        ])->assertCreated();

        // Cash changes hands at the counter, so there is nothing to wait for and
        // nothing to count down.
        $this->assertNull(Order::query()->latest('id')->firstOrFail()->payment_due_at);
    }

    public function test_the_customer_submits_a_reference_and_a_receipt_screenshot(): void
    {
        Storage::fake('public');

        $customer = $this->actingAsCustomer();
        $order = $this->makeUnpaidGcashOrder($customer);

        $response = $this->post("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => self::REFERENCE,
            'proof' => UploadedFile::fake()->image('receipt.png'),
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('message', 'Reference number received. FMRC will confirm your payment shortly.');

        $payment = $order->fresh()->payment;

        // Submitted, not confirmed: `submitted_at` is the claim and `paid_at` is
        // the confirmation. Conflating them is the whole failure mode.
        $this->assertSame(self::REFERENCE, $payment->reference);
        $this->assertSame('pending', $payment->status);
        $this->assertNotNull($payment->submitted_at);
        $this->assertNull($payment->paid_at);
        $this->assertTrue($payment->hasCustomerClaim());

        // The screenshot is stored as a path on the public disk, never inlined
        // into the order payload the customer's list polls every few seconds.
        $this->assertNotNull($payment->proof_path);
        Storage::disk('public')->assertExists($payment->proof_path);
        $this->assertStringContainsString($payment->proof_path, (string) $payment->proofUrl());

        // The order still waits, and staff are told there is something to match.
        $this->assertSame('to_pay', $order->fresh()->customer_stage);
        $this->assertSame(self::REFERENCE, $order->fresh()->payment_reference);

        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $order->id,
            'title' => 'GCash reference submitted',
        ]);
        $this->assertDatabaseHas('admin_notifications', [
            'title' => "Verify GCash Payment: {$order->order_no}",
        ]);
    }

    public function test_a_resubmission_replaces_the_previous_screenshot(): void
    {
        Storage::fake('public');

        $customer = $this->actingAsCustomer();
        $order = $this->makeUnpaidGcashOrder($customer);

        $this->post("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => self::REFERENCE,
            'proof' => UploadedFile::fake()->image('first.png'),
        ])->assertOk();

        $firstProof = $order->fresh()->payment->proof_path;

        $this->post("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => '9876543210987',
            'proof' => UploadedFile::fake()->image('second.png'),
        ])->assertOk();

        $payment = $order->fresh()->payment;

        // Leaving the old file behind would have staff matching a receipt for a
        // reference nobody recorded.
        $this->assertNotSame($firstProof, $payment->proof_path);
        Storage::disk('public')->assertMissing($firstProof);
        Storage::disk('public')->assertExists($payment->proof_path);
        $this->assertSame('9876543210987', $payment->reference);
    }

    public function test_a_reference_that_is_not_thirteen_digits_is_refused(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeUnpaidGcashOrder($customer);

        $this->postJson("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => '12345',
        ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'That GCash reference number does not look right.')
            ->assertJsonStructure(['errors' => ['payment_reference']]);

        $this->assertNull($order->fresh()->payment->submitted_at);
    }

    public function test_one_reference_cannot_be_claimed_on_two_orders(): void
    {
        $customer = $this->actingAsCustomer();
        $first = $this->makeUnpaidGcashOrder($customer, 'ORD-GC-FIRST');
        $second = $this->makeUnpaidGcashOrder($customer, 'ORD-GC-SECOND');

        $this->postJson("/api/customer/orders/{$first->id}/payment", [
            'payment_reference' => self::REFERENCE,
        ])->assertOk();

        // One reference number is one transfer. Accepting it twice would have
        // staff confirming two orders against a single payment.
        $response = $this->postJson("/api/customer/orders/{$second->id}/payment", [
            'payment_reference' => self::REFERENCE,
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('ORD-GC-FIRST', (string) $response->json('message'));
        $this->assertNull($second->fresh()->payment->submitted_at);
    }

    public function test_a_customer_cannot_submit_a_reference_on_someone_elses_order(): void
    {
        $owner = User::factory()->create(['role' => 'customer']);
        $order = $this->makeUnpaidGcashOrder($owner);

        $this->actingAsCustomer();

        $this->postJson("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => self::REFERENCE,
        ])->assertStatus(403);
    }

    public function test_only_staff_confirmation_turns_the_claim_into_revenue(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeUnpaidGcashOrder($customer);

        $this->postJson("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => self::REFERENCE,
        ])->assertOk();

        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        // The claim on its own is worth nothing.
        $this->assertSame(0.0, $this->reportedRevenue());

        $this->patchJson("/api/admin/orders/{$order->id}/payment-status", [
            'status' => 'paid',
        ])->assertOk();

        $payment = $order->fresh()->payment;
        $this->assertSame('paid', $payment->status);
        $this->assertNotNull($payment->paid_at);

        // Confirming the money is also what releases the job to the shipping
        // queue - staff do not have to remember to move it separately.
        $fresh = $order->fresh();
        $this->assertSame('to_ship', $fresh->customer_stage);
        $this->assertSame('pending', $fresh->lifecycle_status);
        $this->assertNotNull($fresh->approved_at);

        $this->assertSame(1000.0, $this->reportedRevenue());
    }

    public function test_unconfirming_a_payment_takes_the_money_back_out_of_revenue(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $order = $this->makeUnpaidGcashOrder($customer);

        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $this->patchJson("/api/admin/orders/{$order->id}/payment-status", ['status' => 'paid'])
            ->assertOk();
        $confirmedAt = $order->fresh()->payment->paid_at;
        $this->assertSame(1000.0, $this->reportedRevenue());

        // Confirming twice must not re-stamp the timestamp reports read.
        $this->patchJson("/api/admin/orders/{$order->id}/payment-status", ['status' => 'paid'])
            ->assertOk();
        $this->assertTrue($confirmedAt->equalTo($order->fresh()->payment->paid_at));

        // A confirmation made by mistake is undone by setting it back to unpaid,
        // and the timestamp that made it revenue has to go with it.
        $this->patchJson("/api/admin/orders/{$order->id}/payment-status", ['status' => 'pending'])
            ->assertOk();

        $this->assertNull($order->fresh()->payment->paid_at);
        $this->assertSame(0.0, $this->reportedRevenue());
    }

    public function test_a_confirmed_payment_cannot_be_claimed_again(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeUnpaidGcashOrder($customer);

        $order->payment->update(['status' => 'paid', 'paid_at' => now()]);

        $this->postJson("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => self::REFERENCE,
        ])
            ->assertStatus(422)
            ->assertJsonPath(
                'message',
                'This payment has already been confirmed. There is nothing left to submit.',
            );
    }

    public function test_a_cash_order_has_no_reference_to_submit(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeUnpaidGcashOrder($customer, 'ORD-COP-001', 'COP');

        $this->postJson("/api/customer/orders/{$order->id}/payment", [
            'payment_reference' => self::REFERENCE,
        ])->assertStatus(422);
    }

    private function actingAsCustomer(): User
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        return $customer;
    }

    /** @param array<string, mixed> $attributes */
    private function makeProduct(array $attributes = []): Product
    {
        return Product::create(array_merge([
            'name' => 'Laser-Cut Acrylic Sign',
            'category' => 'Fabrication',
            'code' => 'FAB-'.fake()->unique()->numberBetween(1000, 9999),
            'stock' => 10,
            'price' => 500,
            'unit_price' => 500,
        ], $attributes));
    }

    /**
     * An order sitting at To Pay with the placeholder reference checkout leaves
     * behind - the state every GCash order starts in.
     */
    private function makeUnpaidGcashOrder(
        User $customer,
        string $orderNo = 'ORD-GC-0001',
        string $method = 'GCash',
    ): Order {
        $order = Order::create([
            'order_no' => $orderNo,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => $customer->email,
            'quantity' => 1,
            'subtotal' => 1000,
            'total' => 1000,
            'payment_method' => $method,
            'payment_reference' => $method === 'GCash' ? 'Awaiting GCash reference' : 'Cash on pickup',
            'payment_due_at' => $method === 'GCash' ? now()->addHours(48) : null,
            'fulfillment_type' => 'pickup',
            'lifecycle_status' => 'incoming',
            'customer_stage' => 'to_pay',
        ]);

        Payment::create([
            'order_id' => $order->id,
            'payment_no' => 'PAY-'.$orderNo,
            'method' => $method,
            'reference' => $order->payment_reference,
            'amount' => $order->total,
            'status' => 'pending',
        ]);

        return $order->fresh();
    }

    /** Total Revenue exactly as the admin dashboard card reports it. */
    private function reportedRevenue(): float
    {
        return (float) $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->json('data.counts.total_revenue');
    }
}
