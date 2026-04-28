<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                if (Schema::hasColumn('orders', 'lifecycle_status') && Schema::hasColumn('orders', 'created_at')) {
                    $table->index(['lifecycle_status', 'created_at'], 'orders_lifecycle_created_idx');
                }
            });
        }

        if (Schema::hasTable('order_items')) {
            Schema::table('order_items', function (Blueprint $table) {
                if (Schema::hasColumn('order_items', 'order_id')) {
                    $table->index('order_id', 'order_items_order_id_idx');
                }

                if (Schema::hasColumn('order_items', 'product_id')) {
                    $table->index('product_id', 'order_items_product_id_idx');
                }

                if (Schema::hasColumn('order_items', 'product_name')) {
                    $table->index('product_name', 'order_items_product_name_idx');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropIndex('orders_lifecycle_created_idx');
            });
        }

        if (Schema::hasTable('order_items')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropIndex('order_items_order_id_idx');
                $table->dropIndex('order_items_product_id_idx');
                $table->dropIndex('order_items_product_name_idx');
            });
        }
    }
};
