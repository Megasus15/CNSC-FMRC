<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Drop legacy ones if we want, or just add the missing ones safely
            if (!Schema::hasColumn('products', 'code')) {
                $table->string('code')->nullable()->unique()->after('category');
            }
            if (!Schema::hasColumn('products', 'price')) {
                $table->decimal('price', 10, 2)->default(0)->after('stock');
            }
            if (!Schema::hasColumn('products', 'image_data')) {
                $table->longText('image_data')->nullable()->after('is_blocked');
            }
            if (!Schema::hasColumn('products', 'summary')) {
                $table->text('summary')->nullable()->after('image_data');
            }
            if (!Schema::hasColumn('products', 'details_chips')) {
                $table->json('details_chips')->nullable()->after('summary');
            }
            if (!Schema::hasColumn('products', 'availability')) {
                $table->json('availability')->nullable()->after('details_chips');
            }
        });
        
        // Convert old availability_notes if it exists but availability doesn't? No need.
        // Also ensure recommended_for is JSON, some migrations might have made it TEXT.
        // But Laravel json() falls back to TEXT on older mysql.
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['code', 'price', 'image_data', 'summary', 'details_chips', 'availability']);
        });
    }
};
