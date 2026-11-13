<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('admin_notification_states')) return;
        Schema::create('admin_notification_states', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('notification_id')->constrained('admin_notifications')->cascadeOnDelete();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('dismissed_at')->nullable();
            $table->primary(['user_id', 'notification_id']);
        });
        // Legacy is_read stays immutable as the historical baseline. New actions
        // only write this per-user table; no account inherits another's actions.
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_notification_states');
    }
};
