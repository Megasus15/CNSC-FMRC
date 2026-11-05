<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

return new class extends Migration
{
    // SQLite rebuilds altered tables. Its foreign-key toggle must run outside
    // a transaction; MySQL DDL also commits independently of a transaction.
    public $withinTransaction = false;

    public function up(): void
    {
        $tables = ['custom_product_events', 'custom_product_attachments', 'custom_product_messages', 'custom_product_quotes', 'custom_product_requests'];
        $orderColumns = ['custom_product_quote_id', 'production_status', 'production_started_at', 'production_ready_at'];

        // Check before any DDL or deletions. Never erase or reclassify an order,
        // its receipts, refunds, stock movements, or fulfillment history.
        foreach ($orderColumns as $column) {
            if (Schema::hasColumn('orders', $column) && DB::table('orders')->whereNotNull($column)->exists()) {
                throw new RuntimeException('Cleanup stopped: an order still uses the retired workflow. Preserve its order and payment history and review it before continuing.');
            }
        }
        if (Schema::hasColumn('custom_product_quotes', 'accepted_at')
            && DB::table('custom_product_quotes')->whereNotNull('accepted_at')->exists()) {
            throw new RuntimeException('Cleanup stopped: an accepted quotation needs review before its records can be removed.');
        }

        $hadWorkflow = collect($tables)->contains(fn ($table) => Schema::hasTable($table))
            || Schema::hasColumn('services', 'accepts_custom_requests')
            || (Schema::hasTable('migrations') && DB::table('migrations')->whereIn('migration', [
                '2026_11_04_000001_create_custom_product_workflow',
                '2026_11_04_000002_add_archive_fields_to_custom_product_requests',
            ])->exists());

        DB::transaction(function (): void {
            // Use the exact feature type, never a broad title/message match.
            if (Schema::hasTable('admin_notifications')) {
                $ids = DB::table('admin_notifications')->where('type', 'custom_request')->pluck('id');
                if (Schema::hasTable('pwa_delivery_outbox')) {
                    foreach ($ids->chunk(200) as $chunk) {
                        DB::table('pwa_delivery_outbox')->whereIn('event_key', $chunk->map(fn ($id) => 'team:'.$id))->delete();
                    }
                }
                DB::table('admin_notifications')->where('type', 'custom_request')->delete();
            }
            if (Schema::hasTable('customer_notifications')) {
                $notifications = DB::table('customer_notifications')->where('type', 'custom_request');
                if (Schema::hasTable('pwa_delivery_outbox')) {
                    DB::table('pwa_delivery_outbox')->whereIn('event_key', (clone $notifications)->select('event_key'))->delete();
                }
                if (Schema::hasTable('customer_notification_reads')) {
                    DB::table('customer_notification_reads')->whereIn('notification_id', (clone $notifications)->select('id'))->delete();
                }
                $notifications->delete();
            }
            if (Schema::hasTable('site_settings')) {
                DB::table('site_settings')->whereIn('key', [
                    'editorial_services_custom_title', 'editorial_services_custom_copy', 'editorial_services_custom_button',
                ])->delete();
            }
            if (Schema::hasColumn('report_generations', 'sales_type')) {
                DB::table('report_generations')->where('sales_type', 'custom')->delete();
            }
        });

        $removeOrderColumns = function () use ($orderColumns): void {
            if (! Schema::hasTable('orders')) return;
            foreach (Schema::getForeignKeys('orders') as $foreign) {
                if (array_intersect($foreign['columns'], $orderColumns)) {
                    $key = DB::getDriverName() === 'sqlite' ? $foreign['columns'] : $foreign['name'];
                    Schema::table('orders', fn (Blueprint $table) => $table->dropForeign($key));
                }
            }
            foreach (Schema::getIndexes('orders') as $index) {
                if (! $index['primary'] && array_intersect($index['columns'], $orderColumns)) {
                    Schema::table('orders', fn (Blueprint $table) => $table->dropIndex($index['name']));
                }
            }
            $present = array_values(array_filter($orderColumns, fn ($column) => Schema::hasColumn('orders', $column)));
            if ($present) Schema::table('orders', fn (Blueprint $table) => $table->dropColumn($present));
        };
        if (DB::getDriverName() === 'sqlite') Schema::withoutForeignKeyConstraints($removeOrderColumns);
        else $removeOrderColumns();
        foreach ($tables as $table) Schema::dropIfExists($table);
        foreach (['services' => 'accepts_custom_requests', 'report_generations' => 'sales_type'] as $table => $column) {
            if (Schema::hasColumn($table, $column)) Schema::table($table, fn (Blueprint $blueprint) => $blueprint->dropColumn($column));
        }

        // Only this feature's private directory is removed. An application
        // installed without the old workflow does not touch filesystem data.
        if ($hadWorkflow && ! Storage::disk('local')->deleteDirectory('custom-product-designs')) {
            throw new RuntimeException('The retired private upload directory could not be removed. Check storage permissions and rerun this migration.');
        }
    }

    public function down(): void
    {
        throw new RuntimeException('This cleanup is irreversible. Restore the database and private-upload backups to recover removed test requests.');
    }
};
