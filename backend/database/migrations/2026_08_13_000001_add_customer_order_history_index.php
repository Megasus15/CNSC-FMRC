<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            Schema::hasTable('orders') &&
            Schema::hasColumn('orders', 'customer_id') &&
            Schema::hasColumn('orders', 'created_at')
        ) {
            Schema::table('orders', function (Blueprint $table) {
                $table->index(['customer_id', 'created_at'], 'orders_customer_created_idx');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropIndex('orders_customer_created_idx');
            });
        }
    }
};
