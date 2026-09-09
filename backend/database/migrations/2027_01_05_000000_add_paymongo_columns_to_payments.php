<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add PayMongo tracking columns to the payments table.
     *
     * These store the identifiers PayMongo returns when a checkout session is
     * created and when a payment is confirmed via webhook. They are the link
     * between our local payment record and the PayMongo transaction, and they
     * let the webhook handler find the right payment to mark as paid.
     */
    public function up(): void
    {
        if (Schema::hasTable('payments')) {
            Schema::table('payments', function (Blueprint $table) {
                if (!Schema::hasColumn('payments', 'paymongo_checkout_id')) {
                    $table->string('paymongo_checkout_id', 100)->nullable()->after('proof_path')
                        ->comment('PayMongo checkout session ID (cs_xxx)');
                }

                if (!Schema::hasColumn('payments', 'paymongo_payment_id')) {
                    $table->string('paymongo_payment_id', 100)->nullable()->after('paymongo_checkout_id')
                        ->comment('PayMongo payment intent ID after successful payment');
                }

                // Index the checkout ID for fast webhook lookups — each webhook
                // carries the checkout session ID and needs to find the matching
                // payment row in one indexed lookup rather than a table scan.
                if (!Schema::hasColumn('payments', 'paymongo_checkout_id')) {
                    // Column was just created above; add the index in the same
                    // closure so it runs in one ALTER TABLE statement.
                } else {
                    // Column already existed (re-run safety). Check for index.
                }
            });

            // Add the index separately to handle both fresh and re-run cases.
            // Schema::hasIndex is not available in all Laravel versions, so we
            // use a try/catch to silently skip if the index already exists.
            try {
                Schema::table('payments', function (Blueprint $table) {
                    $table->index('paymongo_checkout_id', 'payments_paymongo_checkout_id_index');
                });
            } catch (\Throwable) {
                // Index already exists — nothing to do.
            }
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
