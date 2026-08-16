<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Add a lightweight product_image_reference column so the customer orders
     * API can return a small URL string instead of forcing a separate HTTP
     * request for every order-item thumbnail.
     */
    public function up(): void
    {
        if (!Schema::hasTable('order_items')) {
            return;
        }

        if (!Schema::hasColumn('order_items', 'product_image_reference')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->string('product_image_reference', 2048)
                    ->nullable()
                    ->after('product_image')
                    ->comment('Lightweight URL reference for the product image (non-base64)');
            });
        }

        // Backfill existing rows: extract the reference from product_image
        // when it is a short URL (not a data-URI).
        DB::statement(<<<'SQL'
            UPDATE order_items
               SET product_image_reference = product_image
             WHERE product_image IS NOT NULL
               AND LENGTH(product_image) <= 2048
               AND product_image NOT LIKE 'data:%'
        SQL);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('order_items') && Schema::hasColumn('order_items', 'product_image_reference')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropColumn('product_image_reference');
            });
        }
    }
};
