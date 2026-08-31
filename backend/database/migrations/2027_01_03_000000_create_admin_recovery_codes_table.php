<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * One-time recovery codes for the admin account. Only the bcrypt hash of a
     * code is ever stored, so a database leak cannot be replayed as a login.
     */
    public function up(): void
    {
        if (!Schema::hasTable('admin_recovery_codes')) {
            Schema::create('admin_recovery_codes', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id');
                $table->string('code_hash');
                $table->timestamp('used_at')->nullable();
                $table->string('used_ip', 45)->nullable();
                $table->timestamps();

                $table->index(['user_id', 'used_at']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('admin_recovery_codes');
    }
};
