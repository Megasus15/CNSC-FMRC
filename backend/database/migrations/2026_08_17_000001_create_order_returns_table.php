<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Create the return / refund request header table.
     *
     * A return is a record attached to a completed order — the order's own
     * `customer_stage` enum is intentionally left untouched so no live enum has
     * to be widened.
     */
    public function up(): void
    {
        if (Schema::hasTable('order_returns')) {
            return;
        }

        Schema::create('order_returns', function (Blueprint $table): void {
            $table->id();
            $table->string('return_no', 40)->nullable()->unique();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('handled_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->enum('status', [
                'requested',
                'cancelled',
                'rejected',
                'approved',
                'item_in_transit',
                'item_received',
                'refund_processing',
                'refunded',
            ])->default('requested');

            $table->enum('reason', [
                'damaged',
                'wrong_item',
                'incomplete',
                'not_as_described',
                'quality_issue',
                'other',
            ])->default('damaged');
            $table->text('reason_detail')->nullable();

            $table->enum('resolution', ['refund', 'replacement', 'repair'])->default('refund');
            $table->text('customer_note')->nullable();
            $table->json('media')->nullable();

            $table->decimal('requested_amount', 12, 2)->default(0);
            $table->decimal('approved_amount', 12, 2)->nullable();
            $table->decimal('refunded_amount', 12, 2)->nullable();

            $table->enum('refund_method', ['gcash', 'bank_transfer', 'cash', 'store_credit'])->nullable();
            $table->string('refund_reference', 180)->nullable();
            $table->text('decision_note')->nullable();

            $table->string('return_courier_name', 120)->nullable();
            $table->string('return_tracking_no', 140)->nullable();

            $table->timestamp('requested_at')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->timestamp('item_received_at')->nullable();
            $table->timestamp('refunded_at')->nullable();

            $table->boolean('is_archived')->default(false);
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->index(['order_id', 'status']);
            $table->index(['customer_id', 'status']);
            $table->index(['is_archived', 'archived_at'], 'order_returns_archive_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Intentionally a no-op: return/refund records are financial history and
        // must survive a rollback of application code.
    }
};
