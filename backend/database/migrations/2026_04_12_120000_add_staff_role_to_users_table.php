<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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

        if (DB::getDriverName() === 'mysql' || DB::getDriverName() === 'mariadb') {
            DB::statement("ALTER TABLE users MODIFY role ENUM('customer','admin','cashier','staff') NOT NULL DEFAULT 'customer'");

            return;
        }

        if (DB::getDriverName() !== 'sqlite') {
            return;
        }

        // SQLite compiles an enum into a CHECK constraint and offers no way to
        // alter one, so the column becomes a plain string instead. Skipping the
        // column entirely - which is what this migration used to do - left the
        // test schema still refusing 'staff', so no test could create a staff
        // user and the whole staff portal was untestable. The role is validated
        // in the application either way; the constraint was never what kept it
        // honest.
        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('customer')->change();
        });
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

        if (DB::getDriverName() !== 'mysql' && DB::getDriverName() !== 'mariadb') {
            // Nothing to put back: SQLite was widened to a plain string, and
            // narrowing it again would only re-break the test schema.
            return;
        }

        DB::statement("ALTER TABLE users MODIFY role ENUM('customer','admin','cashier') NOT NULL DEFAULT 'customer'");
    }
};
