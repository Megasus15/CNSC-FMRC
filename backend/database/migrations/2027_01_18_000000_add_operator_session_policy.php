<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('user_portal_preferences', 'session_policy')) {
            Schema::table('user_portal_preferences', fn (Blueprint $table) => $table->json('session_policy')->nullable());
        }
        if (! Schema::hasColumn('personal_access_tokens', 'operator_session_max_hours')) {
            Schema::table('personal_access_tokens', fn (Blueprint $table) => $table->unsignedTinyInteger('operator_session_max_hours')->nullable());
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('personal_access_tokens', 'operator_session_max_hours')) {
            Schema::table('personal_access_tokens', fn (Blueprint $table) => $table->dropColumn('operator_session_max_hours'));
        }
        if (Schema::hasColumn('user_portal_preferences', 'session_policy')) {
            Schema::table('user_portal_preferences', fn (Blueprint $table) => $table->dropColumn('session_policy'));
        }
    }
};
