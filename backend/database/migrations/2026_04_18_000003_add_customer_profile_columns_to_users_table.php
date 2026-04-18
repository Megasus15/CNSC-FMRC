<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'phone_number')) {
                $table->string('phone_number', 30)->nullable()->after('role');
            }

            if (!Schema::hasColumn('users', 'address_line')) {
                $table->string('address_line', 500)->nullable()->after('phone_number');
            }

            if (!Schema::hasColumn('users', 'address_details')) {
                $table->string('address_details', 255)->nullable()->after('address_line');
            }

            if (!Schema::hasColumn('users', 'department')) {
                $table->string('department', 120)->nullable()->after('address_details');
            }

            if (!Schema::hasColumn('users', 'customer_type')) {
                $table->string('customer_type', 120)->nullable()->after('department');
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
