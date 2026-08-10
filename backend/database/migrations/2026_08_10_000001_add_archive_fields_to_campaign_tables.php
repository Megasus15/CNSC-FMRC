<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->boolean('is_archived')->default(false)->after('is_enabled');
            $table->timestamp('archived_at')->nullable()->after('is_archived');
            $table->index(['is_archived', 'archived_at'], 'promotions_archive_idx');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->boolean('is_archived')->default(false)->after('is_enabled');
            $table->timestamp('archived_at')->nullable()->after('is_archived');
            $table->index(['is_archived', 'archived_at'], 'announcements_archive_idx');
        });
    }

    public function down(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->dropIndex('promotions_archive_idx');
            $table->dropColumn(['is_archived', 'archived_at']);
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->dropIndex('announcements_archive_idx');
            $table->dropColumn(['is_archived', 'archived_at']);
        });
    }
};
