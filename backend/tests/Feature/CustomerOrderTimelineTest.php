<?php

namespace Tests\Feature;

use App\Models\{Order, OrderTrackingEvent, User};
use App\Support\CustomerOrderTimeline;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerOrderTimelineTest extends TestCase
{
    use RefreshDatabase;

    private function event(array $values = []): OrderTrackingEvent
    {
        static $id = 0;
        $attributes = array_merge(['stage' => 'to_receive', 'event_type' => 'courier_update',
            'title' => 'Courier update', 'description' => 'Departure, Your package departed from PILI to LABO', 'location_name' => 'PILI, Camarines SurDC1',
            'occurred_at' => '2026-11-09T02:42:15+08:00', 'metadata' => ['source' => '17track', 'tracking_number' => 'JT-ONE']], $values);
        if ($attributes['occurred_at']) $attributes['occurred_at'] = \Illuminate\Support\Carbon::parse($attributes['occurred_at'])->utc();
        return (new OrderTrackingEvent($attributes))->forceFill(['id' => ++$id]);
    }

    public function test_duplicate_scan_titles_and_stage_variants_collapse_but_distinct_scans_remain(): void
    {
        $events = collect([$this->event(), $this->event(['title' => 'In transit', 'stage' => 'completed']),
            $this->event(['occurred_at' => '2026-11-09T02:43:15+08:00']),
            $this->event(['metadata' => ['source' => '17track', 'tracking_number' => 'JT-CORRECTED']]),
            $this->event(['event_type' => 'admin_update', 'title' => 'Preparation note', 'metadata' => ['source' => 'fmrc']]),
            $this->event(['event_type' => 'admin_update', 'title' => 'Preparation note', 'metadata' => ['source' => 'fmrc']])]);
        $rows = CustomerOrderTimeline::present($events);
        $this->assertCount(5, $rows);
        $this->assertSame('Departed Pili for Labo', $rows[0]['title']);
        $this->assertSame('', $rows[0]['description']);
        $this->assertSame('2:43:15 AM', $rows[0]['time_label']);
        $this->assertCount(2, array_filter($rows, fn ($row) => $row['kind'] === 'note'));
        $this->assertStringNotContainsString('17TRACK', json_encode($rows));
        $this->assertStringNotContainsString('JT-ONE', json_encode($rows));
    }

    public function test_missing_times_stay_distinct_and_delivered_has_specific_wording(): void
    {
        $missing = ['occurred_at' => null, 'metadata' => ['source' => '17track', 'time' => ['precision' => 'missing']]];
        $rows = CustomerOrderTimeline::present(collect([$this->event($missing), $this->event($missing), $this->event([
            'description' => 'Delivered, Your package has been Delivered', 'location_name' => 'LABO', 'occurred_at' => '2026-11-09T11:40:35+08:00'])]));
        $this->assertCount(3, $rows);
        $this->assertSame('Delivered', $rows[0]['title']);
        $this->assertSame('', $rows[0]['description']);
        $this->assertSame('delivered', $rows[0]['status']);
    }

    public function test_customer_projection_preserves_raw_audit_rows_and_actual_event_order(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);
        $order = Order::create(['customer_id' => $customer->id, 'customer_name' => 'Customer', 'quantity' => 1, 'subtotal' => 10, 'total' => 10,
            'payment_method' => 'COP', 'lifecycle_status' => 'pending', 'customer_stage' => 'to_receive']);
        foreach (['Courier update', 'In transit'] as $title) {
            $event = $this->event(['title' => $title]);
            OrderTrackingEvent::create(array_merge($event->getAttributes(), ['order_id' => $order->id, 'metadata' => $event->metadata]));
        }
        $this->getJson('/api/customer/orders/'.$order->id)->assertOk()->assertJsonCount(2, 'data.timeline')
            ->assertJsonCount(1, 'data.customer_timeline')->assertJsonPath('data.customer_timeline.0.title', 'Departed Pili for Labo');
        $this->assertDatabaseCount('order_tracking_events', 2);
        $this->assertSame('to_receive', $order->fresh()->customer_stage);
    }

    public function test_actual_courier_driver_details_and_delivery_instructions_are_retained(): void
    {
        $description = 'Out for Delivery, Your package Out for Delivery 【OCW_Mark Jerald Tabadero : 639950198016】 For COD please prepare exact amount, Photo proof of delivery is require. Thanks!';
        $rows = CustomerOrderTimeline::present(collect([$this->event(['description' => $description]),
            $this->event(['description' => 'Arrived, Your package Arrived at LABO. Delayed by flooding. Contact the delivery team.'])]));
        $delivery = collect($rows)->firstWhere('status', 'out_for_delivery');
        $this->assertSame($description, $delivery['courier_description']);
        $this->assertStringContainsString('Mark Jerald Tabadero', $delivery['description']);
        $this->assertStringContainsString('639950198016', $delivery['description']);
        $this->assertStringContainsString('Photo proof of delivery', $delivery['description']);
        $arrival = collect($rows)->firstWhere('title', 'Arrived at Labo');
        $this->assertStringContainsString('Delayed by flooding.', $arrival['description']);
    }

    public function test_superseded_waybill_scans_do_not_mix_into_the_current_customer_timeline(): void
    {
        $current = (new \App\Models\ShipmentTracker(['tracking_number' => 'JT-ONE']))->forceFill(['id' => 17]);
        $events = collect([$this->event(['shipment_tracker_id' => 17]),
            $this->event(['shipment_tracker_id' => 16, 'metadata' => ['source' => '17track', 'tracking_number' => 'JT-OLD']]),
            $this->event(['metadata' => ['source' => '17track', 'tracking_number' => 'JT-OLD']]),
            $this->event(['event_type' => 'admin_update', 'title' => 'Tracking number corrected', 'metadata' => ['source' => 'fmrc']])]);
        $rows = CustomerOrderTimeline::present($events, $current);
        $this->assertCount(2, $rows);
        $this->assertCount(4, $events, 'Projection leaves the original audit history intact.');
        $this->assertCount(1, array_filter($rows, fn ($row) => $row['kind'] === 'note'));
    }
}
