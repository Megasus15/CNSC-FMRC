<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add the explicit account state used by the Google password reminder.
     *
     * Existing accounts predate this distinction, so they are treated as
     * already password-enabled. New Google-created accounts are explicitly
     * created with has_custom_password set to false by AuthController.
     */
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'signed_with_google')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('signed_with_google')->default(false);
            });
        }

        if (!Schema::hasColumn('users', 'has_custom_password')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('has_custom_password')->default(true);
            });
        }
    }

    /**
     * Reverse the migration.
     */
    public function down(): void
    {
        if (Schema::hasColumn('users', 'has_custom_password')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('has_custom_password');
            });
        }

        if (Schema::hasColumn('users', 'signed_with_google')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('signed_with_google');
            });
        }
    }
};
