<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'is_builtin_admin')) $table->boolean('is_builtin_admin')->default(false);
            if (! Schema::hasColumn('users', 'deleted_at')) $table->softDeletes();
        });

        // Pin the original full Admin once. Identity edits must never transfer
        // this protection to a different account, or depend on an email/name.
        if (! DB::table('users')->where('is_builtin_admin', true)->exists()) {
            $admins = DB::table('users')->where('role', 'admin')->whereNull('deleted_at');
            if (Schema::hasColumn('users', 'is_spectator')) {
                $admins->where(fn ($query) => $query->whereNull('is_spectator')->orWhere('is_spectator', false));
            }
            $original = $admins->orderBy('id')->value('id');
            if ($original) DB::table('users')->where('id', $original)->update(['is_builtin_admin' => true]);
        }
    }

    public function down(): void
    {
        // Dropping deletion state would reactivate removed accounts.
        if (DB::table('users')->whereNotNull('deleted_at')->exists()) {
            throw new RuntimeException('Cannot roll back account protection while deleted accounts are retained. Keep their access revoked.');
        }
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['is_builtin_admin', 'deleted_at']));
    }
};
