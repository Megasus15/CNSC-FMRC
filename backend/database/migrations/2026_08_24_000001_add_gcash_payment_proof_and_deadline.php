<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Let a GCash order be placed first and paid afterwards.
     *
     * Until now checkout refused a GCash order without a reference number, which
     * forced the customer to send the money before they knew the order would even
     * go through. Marketplaces do the opposite: the order is placed, a deadline is
     * shown, and the money follows. `payment_due_at` records that deadline on the
     * order, so it stays fixed even if the configured window changes later.
     *
     * On the payment side, `submitted_at` is when the customer handed over their
     * reference number and `proof_path` is the receipt screenshot they attached,
     * stored on the public disk exactly like return evidence. Both are claims.
     * They are deliberately separate from `paid_at`, which only staff can set once
     * they have matched the reference inside the FMRC GCash account - that is the
     * moment the money becomes revenue.
     */
    public function up(): void
    {
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                if (!Schema::hasColumn('orders', 'payment_due_at')) {
                    $table->timestamp('payment_due_at')->nullable()->after('payment_reference');
                }
            });
        }

        if (Schema::hasTable('payments')) {
            Schema::table('payments', function (Blueprint $table) {
                if (!Schema::hasColumn('payments', 'submitted_at')) {
                    $table->timestamp('submitted_at')->nullable()->after('status');
                }

                // Root-relative path on the public disk, not the image itself: the
                // customer's order list is polled every few seconds, and inlining a
                // screenshot would put megabytes into every one of those responses.
                if (!Schema::hasColumn('payments', 'proof_path')) {
                    $table->string('proof_path', 255)->nullable()->after('submitted_at');
                }
            });
        }

        // Orders already waiting to be paid predate the deadline, so give them one
        // measured from when they were placed instead of leaving it blank.
        //
        // The arithmetic is done in PHP rather than in a DATE_ADD() expression
        // because the test suite runs this same migration against SQLite, which
        // has no DATE_ADD - and a migration that only works on one driver is a
        // migration nobody can test. The affected set is "GCash orders still
        // waiting to be paid", so it is small enough to walk.
        if (Schema::hasColumn('orders', 'payment_due_at')) {
            $hours = max(1, (int) config('payments.gcash.payment_window_hours', 48));

            DB::table('orders')
                ->where('payment_method', 'GCash')
                ->where('customer_stage', 'to_pay')
                ->whereNull('payment_due_at')
                ->orderBy('id')
                ->select(['id', 'created_at'])
                ->chunk(200, function ($rows) use ($hours): void {
                    foreach ($rows as $row) {
                        $placedAt = $row->created_at
                            ? Carbon::parse($row->created_at)
                            : Carbon::now();

                        DB::table('orders')
                            ->where('id', $row->id)
                            ->update(['payment_due_at' => $placedAt->copy()->addHours($hours)]);
                    }
                });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Intentionally left as a no-op to avoid destructive rollback on production data.
    }
};
