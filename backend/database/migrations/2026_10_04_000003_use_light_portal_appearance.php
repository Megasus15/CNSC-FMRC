<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('user_portal_preferences', 'theme')) {
            Schema::table('user_portal_preferences', fn (Blueprint $table) => $table->string('theme', 10)->default('light')->change());
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('user_portal_preferences', 'theme')) {
            Schema::table('user_portal_preferences', fn (Blueprint $table) => $table->string('theme', 10)->default('system')->change());
        }
    }
};
