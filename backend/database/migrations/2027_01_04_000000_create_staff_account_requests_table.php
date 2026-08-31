<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Queue of staff-account applications submitted from the Admin/Staff sign-in
     * page. A row holds the credentials the applicant chose (password as a bcrypt
     * hash only, never plaintext) until an administrator approves or rejects it.
     *
     * Decided rows are kept rather than deleted: they are the audit trail of who
     * was let in, by whom, and when. `password_hash` is nulled the moment a
     * decision is made, so a stale queue is not a pile of reusable credentials.
     *
     * `status` is a plain string, NOT an enum. Enum-widening migrations in this
     * project early-return on non-MySQL drivers and have twice left the SQLite
     * test schema behind the MySQL one; a string cannot repeat that.
     */
    public function up(): void
    {
        if (!Schema::hasTable('staff_account_requests')) {
            Schema::create('staff_account_requests', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                // 50 is the ceiling AuthController::register validates usernames to.
                $table->string('username', 50);
                $table->string('email');
                // Bcrypt hash of the applicant's chosen password; nulled on decision.
                $table->string('password_hash')->nullable();
                $table->string('status', 20)->default('pending');
                $table->string('decision_note', 300)->nullable();
                $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('reviewed_at')->nullable();
                $table->foreignId('created_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('request_ip', 45)->nullable();
                $table->timestamps();

                // The admin queue reads pending-first, newest-first.
                $table->index(['status', 'created_at']);
                // "One pending request per email / username" is enforced in the
                // controller, not here: a REJECTED applicant must be able to
                // re-apply, so a unique index on either column would be wrong.
                $table->index('email');
                $table->index('username');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('staff_account_requests');
    }
};
