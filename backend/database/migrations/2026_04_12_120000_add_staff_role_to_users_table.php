<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
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

        if (DB::getDriverName() !== 'mysql') {
            // SQLite/PostgreSQL test runs cannot use MySQL MODIFY ENUM syntax.
            return;
        }

        DB::statement("ALTER TABLE users MODIFY role ENUM('customer','admin','cashier','staff') NOT NULL DEFAULT 'customer'");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        DB::table('users')->where('role', 'staff')->update(['role' => 'customer']);

        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        DB::statement("ALTER TABLE users MODIFY role ENUM('customer','admin','cashier') NOT NULL DEFAULT 'customer'");
    }
};
