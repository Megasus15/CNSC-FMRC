<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Reconcile `order_returns` with the shipped return/refund model.
     *
     * An earlier draft of this feature created `order_returns` with a
     * single-product shape (`order_item_id`, `refund_amount`, `reason_details`,
     * `admin_note`…). Databases that ran that draft already have the table, so
     * `2026_08_17_000001_create_order_returns_table` correctly skips itself and
     * the newer columns never appear. This migration adds only what is missing —
     * every legacy column is left in place, so nothing is ever dropped and a
     * fresh database (where 000001 built the full table) is a no-op.
     */
    public function up(): void
    {
        if (!Schema::hasTable('order_returns')) {
            return;
        }

        Schema::table('order_returns', function (Blueprint $table): void {
            if (!Schema::hasColumn('order_returns', 'reason_detail')) {
                $table->text('reason_detail')->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'customer_note')) {
                $table->text('customer_note')->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'requested_amount')) {
                $table->decimal('requested_amount', 12, 2)->default(0);
            }

            if (!Schema::hasColumn('order_returns', 'refunded_amount')) {
                $table->decimal('refunded_amount', 12, 2)->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'decision_note')) {
                $table->text('decision_note')->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'return_courier_name')) {
                $table->string('return_courier_name', 120)->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'return_tracking_no')) {
                $table->string('return_tracking_no', 140)->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'decided_at')) {
                $table->timestamp('decided_at')->nullable();
            }

            if (!Schema::hasColumn('order_returns', 'item_received_at')) {
                $table->timestamp('item_received_at')->nullable();
            }
        });

        $this->backfillFromLegacyColumns();

        try {
            Schema::table('order_returns', function (Blueprint $table): void {
                $table->index(['is_archived', 'archived_at'], 'order_returns_archive_index');
            });
        } catch (\Throwable $error) {
            // Index already present — nothing to do.
        }
    }

    /** Copy any draft-era values into their shipped counterparts. */
    private function backfillFromLegacyColumns(): void
    {
        $pairs = [
            'reason_detail'       => 'reason_details',
            'requested_amount'    => 'refund_amount',
            'decision_note'       => 'admin_note',
            'return_courier_name' => 'courier_name',
            'return_tracking_no'  => 'courier_tracking_no',
            'item_received_at'    => 'received_at',
        ];

        foreach ($pairs as $target => $legacy) {
            if (!Schema::hasColumn('order_returns', $legacy) || !Schema::hasColumn('order_returns', $target)) {
                continue;
            }

            try {
                DB::table('order_returns')
                    ->whereNull($target)
                    ->whereNotNull($legacy)
                    ->update([$target => DB::raw("`{$legacy}`")]);
            } catch (\Throwable $error) {
                // Best-effort only: an unmigratable draft row must not block deploys.
            }
        }

        // `decided_at` collapses the draft's separate approve/reject timestamps.
        foreach (['approved_at', 'rejected_at'] as $legacy) {
            if (!Schema::hasColumn('order_returns', $legacy) || !Schema::hasColumn('order_returns', 'decided_at')) {
                continue;
            }

            try {
                DB::table('order_returns')
                    ->whereNull('decided_at')
                    ->whereNotNull($legacy)
                    ->update(['decided_at' => DB::raw("`{$legacy}`")]);
            } catch (\Throwable $error) {
                // Ignore — see above.
            }
        }
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
