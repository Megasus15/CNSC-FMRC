<?php

namespace Tests\Feature;

use App\Models\InventoryItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InventoryBulkArchiveTest extends TestCase
{
    use RefreshDatabase;

    private function makeItem(
        string $name,
        bool $archived = false,
        string $category = 'Office Supplies',
    ): InventoryItem
    {
        return InventoryItem::create([
            'category'     => $category,
            'item_name'    => $name,
            'description'  => 'Test inventory item',
            'unit'         => 'pcs',
            'last_invent'  => 10,
            'on_hand'      => 10,
            'status'       => 'Good',
            'remarks'      => null,
            'is_archived'  => $archived,
            'archived_at'  => $archived ? now() : null,
            'variants'     => [],
        ]);
    }

    public function test_inventory_index_returns_new_items_first(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $older = $this->makeItem('Older item');
        $newer = $this->makeItem('Newer item');

        $this->getJson('/api/admin/inventory')
            ->assertOk()
            ->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonPath('data.1.id', $older->id);
    }

    public function test_admin_can_bulk_archive_active_items(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $first = $this->makeItem('First selected item');
        $second = $this->makeItem('Second selected item');
        $alreadyArchived = $this->makeItem('Already archived item', true);

        $this->patchJson('/api/admin/inventory/archive-bulk', [
            'category' => 'Office Supplies',
            'ids'      => [$first->id, $second->id, $alreadyArchived->id],
        ])
            ->assertOk()
            ->assertJsonPath('archived_count', 2)
            ->assertJsonPath('archived_ids.0', $first->id)
            ->assertJsonPath('archived_ids.1', $second->id)
            ->assertJsonPath('skipped_ids.0', $alreadyArchived->id);

        $this->getJson('/api/admin/inventory')
            ->assertOk()
            ->assertJsonMissing(['id' => $first->id])
            ->assertJsonMissing(['id' => $second->id]);

        $this->getJson('/api/admin/archives')
            ->assertOk()
            ->assertJsonFragment(['source_id' => $first->id])
            ->assertJsonFragment(['source_id' => $second->id]);
    }

    public function test_bulk_archive_requires_at_least_one_valid_id(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $this->patchJson('/api/admin/inventory/archive-bulk', [
            'category' => 'Office Supplies',
            'ids'      => [],
        ])
            ->assertStatus(422);

        $this->patchJson('/api/admin/inventory/archive-bulk', [
            'category' => 'Office Supplies',
            'ids'      => [999999],
        ])
            ->assertNotFound();
    }

    public function test_bulk_archive_cannot_cross_inventory_tables(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));

        $officeItem = $this->makeItem('Office item');
        $consumableItem = $this->makeItem(
            'Consumable item',
            false,
            'Consumable Materials',
        );

        $this->patchJson('/api/admin/inventory/archive-bulk', [
            'category' => 'Office Supplies',
            'ids'      => [$officeItem->id, $consumableItem->id],
        ])
            ->assertOk()
            ->assertJsonPath('category', 'Office Supplies')
            ->assertJsonPath('archived_count', 1)
            ->assertJsonPath('archived_ids.0', $officeItem->id)
            ->assertJsonPath('skipped_ids.0', $consumableItem->id);

        $this->assertDatabaseHas('inventory_items', [
            'id'          => $officeItem->id,
            'is_archived' => true,
        ]);
        $this->assertDatabaseHas('inventory_items', [
            'id'          => $consumableItem->id,
            'is_archived' => false,
        ]);
    }

    public function test_customers_cannot_bulk_archive_inventory_items(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        $item = $this->makeItem('Protected item');

        $this->patchJson('/api/admin/inventory/archive-bulk', [
            'category' => 'Office Supplies',
            'ids'      => [$item->id],
        ])
            ->assertForbidden();
    }
}
