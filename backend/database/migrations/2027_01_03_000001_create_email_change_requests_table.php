<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Holds a pending admin Gmail change until the 6-digit code mailed to the NEW
     * address is entered. Without this, a mistyped address instantly becomes the
     * only password-reset destination and locks the single admin account out.
     */
    public function up(): void
    {
        if (!Schema::hasTable('email_change_requests')) {
            Schema::create('email_change_requests', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id');
                $table->string('new_email');
                $table->string('otp_hash');
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->timestamp('expires_at')->nullable();
                $table->timestamps();

                $table->index(['user_id']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('email_change_requests');
    }
};
