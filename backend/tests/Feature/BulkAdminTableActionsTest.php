<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\CustomerMessage;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BulkAdminTableActionsTest extends TestCase
{
    use RefreshDatabase;

    private int $orderSequence = 0;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function actingAdmin(): User
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function makeProduct(string $name): Product
    {
        return Product::create([
            'name' => $name,
            'category' => '3D Print',
            'code' => strtoupper(str_replace(' ', '-', $name)) . '-' . fake()->unique()->numberBetween(1000, 9999),
            'stock' => 12,
            'price' => 100,
            'stock_status' => 'in_stock',
            'is_blocked' => false,
        ]);
    }

    private function makeMessage(string $name): CustomerMessage
    {
        return CustomerMessage::create([
            'sender_name' => $name,
            'sender_email' => strtolower(str_replace(' ', '.', $name)) . '@example.test',
            'message' => 'Please respond to this test inquiry.',
        ]);
    }

    private function makeOrder(
        string $status,
        ?User $customer = null,
        ?string $paymentStatus = null,
        bool $archived = false,
    ): Order {
        $this->orderSequence++;
        $order = Order::create([
            'order_no' => 'ORD-BULK-' . str_pad((string) $this->orderSequence, 3, '0', STR_PAD_LEFT),
            'customer_id' => $customer?->id,
            'customer_name' => $customer?->name ?? 'Bulk Test Customer',
            'customer_contact' => $customer?->email ?? 'customer@example.test',
            'quantity' => 2,
            'subtotal' => 200,
            'total' => 200,
            'payment_method' => $paymentStatus ? 'GCash' : 'COD',
            'lifecycle_status' => $status,
            'customer_stage' => 'to_pay',
            'is_archived' => $archived,
            'archived_at' => $archived ? now() : null,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_name' => 'Bulk Test Product',
            'unit_price' => 100,
            'quantity' => 2,
            'line_total' => 200,
        ]);

        if ($paymentStatus !== null) {
            Payment::create([
                'order_id' => $order->id,
                'payment_no' => 'PAY-BULK-' . str_pad((string) $this->orderSequence, 3, '0', STR_PAD_LEFT),
                'method' => 'gcash',
                'reference' => 'REF-' . $this->orderSequence,
                'amount' => 200,
                'status' => $paymentStatus,
                'paid_at' => $paymentStatus === 'paid' ? now() : null,
            ]);
        }

        return $order;
    }

    public function test_bulk_routes_require_authentication_role_and_valid_distinct_positive_ids(): void
    {
        $this->deleteJson('/api/admin/products/delete-bulk', ['ids' => [1]])
            ->assertUnauthorized();

        $admin = $this->actingAdmin();

        $this->patchJson('/api/admin/promotions/archive-bulk', ['ids' => []])
            ->assertUnprocessable();

        $this->patchJson('/api/admin/announcements/archive-bulk', ['ids' => [1, 1]])
            ->assertUnprocessable();

        $this->postJson('/api/admin/orders/approve-bulk', ['ids' => [0]])
            ->assertUnprocessable();

        $customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($customer);

        $this->deleteJson('/api/admin/products/delete-bulk', ['ids' => [1]])
            ->assertForbidden();
        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'inventory',
            'ids' => [1],
        ])->assertForbidden();
        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'inventory',
            'ids' => [1],
        ])->assertForbidden();

        $this->assertDatabaseHas('users', ['id' => $admin->id]);
    }

    public function test_product_and_inbox_bulk_deletes_are_permanent_scoped_and_report_partial_skips(): void
    {
        $this->actingAdmin();
        $firstProduct = $this->makeProduct('Delete First Product');
        $keptProduct = $this->makeProduct('Keep Product');
        $firstMessage = $this->makeMessage('Delete First Sender');
        $keptMessage = $this->makeMessage('Keep Sender');

        $this->deleteJson('/api/admin/products/delete-bulk', [
            'ids' => [$firstProduct->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('action', 'delete')
            ->assertJsonPath('scope', 'products')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['skipped_ids' => [999999]]);

        $this->assertDatabaseMissing('products', ['id' => $firstProduct->id]);
        $this->assertDatabaseHas('products', ['id' => $keptProduct->id]);
        $this->assertDatabaseHas('customer_messages', ['id' => $firstMessage->id]);

        $this->deleteJson('/api/admin/customer-messages/delete-bulk', [
            'ids' => [$firstMessage->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('scope', 'customer_messages')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['skipped_ids' => [999999]]);

        $this->assertDatabaseMissing('customer_messages', ['id' => $firstMessage->id]);
        $this->assertDatabaseHas('customer_messages', ['id' => $keptMessage->id]);
        $this->assertDatabaseHas('products', ['id' => $keptProduct->id]);
    }

    public function test_user_bulk_delete_protects_the_acting_admin_and_is_admin_only(): void
    {
        $admin = $this->actingAdmin();
        $deletable = User::factory()->create(['role' => 'customer']);
        $protected = User::factory()->create(['role' => 'customer']);

        $this->deleteJson('/api/users/delete-bulk', [
            'ids' => [$admin->id, $deletable->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['processed_ids' => [$deletable->id]])
            ->assertJsonFragment(['skipped_ids' => [$admin->id, 999999]]);

        $this->assertDatabaseHas('users', ['id' => $admin->id]);
        $this->assertDatabaseMissing('users', ['id' => $deletable->id]);

        Sanctum::actingAs($protected);
        $this->deleteJson('/api/users/delete-bulk', ['ids' => [$admin->id]])
            ->assertForbidden();
        $this->assertDatabaseHas('users', ['id' => $admin->id]);
    }

    public function test_campaign_archive_excludes_saved_and_public_feeds_and_restore_preserves_schedule_and_discount(): void
    {
        $now = Carbon::parse('2026-08-10 02:00:00', 'UTC');
        Carbon::setTestNow($now);
        $admin = $this->actingAdmin();
        $product = $this->makeProduct('Campaign Product');

        $promotion = Promotion::create([
            'title' => 'Archive Me Promotion',
            'discount_percent' => 25,
            'scope' => 'all_products',
            'starts_at' => $now->copy()->subHour(),
            'ends_at' => $now->copy()->addHours(2),
            'is_enabled' => true,
            'created_by' => $admin->id,
        ]);
        $announcement = Announcement::create([
            'title' => 'Archive Me Announcement',
            'message' => 'Campaign archival must remove this public notice.',
            'placement' => 'both',
            'starts_at' => $now->copy()->subHour(),
            'ends_at' => $now->copy()->addHours(2),
            'is_enabled' => true,
            'created_by' => $admin->id,
        ]);

        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.id', $product->id)
            ->assertJsonPath('data.0.discount_percent', 25);

        $this->patchJson('/api/admin/promotions/archive-bulk', [
            'ids' => [$promotion->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['skipped_ids' => [999999]]);
        $this->patchJson('/api/admin/announcements/archive-bulk', [
            'ids' => [$announcement->id],
        ])->assertOk();

        $this->assertDatabaseHas('promotions', [
            'id' => $promotion->id,
            'is_archived' => true,
            'is_enabled' => true,
        ]);
        $this->assertDatabaseHas('announcements', [
            'id' => $announcement->id,
            'is_archived' => true,
            'is_enabled' => true,
        ]);

        $this->getJson('/api/admin/promotions')
            ->assertOk()
            ->assertJsonMissing(['title' => $promotion->title]);
        $this->getJson('/api/admin/announcements')
            ->assertOk()
            ->assertJsonMissing(['title' => $announcement->title]);
        $this->getJson('/api/promotions/active')
            ->assertOk()
            ->assertJsonMissing(['title' => $promotion->title]);
        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonMissing(['title' => $announcement->title]);
        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.discount_percent', 0)
            ->assertJsonPath('data.0.sale_price', 100);

        $this->getJson('/api/admin/archives')
            ->assertOk()
            ->assertJsonFragment(['source_id' => $promotion->id, 'module' => 'promotion'])
            ->assertJsonFragment(['source_id' => $announcement->id, 'module' => 'announcement']);

        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'promotion',
            'ids' => [$promotion->id],
        ])->assertOk();
        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'announcement',
            'ids' => [$announcement->id],
        ])->assertOk();

        $this->assertDatabaseHas('promotions', [
            'id' => $promotion->id,
            'is_archived' => false,
            'is_enabled' => true,
            'discount_percent' => 25,
        ]);
        $this->assertDatabaseHas('announcements', [
            'id' => $announcement->id,
            'is_archived' => false,
            'is_enabled' => true,
            'placement' => 'both',
        ]);
        $this->assertSame(
            $now->copy()->addHours(2)->timestamp,
            $promotion->fresh()->ends_at?->timestamp,
        );

        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.discount_percent', 25);
        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonFragment(['title' => $announcement->title]);
    }

    public function test_appointment_archive_and_restore_skip_ineligible_records(): void
    {
        $this->actingAdmin();
        $completed = Appointment::create([
            'reference_no' => 'AP-BULK-001',
            'first_name' => 'Completed',
            'last_name' => 'Client',
            'status' => 'Completed',
        ]);
        $scheduled = Appointment::create([
            'reference_no' => 'AP-BULK-002',
            'first_name' => 'Scheduled',
            'last_name' => 'Client',
            'status' => 'Scheduled',
        ]);
        $cancelled = Appointment::create([
            'reference_no' => 'AP-BULK-003',
            'first_name' => 'Cancelled',
            'last_name' => 'Client',
            'status' => 'Cancelled',
        ]);

        $this->patchJson('/api/appointments/' . $scheduled->id . '/archive')
            ->assertUnprocessable();

        $this->patchJson('/api/appointments/archive-bulk', [
            'ids' => [$completed->id, $scheduled->id, $cancelled->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['processed_ids' => [$completed->id]])
            ->assertJsonFragment(['skipped_ids' => [$scheduled->id, $cancelled->id, 999999]]);

        $this->assertDatabaseHas('appointments', [
            'id' => $completed->id,
            'status' => 'Archived',
        ]);
        $this->assertDatabaseHas('appointments', [
            'id' => $scheduled->id,
            'status' => 'Scheduled',
        ]);
        $this->assertDatabaseHas('appointments', [
            'id' => $cancelled->id,
            'status' => 'Cancelled',
        ]);

        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'appointment',
            'ids' => [$completed->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['skipped_ids' => [999999]]);

        $this->assertDatabaseHas('appointments', [
            'id' => $completed->id,
            'status' => 'Pending',
        ]);
    }

    public function test_restore_bulk_is_module_isolated_even_when_ids_collide(): void
    {
        $this->actingAdmin();
        $inventory = InventoryItem::create([
            'category' => 'Office Supplies',
            'item_name' => 'Archived Inventory',
            'unit' => 'pcs',
            'last_invent' => 2,
            'on_hand' => 2,
            'status' => 'Good',
            'variants' => [],
            'is_archived' => true,
            'archived_at' => now(),
        ]);
        $order = $this->makeOrder('completed', null, 'paid', true);

        $this->assertSame($inventory->id, $order->id);

        $this->patchJson('/api/admin/archives/restore-bulk', [
            'module' => 'inventory',
            'ids' => [$inventory->id],
        ])
            ->assertOk()
            ->assertJsonPath('scope', 'inventory');

        $this->assertDatabaseHas('inventory_items', [
            'id' => $inventory->id,
            'is_archived' => false,
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'is_archived' => true,
        ]);
    }

    public function test_archive_bulk_delete_permanently_removes_archived_records_for_each_module(): void
    {
        $admin = $this->actingAdmin();
        $archivedInventory = InventoryItem::create([
            'category' => 'Office Supplies',
            'item_name' => 'Delete Archived Inventory',
            'unit' => 'pcs',
            'last_invent' => 2,
            'on_hand' => 2,
            'status' => 'Good',
            'variants' => [],
            'is_archived' => true,
            'archived_at' => now(),
        ]);
        $activeInventory = InventoryItem::create([
            'category' => 'Office Supplies',
            'item_name' => 'Keep Active Inventory',
            'unit' => 'pcs',
            'last_invent' => 2,
            'on_hand' => 2,
            'status' => 'Good',
            'variants' => [],
            'is_archived' => false,
        ]);
        $archivedAppointment = Appointment::create([
            'reference_no' => 'AP-DELETE-001',
            'first_name' => 'Archived',
            'last_name' => 'Appointment',
            'status' => 'Archived',
        ]);
        $archivedOrder = $this->makeOrder('completed', null, null, true);
        $archivedPromotion = Promotion::create([
            'title' => 'Delete Archived Promotion',
            'discount_percent' => 15,
            'scope' => 'all_products',
            'starts_at' => now()->subHour(),
            'ends_at' => now()->addHour(),
            'is_enabled' => true,
            'is_archived' => true,
            'archived_at' => now(),
            'created_by' => $admin->id,
        ]);
        $archivedAnnouncement = Announcement::create([
            'title' => 'Delete Archived Announcement',
            'message' => 'This archived announcement is for bulk deletion coverage.',
            'placement' => 'both',
            'starts_at' => now()->subHour(),
            'ends_at' => now()->addHour(),
            'is_enabled' => true,
            'is_archived' => true,
            'archived_at' => now(),
            'created_by' => $admin->id,
        ]);

        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'inventory',
            'ids' => [$archivedInventory->id, $activeInventory->id, 999999],
        ])
            ->assertOk()
            ->assertJsonPath('action', 'delete')
            ->assertJsonPath('scope', 'inventory')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['processed_ids' => [$archivedInventory->id]])
            ->assertJsonFragment(['skipped_ids' => [$activeInventory->id, 999999]]);

        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'appointment',
            'ids' => [$archivedAppointment->id],
        ])->assertOk()->assertJsonPath('processed_count', 1);
        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'order',
            'ids' => [$archivedOrder->id],
        ])->assertOk()->assertJsonPath('processed_count', 1);
        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'promotion',
            'ids' => [$archivedPromotion->id],
        ])->assertOk()->assertJsonPath('processed_count', 1);
        $this->deleteJson('/api/admin/archives/delete-bulk', [
            'module' => 'announcement',
            'ids' => [$archivedAnnouncement->id],
        ])->assertOk()->assertJsonPath('processed_count', 1);

        $this->assertDatabaseMissing('inventory_items', ['id' => $archivedInventory->id]);
        $this->assertDatabaseHas('inventory_items', ['id' => $activeInventory->id]);
        $this->assertDatabaseMissing('appointments', ['id' => $archivedAppointment->id]);
        $this->assertDatabaseMissing('orders', ['id' => $archivedOrder->id]);
        $this->assertDatabaseMissing('promotions', ['id' => $archivedPromotion->id]);
        $this->assertDatabaseMissing('announcements', ['id' => $archivedAnnouncement->id]);
    }

    public function test_rejected_and_payment_archives_enforce_their_own_table_eligibility_and_keep_whole_order_data(): void
    {
        $this->actingAdmin();
        $rejected = $this->makeOrder('rejected');
        $pending = $this->makeOrder('pending');
        $completedPaid = $this->makeOrder('completed', null, 'paid');
        $incomingPaid = $this->makeOrder('incoming', null, 'paid');

        $this->patchJson('/api/admin/orders/archive-bulk', [
            'source' => 'rejected',
            'ids' => [$rejected->id, $pending->id],
        ])
            ->assertOk()
            ->assertJsonPath('scope', 'rejected_orders')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['skipped_ids' => [$pending->id]]);

        $this->patchJson('/api/admin/orders/archive-bulk', [
            'source' => 'payments',
            'ids' => [$completedPaid->id, $incomingPaid->id],
        ])
            ->assertOk()
            ->assertJsonPath('scope', 'payments')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['skipped_ids' => [$incomingPaid->id]]);

        $this->assertDatabaseHas('orders', [
            'id' => $rejected->id,
            'is_archived' => true,
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $pending->id,
            'is_archived' => false,
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $completedPaid->id,
            'is_archived' => true,
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $incomingPaid->id,
            'is_archived' => false,
        ]);
        $this->assertDatabaseHas('payments', ['order_id' => $completedPaid->id]);
        $this->assertDatabaseHas('order_items', ['order_id' => $completedPaid->id]);
    }

    public function test_incoming_mass_approve_and_reject_preserve_transitions_notifications_tracking_and_emails(): void
    {
        $admin = $this->actingAdmin();
        $customer = User::factory()->create([
            'role' => 'customer',
            'name' => 'Order Email Customer',
            'email' => 'order-email@example.test',
        ]);
        $paidIncoming = $this->makeOrder('incoming', $customer, 'paid');
        $unpaidIncoming = $this->makeOrder('incoming', $customer, 'pending');
        $alreadyPending = $this->makeOrder('pending', $customer);
        $archivedIncoming = $this->makeOrder('incoming', $customer, null, true);

        $this->postJson('/api/admin/orders/approve-bulk', [
            'ids' => [$paidIncoming->id, $alreadyPending->id, $archivedIncoming->id],
        ])
            ->assertOk()
            ->assertJsonPath('action', 'approve')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['processed_ids' => [$paidIncoming->id]])
            ->assertJsonFragment([
                'skipped_ids' => [$alreadyPending->id, $archivedIncoming->id],
            ]);

        $this->assertDatabaseHas('orders', [
            'id' => $paidIncoming->id,
            'lifecycle_status' => 'pending',
            'customer_stage' => 'to_ship',
        ]);
        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $paidIncoming->id,
            'created_by_user_id' => $admin->id,
            'event_type' => 'admin_update',
            'title' => 'Order approved',
        ]);
        $this->assertDatabaseHas('admin_notifications', [
            'type' => 'success',
            'title' => 'Order Approved: ' . $paidIncoming->order_no,
        ]);

        $this->postJson('/api/admin/orders/reject-bulk', [
            'ids' => [$unpaidIncoming->id, $alreadyPending->id],
        ])
            ->assertOk()
            ->assertJsonPath('action', 'reject')
            ->assertJsonPath('processed_count', 1)
            ->assertJsonFragment(['processed_ids' => [$unpaidIncoming->id]])
            ->assertJsonFragment(['skipped_ids' => [$alreadyPending->id]]);

        $this->assertDatabaseHas('orders', [
            'id' => $unpaidIncoming->id,
            'lifecycle_status' => 'rejected',
        ]);
        $this->assertDatabaseHas('order_tracking_events', [
            'order_id' => $unpaidIncoming->id,
            'created_by_user_id' => $admin->id,
            'event_type' => 'admin_update',
            'title' => 'Order rejected',
            'description' => 'Your order could not be processed at this time.',
        ]);
        $this->assertDatabaseHas('admin_notifications', [
            'type' => 'warning',
            'title' => 'Order Rejected: ' . $unpaidIncoming->order_no,
        ]);

        $transport = Mail::mailer()->getSymfonyTransport();
        $this->assertInstanceOf(ArrayTransport::class, $transport);
        $subjects = $transport->messages()
            ->map(fn ($message) => $message->getOriginalMessage()->getSubject())
            ->unique()
            ->values()
            ->all();
        $this->assertTrue(collect($subjects)->contains(
            fn ($subject) => str_contains($subject, 'Order Approved')
                && str_contains($subject, $paidIncoming->order_no),
        ));
        $this->assertTrue(collect($subjects)->contains(
            fn ($subject) => str_contains($subject, 'Order Update')
                && str_contains($subject, $unpaidIncoming->order_no),
        ));
    }
}
