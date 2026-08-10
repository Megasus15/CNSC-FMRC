<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'name')) {
                $table->string('name')->after('id');
            }
            $table->string('category')->default('3D Print')->after('name');
            $table->string('code')->unique()->nullable()->after('category');
            $table->unsignedInteger('stock')->default(0)->after('code');
            $table->decimal('price', 10, 2)->default(0)->after('stock');
            $table->enum('stock_status', ['in_stock', 'out_of_stock'])->default('in_stock')->after('price');
            $table->boolean('is_blocked')->default(false)->after('stock_status');
            $table->longText('image_data')->nullable()->after('is_blocked');
            $table->text('summary')->nullable()->after('image_data');
            $table->json('details_chips')->nullable()->after('summary');
            $table->json('availability')->nullable()->after('details_chips');
            $table->json('recommended_for')->nullable()->after('availability');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn([
                'name', 'category', 'code', 'stock', 'price',
                'stock_status', 'is_blocked', 'image_data',
                'summary', 'details_chips', 'availability', 'recommended_for',
            ]);
        });
    }
};
