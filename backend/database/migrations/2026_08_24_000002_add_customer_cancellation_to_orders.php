<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Let a customer call off an order that has not shipped yet.
     *
     * Modelled on Shopee/Lazada, which split cancellation in two:
     *
     *  - nothing has been paid and nothing has been prepared, so the customer
     *    cancels outright and the order is simply gone; or
     *  - money has already changed hands, or staff have started preparing the
     *    job, so the tap only files a *request* that staff accept or decline.
     *
     * Both outcomes end at `lifecycle_status = 'cancelled'`, which is why the
     * enum has to be widened. That value is deliberately outside
     * `Order::GCASH_ADVANCE_LIFECYCLE_STATUSES`, so a cancelled order drops out
     * of Total Revenue the moment it is cancelled - the same reasoning that
     * already excludes `rejected`: the money is owed back, not earned.
     *
     * `cancel_state` tracks the request itself and is what the admin queue reads.
     * It stays `none` for an order nobody has asked to cancel, so existing rows
     * need no backfill.
     */
    public function up(): void
    {
        if (! Schema::hasTable('orders')) {
            return;
        }

        // Widen the lifecycle enum in place. Adding a member to an enum rewrites
        // no rows, and the surrounding definition is repeated verbatim so the
        // default and nullability survive the ALTER.
        if (Schema::hasColumn('orders', 'lifecycle_status') && $this->isMySql()) {
            $current = $this->enumMembers('orders', 'lifecycle_status');

            if ($current !== [] && ! in_array('cancelled', $current, true)) {
                $members = array_merge($current, ['cancelled']);
                $list = implode(',', array_map(fn (string $value) => "'".$value."'", $members));

                DB::statement(
                    "ALTER TABLE `orders` MODIFY COLUMN `lifecycle_status` ENUM({$list}) NOT NULL DEFAULT 'incoming'"
                );
            }
        }

        Schema::table('orders', function (Blueprint $table): void {
            if (! Schema::hasColumn('orders', 'cancel_state')) {
                $table->enum('cancel_state', ['none', 'requested', 'approved', 'declined'])
                    ->default('none')
                    ->after('customer_stage');
            }

            // The picked reason code, plus the free-text box the sheet shows for
            // "Other". Kept as separate columns rather than folded into `notes`
            // because the admin list filters and groups by the code.
            if (! Schema::hasColumn('orders', 'cancel_reason')) {
                $table->string('cancel_reason', 40)->nullable()->after('cancel_state');
            }

            if (! Schema::hasColumn('orders', 'cancel_reason_detail')) {
                $table->string('cancel_reason_detail', 600)->nullable()->after('cancel_reason');
            }

            if (! Schema::hasColumn('orders', 'cancel_requested_at')) {
                $table->timestamp('cancel_requested_at')->nullable()->after('cancel_reason_detail');
            }

            if (! Schema::hasColumn('orders', 'cancelled_at')) {
                $table->timestamp('cancelled_at')->nullable()->after('cancel_requested_at');
            }

            if (! Schema::hasColumn('orders', 'cancel_decided_at')) {
                $table->timestamp('cancel_decided_at')->nullable()->after('cancelled_at');
            }

            if (! Schema::hasColumn('orders', 'cancel_decided_by_user_id')) {
                $table->unsignedBigInteger('cancel_decided_by_user_id')->nullable()->after('cancel_decided_at');
            }

            if (! Schema::hasColumn('orders', 'cancel_decision_note')) {
                $table->string('cancel_decision_note', 600)->nullable()->after('cancel_decided_by_user_id');
            }

            // Set when the order is cancelled while its payment was already
            // confirmed. Nothing here moves money - it is the flag that tells
            // staff a GCash send-back is outstanding, and it is what the
            // customer's "refund on the way" line reads.
            if (! Schema::hasColumn('orders', 'cancel_refund_due')) {
                $table->boolean('cancel_refund_due')->default(false)->after('cancel_decision_note');
            }
        });

        // The admin queue asks "which orders are waiting on a cancellation
        // decision", which is a single-column lookup over a mostly-'none' set.
        if (Schema::hasColumn('orders', 'cancel_state') && ! $this->hasIndex('orders', 'orders_cancel_state_idx')) {
            Schema::table('orders', function (Blueprint $table): void {
                $table->index('cancel_state', 'orders_cancel_state_idx');
            });
        }

        if (Schema::hasTable('payments')) {
            Schema::table('payments', function (Blueprint $table): void {
                // `paid_at` is when the money arrived; these two are when it went
                // back and under which GCash reference, so a refund is auditable
                // without reading the order notes.
                if (! Schema::hasColumn('payments', 'refunded_at')) {
                    $table->timestamp('refunded_at')->nullable()->after('paid_at');
                }

                if (! Schema::hasColumn('payments', 'refund_reference')) {
                    $table->string('refund_reference', 64)->nullable()->after('refunded_at');
                }
            });
        }
    }

    public function down(): void
    {
        // Intentionally a no-op: dropping these would destroy the record of who
        // cancelled what and which refunds were sent.
    }

    private function isMySql(): bool
    {
        return in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true);
    }

    /**
     * Read the current members of an enum column straight from the schema, so the
     * ALTER re-states the real definition instead of a hard-coded guess that
     * could silently drop a value some other migration added.
     */
    private function enumMembers(string $table, string $column): array
    {
        try {
            $row = DB::selectOne(
                'SELECT COLUMN_TYPE AS column_type
                   FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = ?
                    AND COLUMN_NAME = ?',
                [$table, $column]
            );
        } catch (\Throwable) {
            return [];
        }

        $type = (string) ($row->column_type ?? '');

        if (! preg_match('/^enum\((.*)\)$/i', $type, $matches)) {
            return [];
        }

        preg_match_all("/'((?:[^']|'')*)'/", $matches[1], $values);

        return array_map(fn (string $value) => str_replace("''", "'", $value), $values[1] ?? []);
    }

    private function hasIndex(string $table, string $index): bool
    {
        try {
            return DB::selectOne(
                'SELECT 1 AS found
                   FROM INFORMATION_SCHEMA.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = ?
                    AND INDEX_NAME = ?
                  LIMIT 1',
                [$table, $index]
            ) !== null;
        } catch (\Throwable) {
            return false;
        }
    }
};
