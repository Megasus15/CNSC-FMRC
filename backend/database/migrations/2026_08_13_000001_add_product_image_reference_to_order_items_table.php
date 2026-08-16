<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Adds the lightweight thumbnail reference column used by the customer
     * "My Orders" drawer.
     *
     * The orders API selects this column so the multi-megabyte
     * `product_image` snapshot never enters the JSON payload. Without the
     * column the whole customer orders query fails, which is why every
     * My Orders tab kept showing spinning thumbnails.
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
                    ->after('product_name');
            });
        }

        // Backfill existing rows whose stored snapshot is already a short URL
        // (not a base64 data URI). Those can be served directly by the browser.
        DB::table('order_items')
            ->whereNull('product_image_reference')
            ->whereNotNull('product_image')
            ->where('product_image', 'not like', 'data:%')
            ->update([
                'product_image_reference' => DB::raw('product_image'),
            ]);
    }

    public function down(): void
    {
        if (
            Schema::hasTable('order_items') &&
            Schema::hasColumn('order_items', 'product_image_reference')
        ) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropColumn('product_image_reference');
            });
        }
    }
};
