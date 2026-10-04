<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('user_portal_preferences')) {
            $initial = require __DIR__.'/2026_10_04_000001_create_user_portal_preferences_table.php';
            $initial->up();
        }
        if (!Schema::hasColumn('user_portal_preferences', 'workspace')) {
            Schema::table('user_portal_preferences', fn (Blueprint $table) => $table->json('workspace')->nullable());
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('user_portal_preferences', 'workspace')) {
            Schema::table('user_portal_preferences', fn (Blueprint $table) => $table->dropColumn('workspace'));
        }
    }
};
