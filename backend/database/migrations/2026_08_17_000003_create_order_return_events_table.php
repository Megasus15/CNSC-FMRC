<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Audit timeline for a return request.
     *
     * A dedicated table rather than reusing `order_tracking_events`: that table
     * constrains `stage` to enum('to_pay','to_ship','to_receive','completed')
     * and `event_type` to enum('system','admin_update','courier_update'), and
     * widening a live enum is a needless risk. `status` is a plain string here
     * so the return vocabulary can grow without another migration.
     */
    public function up(): void
    {
        if (Schema::hasTable('order_return_events')) {
            return;
        }

        Schema::create('order_return_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_return_id')->constrained('order_returns')->cascadeOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 40)->default('requested');
            $table->string('actor_role', 20)->default('system');
            $table->string('title', 160);
            $table->text('description')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['order_return_id', 'occurred_at'], 'order_return_events_timeline_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // No-op: the timeline is the audit trail for money movement.
    }
};
