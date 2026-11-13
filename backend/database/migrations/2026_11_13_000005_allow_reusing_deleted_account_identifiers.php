<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'deleted_at')) {
            throw new RuntimeException('Run 2026_11_13_000004_protect_builtin_admin_and_retain_deleted_users.php first.');
        }

        // Keep the original identity on historical records. Only active
        // accounts reserve credentials; NULL is intentionally not unique.
        foreach (['email', 'username'] as $column) {
            $active = 'active_'.$column;
            if (! Schema::hasColumn('users', $active)) {
                Schema::table('users', fn (Blueprint $table) => $table->string($active)->nullable()
                    ->virtualAs("CASE WHEN deleted_at IS NULL THEN {$column} ELSE NULL END"));
            }
            if (! Schema::hasIndex('users', 'users_'.$active.'_unique')) {
                Schema::table('users', fn (Blueprint $table) => $table->unique($active, 'users_'.$active.'_unique'));
            }
            // Install the replacement constraint before removing the old one.
            // Inspect names so older installations with renamed indexes work.
            foreach (Schema::getIndexes('users') as $index) {
                if ($index['unique'] && ! $index['primary'] && $index['columns'] === [$column]) {
                    Schema::table('users', fn (Blueprint $table) => $table->dropUnique($index['name']));
                }
            }
        }
    }

    public function down(): void
    {
        foreach (['email', 'username'] as $column) {
            if (DB::table('users')->select($column)->whereNotNull($column)->groupBy($column)->havingRaw('COUNT(*) > 1')->exists()) {
                throw new RuntimeException('Cannot roll back reusable account identifiers after an email or username has been reused. No accounts were changed.');
            }
        }
        foreach (['email', 'username'] as $column) {
            Schema::table('users', fn (Blueprint $table) => $table->unique($column));
            Schema::table('users', fn (Blueprint $table) => $table->dropUnique('users_active_'.$column.'_unique'));
            Schema::table('users', fn (Blueprint $table) => $table->dropColumn('active_'.$column));
        }
    }
};
