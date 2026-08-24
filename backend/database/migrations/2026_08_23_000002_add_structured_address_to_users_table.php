<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Structured address parts for the saved customer profile.
     *
     * `address_line` stays as the street/house portion so existing rows keep
     * their meaning; barangay, city, province and postal code move into their
     * own columns because a courier needs them separated, and because a
     * required field can only be enforced when it exists on its own.
     */
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'barangay')) {
                $table->string('barangay', 120)->nullable()->after('address_details');
            }

            if (!Schema::hasColumn('users', 'city_municipality')) {
                $table->string('city_municipality', 120)->nullable()->after('barangay');
            }

            if (!Schema::hasColumn('users', 'province')) {
                $table->string('province', 120)->nullable()->after('city_municipality');
            }

            if (!Schema::hasColumn('users', 'postal_code')) {
                $table->string('postal_code', 10)->nullable()->after('province');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Intentionally left as a no-op to avoid destructive rollback on production data.
    }
};
