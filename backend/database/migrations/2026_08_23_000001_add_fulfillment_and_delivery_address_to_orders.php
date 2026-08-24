<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Split the delivery destination out of the free-text `location_name` column.
     *
     * Until now the whole address arrived as one unvalidated string, which made
     * it impossible to tell a real destination from a typo, to plot the order
     * on a map, or to tell a pickup apart from a shipment. `fulfillment_type`
     * records how the customer receives the item and the `delivery_*` columns
     * hold the structured destination; `location_name` is kept in sync as a
     * human-readable one-liner so every existing screen keeps working.
     */
    public function up(): void
    {
        if (!Schema::hasTable('orders')) {
            return;
        }

        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'fulfillment_type')) {
                $table->enum('fulfillment_type', ['pickup', 'delivery'])
                    ->default('delivery')
                    ->after('payment_reference');
            }

            // Recipient details are snapshotted onto the order on purpose: the
            // customer may edit their address book later, but the parcel that
            // already shipped was addressed to whoever is recorded here.
            if (!Schema::hasColumn('orders', 'delivery_recipient_name')) {
                $table->string('delivery_recipient_name', 160)->nullable()->after('fulfillment_type');
            }

            if (!Schema::hasColumn('orders', 'delivery_contact_no')) {
                $table->string('delivery_contact_no', 40)->nullable()->after('delivery_recipient_name');
            }

            if (!Schema::hasColumn('orders', 'delivery_street')) {
                $table->string('delivery_street', 255)->nullable()->after('delivery_contact_no');
            }

            if (!Schema::hasColumn('orders', 'delivery_barangay')) {
                $table->string('delivery_barangay', 120)->nullable()->after('delivery_street');
            }

            if (!Schema::hasColumn('orders', 'delivery_city')) {
                $table->string('delivery_city', 120)->nullable()->after('delivery_barangay');
            }

            if (!Schema::hasColumn('orders', 'delivery_province')) {
                $table->string('delivery_province', 120)->nullable()->after('delivery_city');
            }

            if (!Schema::hasColumn('orders', 'delivery_postal_code')) {
                $table->string('delivery_postal_code', 10)->nullable()->after('delivery_province');
            }

            if (!Schema::hasColumn('orders', 'delivery_landmark')) {
                $table->string('delivery_landmark', 255)->nullable()->after('delivery_postal_code');
            }

            // Destination coordinates, set from the checkout pin-drop. Separate
            // from last_known_lat/lng, which tracks where the parcel currently
            // is rather than where it is headed.
            if (!Schema::hasColumn('orders', 'delivery_lat')) {
                $table->decimal('delivery_lat', 10, 7)->nullable()->after('delivery_landmark');
            }

            if (!Schema::hasColumn('orders', 'delivery_lng')) {
                $table->decimal('delivery_lng', 10, 7)->nullable()->after('delivery_lat');
            }

            // Pickup orders never travel, so they need a handover code instead
            // of a tracking number - it stops the wrong person collecting a
            // paid item at the counter.
            if (!Schema::hasColumn('orders', 'pickup_code')) {
                $table->string('pickup_code', 12)->nullable()->after('delivery_lng');
            }

            if (!Schema::hasColumn('orders', 'pickup_ready_at')) {
                $table->timestamp('pickup_ready_at')->nullable()->after('pickup_code');
            }

            if (!Schema::hasColumn('orders', 'picked_up_at')) {
                $table->timestamp('picked_up_at')->nullable()->after('pickup_ready_at');
            }
        });

        // Existing rows predate the column, so classify them from the payment
        // method that was recorded at the time: Cash-on-Pickup never shipped.
        if (Schema::hasColumn('orders', 'fulfillment_type')) {
            \Illuminate\Support\Facades\DB::table('orders')
                ->where('payment_method', 'COP')
                ->update(['fulfillment_type' => 'pickup']);
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
