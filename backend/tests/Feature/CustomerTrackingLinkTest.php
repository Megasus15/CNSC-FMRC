<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The one link the customer clicks to see their parcel's checkpoints.
 *
 * FMRC has no courier API contract, so the waybill is whatever staff were told
 * and typed in. What matters is that the link built out of it lands the customer
 * on a page *already showing* the parcel - not on a courier homepage with an
 * empty search box, which is what happened before: J&T and LBC both read the
 * number from an in-page form, so their registry entries are landing pages with
 * nothing to substitute.
 *
 * 17TRACK is the primary for those couriers because it takes the number in the
 * URL and works the carrier out from the number itself, needs no account, and
 * costs nothing. Only its public web page is used; its API and webhooks are paid
 * and are not wired up anywhere.
 *
 * The courier's own page is still handed over as a labelled secondary, and the
 * `{tracking_no}` substitution is exercised here too, so the day someone
 * confirms a real waybill URL for a Philippine courier it is a one-line config
 * edit that these tests already cover.
 */
class CustomerTrackingLinkTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_courier_that_cannot_take_the_number_gets_a_prefilled_17track_link(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, courier: 'J&T Express', trackingNo: 'JT1234567890');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.courier.name', 'J&T Express')
            ->assertJsonPath('data.courier.key', 'jnt')
            ->assertJsonPath('data.courier.tracking_no', 'JT1234567890')
            // One click, checkpoints on arrival.
            ->assertJsonPath('data.courier.tracking_url', 'https://t.17track.net/en#nums=JT1234567890')
            ->assertJsonPath('data.courier.tracking_url_provider', 'universal')
            ->assertJsonPath('data.courier.tracking_url_is_prefilled', true)
            // Still offered, just second: it is the source, but it needs typing.
            ->assertJsonPath('data.courier.courier_tracking_url', 'https://www.jtexpress.ph');
    }

    public function test_a_waybill_with_awkward_characters_is_url_encoded(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, courier: 'LBC Express', trackingNo: 'LBC 12/34#56');

        // The fragment is built by hand, so anything staff paste has to survive
        // it. Un-encoded, the `#` alone would truncate the number.
        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.courier.tracking_url', 'https://t.17track.net/en#nums=LBC%2012%2F34%2356')
            ->assertJsonPath('data.courier.courier_tracking_url', 'https://www.lbcexpress.com/track/');
    }

    public function test_a_courier_whose_own_site_takes_the_number_is_the_primary_instead(): void
    {
        // Nobody in the shipped registry has a `{tracking_no}` template yet, so
        // the substitution path is proved against a configured one. This is the
        // mechanism a confirmed courier URL would switch on - and it also proves
        // the courier wins over 17TRACK when it can actually deep-link.
        config()->set('couriers.options.jnt.tracking_url', 'https://www.jtexpress.ph/trajectoryQuery?waybillNo={tracking_no}');

        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, courier: 'J&T Express', trackingNo: 'JT999');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.courier.tracking_url', 'https://www.jtexpress.ph/trajectoryQuery?waybillNo=JT999')
            ->assertJsonPath('data.courier.tracking_url_provider', 'courier')
            ->assertJsonPath('data.courier.tracking_url_is_prefilled', true)
            // No second link: the primary already is the courier's own page.
            ->assertJsonPath('data.courier.courier_tracking_url', null);
    }

    public function test_no_waybill_means_no_link_at_all(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, courier: 'J&T Express', trackingNo: '');

        // A courier homepage with an empty search box and nothing to type into
        // it is the defect, not the fallback. The order still names the courier.
        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.courier.name', 'J&T Express')
            ->assertJsonPath('data.courier.tracking_no', null)
            ->assertJsonPath('data.courier.tracking_url', null)
            ->assertJsonPath('data.courier.tracking_url_provider', null)
            ->assertJsonPath('data.courier.tracking_url_is_prefilled', false)
            ->assertJsonPath('data.courier.courier_tracking_url', null);
    }

    public function test_a_pickup_order_is_never_given_a_courier_block(): void
    {
        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder(
            $customer,
            courier: 'Customer pickup at FMRC',
            trackingNo: 'IGNORED',
            fulfillment: 'pickup',
        );

        // Nothing is moving and no courier holds it, so a tracking link would
        // send the customer chasing a parcel sitting on the FMRC counter.
        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.is_pickup', true)
            ->assertJsonPath('data.courier', null);
    }

    public function test_a_misconfigured_universal_template_shows_no_link_rather_than_a_broken_one(): void
    {
        config()->set('couriers.universal_tracking_url', 'javascript:alert(1)');

        $customer = $this->actingAsCustomer();
        $order = $this->makeOrder($customer, courier: 'J&T Express', trackingNo: 'JT555');

        $this->getJson("/api/customer/orders/{$order->id}")
            ->assertOk()
            ->assertJsonPath('data.courier.tracking_url', null)
            ->assertJsonPath('data.courier.tracking_url_provider', null)
            // The courier's own page is unaffected, so the customer keeps a way
            // through even when the fallback is unusable.
            ->assertJsonPath('data.courier.courier_tracking_url', 'https://www.jtexpress.ph');
    }

    public function test_the_registry_tells_staff_which_couriers_can_be_deep_linked(): void
    {
        $response = $this->getJson('/api/couriers')->assertOk();

        $options = collect($response->json('data'))->keyBy('key');

        // Every Philippine courier in the list reads the waybill from a form, so
        // this flag is false across the board today. It is asserted rather than
        // assumed so adding a real template is a deliberate, visible change.
        foreach ($options as $key => $option) {
            $this->assertFalse(
                $option['links_by_number'],
                "Courier {$key} claims a waybill URL template - update the customer link tests with it.",
            );
        }

        $this->assertSame('https://t.17track.net/en#nums={tracking_no}', $response->json('universal_tracking_url'));
        $this->assertSame('https://www.17track.net/en/tracking', $response->json('universal_tracking_landing'));
    }

    private function actingAsCustomer(): User
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        return $customer;
    }

    private function makeOrder(
        User $customer,
        string $courier,
        string $trackingNo,
        string $fulfillment = 'delivery',
    ): Order {
        $order = Order::create([
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'customer_contact' => '09171234567',
            'quantity' => 1,
            'subtotal' => 150,
            'total' => 150,
            'payment_method' => 'GCash',
            'payment_reference' => 'Paid',
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_receive',
            'fulfillment_type' => $fulfillment,
            'courier_name' => $courier,
            'courier_tracking_no' => $trackingNo !== '' ? $trackingNo : null,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Engraved Keychain',
            'unit_price' => 150,
            'quantity' => 1,
            'line_total' => 150,
        ]);

        return $order->fresh();
    }
}
