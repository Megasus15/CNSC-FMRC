<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The ready-made checkpoints the tracking modal offers staff.
 *
 * Nothing here is automatic and nothing polls a courier: FMRC has no courier API
 * contract, so a checkpoint reaches the customer's timeline only because a staff
 * member typed it. What this endpoint removes is the retyping - the same seven
 * checkpoints all day, each with a sorting-hub latitude nobody remembers, which
 * is exactly where a typo drops a pin in the sea.
 *
 * Two properties matter more than the preset list itself:
 *
 *  - the office pin must be the *same* office pin a pickup order's destination
 *    already uses, or the map grows two differently-named FMRCs; and
 *  - a malformed config entry must degrade to a still-typable modal, never to a
 *    500 that takes the whole tracking dialog with it.
 */
class TrackingCheckpointPresetsTest extends TestCase
{
    use RefreshDatabase;

    public function test_staff_get_the_preset_list_and_the_office_pin(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));

        $response = $this->getJson('/api/admin/tracking/checkpoint-presets')->assertOk();

        $presets = collect($response->json('data'));
        $this->assertNotEmpty($presets);

        $handover = $presets->firstWhere('key', 'handed_over');
        $this->assertNotNull($handover);
        // `{courier}` is left standing on purpose: the modal substitutes the
        // courier the staff member picked, so one preset covers every courier.
        $this->assertSame('Handed over to {courier}', $handover['title']);
        $this->assertSame('delivery', $handover['fulfillment']);
        $this->assertSame('to_receive', $handover['stage']);
        $this->assertSame(14.1122, $handover['lat']);
        $this->assertSame(122.9550, $handover['lng']);

        // "In transit" with no place named leaves the last pin the customer saw
        // standing, rather than blanking the boxes.
        $inTransit = $presets->firstWhere('key', 'in_transit');
        $this->assertNull($inTransit['lat']);
        $this->assertNull($inTransit['lng']);
        $this->assertNull($inTransit['location_name']);

        $this->assertSame(
            'FMRC Office, University of Camarines Norte, Daet',
            $response->json('origin.location_name'),
        );
    }

    public function test_both_kinds_of_order_are_covered(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $presets = collect(
            $this->getJson('/api/admin/tracking/checkpoint-presets')->assertOk()->json('data')
        );

        // The modal filters on this field, so a value outside the three it knows
        // would silently hide a preset from every order.
        foreach ($presets as $preset) {
            $this->assertContains($preset['fulfillment'], ['pickup', 'delivery', 'both']);
            $this->assertContains($preset['stage'], ['to_pay', 'to_ship', 'to_receive', 'completed', null]);
            $this->assertNotSame('', trim((string) $preset['label']));
        }

        $this->assertNotEmpty($presets->where('fulfillment', 'delivery'));
        $this->assertNotEmpty($presets->where('fulfillment', 'pickup'));
    }

    public function test_the_office_pin_is_the_same_one_a_pickup_order_points_at(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
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
            'fulfillment_type' => 'pickup',
        ]);
        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Engraved Keychain',
            'unit_price' => 150,
            'quantity' => 1,
            'line_total' => 150,
        ]);

        Sanctum::actingAs($customer);
        $destination = $this->getJson("/api/customer/orders/{$order->id}")->assertOk()->json('data');

        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $origin = $this->getJson('/api/admin/tracking/checkpoint-presets')->assertOk()->json('origin');

        // One office, one name, one pin. Two spellings would put two markers on
        // the customer's map for the same counter.
        $this->assertSame($destination['destination_label'], $origin['location_name']);
        $this->assertSame($destination['destination_latitude'], $origin['lat']);
        $this->assertSame($destination['destination_longitude'], $origin['lng']);
    }

    public function test_a_malformed_config_degrades_instead_of_breaking_the_modal(): void
    {
        config()->set('tracking_checkpoints.presets', [
            // Kept: unknown stage and non-numeric coordinates are dropped to null
            // rather than passed through to the modal.
            [
                'key' => 'usable',
                'title' => 'Scanned at the hub',
                'stage' => 'somewhere_else',
                'fulfillment' => 'teleport',
                'lat' => 'not a number',
                'lng' => '',
                'description' => '',
            ],
            // Dropped: a preset with no key or no title cannot be offered.
            ['key' => '', 'title' => 'No key'],
            ['key' => 'no_title', 'title' => '   '],
        ]);
        config()->set('tracking_checkpoints.origin', ['lat' => 'oops']);

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $response = $this->getJson('/api/admin/tracking/checkpoint-presets')->assertOk();

        $response
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.key', 'usable')
            // Falls back to the title so the dropdown never shows a blank row.
            ->assertJsonPath('data.0.label', 'Scanned at the hub')
            ->assertJsonPath('data.0.stage', null)
            ->assertJsonPath('data.0.fulfillment', 'both')
            ->assertJsonPath('data.0.lat', null)
            ->assertJsonPath('data.0.lng', null)
            ->assertJsonPath('data.0.description', null)
            ->assertJsonPath('data.0.location_name', null)
            // A missing or unusable origin still leaves the "Use FMRC office"
            // button pointing at the real office.
            ->assertJsonPath('origin.location_name', 'FMRC Office, University of Camarines Norte, Daet')
            ->assertJsonPath('origin.lat', 14.1122)
            ->assertJsonPath('origin.lng', 122.9550);
    }

    public function test_a_customer_cannot_read_the_staff_preset_list(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));

        $this->getJson('/api/admin/tracking/checkpoint-presets')->assertStatus(403);
    }

    public function test_a_guest_cannot_read_the_staff_preset_list(): void
    {
        $this->getJson('/api/admin/tracking/checkpoint-presets')->assertStatus(401);
    }
}
