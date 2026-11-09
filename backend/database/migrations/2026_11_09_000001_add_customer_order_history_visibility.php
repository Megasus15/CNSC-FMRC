<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->timestamp('customer_hidden_at')->nullable();
            $table->index(['customer_id', 'customer_hidden_at'], 'orders_customer_history_index');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_customer_history_index');
            $table->dropColumn('customer_hidden_at');
        });
    }
};
