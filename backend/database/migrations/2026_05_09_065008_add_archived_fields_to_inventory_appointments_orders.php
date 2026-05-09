<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     * Adds is_archived + archived_at to inventory_items, orders, and walk_in_orders.
     * Appointments already have status='Archived' so no column needed there.
     */
    public function up(): void
    {
        // --- Inventory Items ---
        if (Schema::hasTable('inventory_items') && !Schema::hasColumn('inventory_items', 'is_archived')) {
            Schema::table('inventory_items', function (Blueprint $table) {
                $table->boolean('is_archived')->default(false)->after('remarks');
                $table->timestamp('archived_at')->nullable()->after('is_archived');
            });
        }

        // --- Orders ---
        if (Schema::hasTable('orders') && !Schema::hasColumn('orders', 'is_archived')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->boolean('is_archived')->default(false)->after('notes');
                $table->timestamp('archived_at')->nullable()->after('is_archived');
            });
        }

        // --- Walk-in Orders ---
        if (Schema::hasTable('walk_in_orders') && !Schema::hasColumn('walk_in_orders', 'is_archived')) {
            Schema::table('walk_in_orders', function (Blueprint $table) {
                $table->boolean('is_archived')->default(false);
                $table->timestamp('archived_at')->nullable();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('inventory_items')) {
            Schema::table('inventory_items', function (Blueprint $table) {
                $table->dropColumn(['is_archived', 'archived_at']);
            });
        }

        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropColumn(['is_archived', 'archived_at']);
            });
        }

        if (Schema::hasTable('walk_in_orders')) {
            Schema::table('walk_in_orders', function (Blueprint $table) {
                $table->dropColumn(['is_archived', 'archived_at']);
            });
        }
    }
};
