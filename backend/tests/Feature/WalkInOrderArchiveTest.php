<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use App\Models\WalkInOrder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Mark-as-Done + Archive for the Walk-in Customers table.
 *
 * Two behaviours here are deliberate and easy to break by accident, so they get
 * their own assertions: permanently deleting an archived walk-in must NOT put
 * product stock back (the goods already left the building), and archiving one
 * must take it back out of dashboard revenue.
 *
 * That second rule is the reverse of what this file asserted until 2026-09-02.
 * Revenue was a lifetime figure that consulted no archive flag, so the dashboard
 * total could only ever climb and archiving was purely list hygiene. Archive is
 * the only non-destructive way out of the live tables, so it is also the only
 * lever an operator has over the total - see RevenueAndSalesAnalyticsTest for the
 * order-side half of the same contract. Restoring puts the money back.
 */
class WalkInOrderArchiveTest extends TestCase
{
    use RefreshDatabase;

    private int $sequence = 0;

    private function makeWalkIn(array $overrides = []): WalkInOrder
    {
        $this->sequence++;
        $label = 'Walk-in Archive '.$this->sequence;

        return WalkInOrder::create(array_merge([
            'order_no' => 'WALK-ARCHIVE-'.str_pad((string) $this->sequence, 3, '0', STR_PAD_LEFT),
            'customer_name' => $label,
            'address' => 'Daet, Camarines Norte',
            'contact_number' => '09171234567',
            'client_type' => 'STUDENT',
            'agency_organization' => 'CNSC',
            'project_description' => '3D PRINTING',
            'item_detail' => $label.' Item',
            'unit' => '2',
            'subtotal_cost' => 500,
            'order_item' => $label.' Item',
            'order_date' => now(),
            'customer' => $label,
            'payment_method' => 'WALKIN VIA CASHIER',
            'total' => 500,
            'status' => 'Pending',
        ], $overrides));
    }

    private function actingAsAdmin(): User
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_mark_as_done_sets_status_to_completed(): void
    {
        $this->actingAsAdmin();
        $walkIn = $this->makeWalkIn();

        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/complete")
            ->assertOk()
            ->assertJsonPath('data.id', $walkIn->id)
            ->assertJsonPath('data.status', 'Completed');

        $this->assertSame('Completed', $walkIn->refresh()->status);
        $this->assertFalse((bool) $walkIn->is_archived);
    }

    public function test_archive_is_rejected_until_the_walk_in_is_marked_as_done(): void
    {
        $this->actingAsAdmin();
        $walkIn = $this->makeWalkIn();

        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/archive")
            ->assertStatus(422)
            ->assertJsonPath('message', 'Mark the walk-in order as done before archiving it.');

        $this->assertFalse((bool) $walkIn->refresh()->is_archived);

        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/complete")->assertOk();
        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/archive")->assertOk();

        $walkIn->refresh();
        $this->assertTrue((bool) $walkIn->is_archived);
        $this->assertNotNull($walkIn->archived_at);
    }

    public function test_archiving_moves_the_row_from_the_orders_page_to_the_archives_page(): void
    {
        $this->actingAsAdmin();
        $archived = $this->makeWalkIn(['status' => 'Completed']);
        $active = $this->makeWalkIn();

        $this->patchJson("/api/admin/walkin-orders/{$archived->id}/archive")->assertOk();

        $live = $this->getJson('/api/admin/walkin-orders')->assertOk();
        $this->assertSame([$active->id], collect($live->json('data'))->pluck('id')->all());

        $archives = $this->getJson('/api/admin/archives')->assertOk();
        $this->assertCount(1, $archives->json('walkins'));
        $archives
            ->assertJsonPath('walkins.0.source_id', $archived->id)
            ->assertJsonPath('walkins.0.module', 'walkin')
            ->assertJsonPath('walkins.0.order_no', $archived->order_no)
            ->assertJsonPath('walkins.0.status', 'Completed')
            ->assertJsonPath('walkins.0.total_label', '₱ 500.00');
    }

    public function test_restore_bulk_returns_an_archived_walk_in_to_the_live_list(): void
    {
        $this->actingAsAdmin();
        $walkIn = $this->makeWalkIn(['status' => 'Completed']);
        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/archive")->assertOk();

        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'walkin',
            'ids' => [$walkIn->id],
        ])->assertOk();

        $walkIn->refresh();
        $this->assertFalse((bool) $walkIn->is_archived);
        $this->assertNull($walkIn->archived_at);

        $this->getJson('/api/admin/walkin-orders')
            ->assertOk()
            ->assertJsonPath('data.0.id', $walkIn->id);

        $this->assertCount(0, $this->getJson('/api/admin/archives')->assertOk()->json('walkins'));
    }

    public function test_delete_bulk_removes_the_walk_in_without_restoring_product_stock(): void
    {
        $this->actingAsAdmin();
        $product = Product::create([
            'name' => 'Walk-in Archive Filament',
            'price' => 250,
            'stock' => 8,
            'stock_status' => 'in_stock',
        ]);

        $walkIn = $this->makeWalkIn([
            'status' => 'Completed',
            'product_id' => $product->id,
            'unit' => '3',
        ]);
        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/archive")->assertOk();

        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'walkin',
            'ids' => [$walkIn->id],
        ])->assertOk();

        $this->assertDatabaseMissing('walk_in_orders', ['id' => $walkIn->id]);
        // The sale already happened, so the goods must NOT come back to stock.
        $this->assertSame(8, (int) $product->refresh()->stock);
    }

    public function test_archiving_a_walk_in_takes_it_back_out_of_dashboard_revenue(): void
    {
        $this->actingAsAdmin();
        $walkIn = $this->makeWalkIn(['status' => 'Completed', 'total' => 750]);

        $before = $this->reportedRevenue();
        $this->assertGreaterThanOrEqual(750.0, $before);

        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/archive")->assertOk();

        // Archiving is the operator's one lever on the total, so the money has to
        // actually leave it - not merely leave the list it was showing in.
        $this->assertSame($before - 750.0, $this->reportedRevenue());

        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'walkin',
            'ids' => [$walkIn->id],
        ])->assertOk();

        // And restoring is a real undo: the sale was never reversed, only hidden.
        $this->assertSame($before, $this->reportedRevenue());
    }

    private function reportedRevenue(): float
    {
        return (float) $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->json('data.counts.total_revenue');
    }

    public function test_customers_cannot_complete_or_archive_walk_in_orders(): void
    {
        $walkIn = $this->makeWalkIn(['status' => 'Completed']);

        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));

        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/complete")->assertForbidden();
        $this->patchJson("/api/admin/walkin-orders/{$walkIn->id}/archive")->assertForbidden();

        $walkIn->refresh();
        $this->assertSame('Completed', $walkIn->status);
        $this->assertFalse((bool) $walkIn->is_archived);
    }
}
