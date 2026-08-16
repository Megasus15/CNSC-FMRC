<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('product_ratings')) {
            return;
        }

        Schema::table('product_ratings', function (Blueprint $table): void {
            if (!Schema::hasColumn('product_ratings', 'is_archived')) {
                $table->boolean('is_archived')->default(false);
            }

            if (!Schema::hasColumn('product_ratings', 'archived_at')) {
                $table->timestamp('archived_at')->nullable();
            }
        });

        try {
            Schema::table('product_ratings', function (Blueprint $table): void {
                $table->index(['is_archived', 'archived_at'], 'product_ratings_archive_index');
            });
        } catch (\Throwable) {
            // The index may already exist on an upgraded installation.
        }
    }

    public function down(): void
    {
        // Keep review history safe on rollback; archive fields are additive.
    }
};
