<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('login_failure_states', function (Blueprint $table) {
            $table->id();
            // A keyed digest avoids retaining attempted email addresses or usernames.
            $table->string('scope_key', 64)->unique();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->unsignedInteger('failed_attempts')->default(0);
            $table->unsignedTinyInteger('lockout_count')->default(0);
            $table->timestamp('locked_until')->nullable();
            $table->string('ticket_hash', 64)->nullable()->unique();
            $table->text('ticket_ciphertext')->nullable();
            $table->timestamp('last_failed_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'last_failed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('login_failure_states');
    }
};
