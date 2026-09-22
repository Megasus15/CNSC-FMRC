<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_spectator')->default(false);
            $table->timestamp('spectator_expires_at')->nullable();
        });
    }

    public function down(): void
    {
        // Removing the flag while an account exists would turn it into a full
        // administrator. Require explicit account removal before rollback.
        if (DB::table('users')->where('is_spectator', true)->exists()) {
            throw new RuntimeException('Remove spectator accounts with php artisan admin:spectator --remove before rolling back.');
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['is_spectator', 'spectator_expires_at']);
        });
    }
};
