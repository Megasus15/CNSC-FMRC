<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('walk_in_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('walk_in_orders', 'product_id')) {
                $table->unsignedBigInteger('product_id')->nullable()->after('item_detail');
                $table->foreign('product_id')->references('id')->on('products')->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('walk_in_orders', function (Blueprint $table) {
            if (Schema::hasColumn('walk_in_orders', 'product_id')) {
                $table->dropForeign(['product_id']);
                $table->dropColumn('product_id');
            }
        });
    }
};
