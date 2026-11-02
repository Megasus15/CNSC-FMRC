<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipping_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('revision')->default(0);
            $table->json('draft')->nullable();
            $table->json('published')->nullable();
            $table->uuid('published_version')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->unsignedBigInteger('published_by')->nullable();
            $table->timestamps();
        });
        DB::table('shipping_settings')->insert(['id' => 1, 'revision' => 0, 'created_at' => now(), 'updated_at' => now()]);
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('shipping_fee', 12, 2)->nullable();
            $table->json('shipping_quote')->nullable();
            $table->date('estimated_delivery_from')->nullable();
            $table->date('estimated_delivery_to')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn(['shipping_fee', 'shipping_quote', 'estimated_delivery_from', 'estimated_delivery_to']));
        Schema::dropIfExists('shipping_settings');
    }
};
