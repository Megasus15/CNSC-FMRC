<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class AdminAccounts
{
    public static function ensureInstalled(): void
    {
        abort_unless((new User)->hasSchemaColumns(['is_builtin_admin', 'deleted_at']), 503,
            'Account deletion protection is not installed. Run 2026_11_13_000004_protect_builtin_admin_and_retain_deleted_users.php before deleting accounts.');
    }

    /** Call inside a transaction. Always lock the roster in the same order. */
    public static function lockRoster(User $actor): Collection
    {
        $admins = User::where('role', 'admin')->orderBy('id')->lockForUpdate()->get();
        $current = $admins->firstWhere('id', $actor->id);
        abort_unless($current && ! $current->isSpectator(), 403, 'Your Admin account is no longer available. Sign in again.');

        return $admins;
    }

    public static function fullCount(Collection $admins): int
    {
        return $admins->filter(fn (User $user) => $user->role === 'admin' && ! $user->isSpectator())->count();
    }

    public static function deletionBlocker(User $target, User $actor, int $fullCount): ?string
    {
        if ($actor->isSpectator()) return 'Presentation accounts are view only.';
        if (! (new User)->hasSchemaColumns(['is_builtin_admin', 'deleted_at'])) return 'Account deletion is unavailable until the account-protection migration is installed.';
        if ($target->isBuiltInAdmin()) return 'The built-in Admin account is protected and cannot be deleted.';
        if ((int) $target->id === (int) $actor->id) return 'Your signed-in account cannot be deleted.';
        if ($target->role === 'admin' && ! $target->isSpectator() && $fullCount <= 1) return 'At least one full Admin account must remain.';

        return null;
    }

    public static function delete(User $actor, array $ids, bool $bulk = false): array
    {
        self::ensureInstalled();
        return DB::transaction(function () use ($actor, $ids, $bulk): array {
            $roster = self::lockRoster($actor);
            $remaining = self::fullCount($roster);
            $targets = User::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
            $deleted = [];
            foreach ($targets as $target) {
                if ($bulk && ((int) $target->id === (int) $actor->id || $target->isBuiltInAdmin())) continue;
                if ($reason = self::deletionBlocker($target, $actor, $remaining)) abort(422, $reason);
                $target->tokens()->delete();
                Pwa::revokeUser((int) $target->id);
                DB::table('sessions')->where('user_id', $target->id)->delete();
                DB::table('password_reset_tokens')->where('email', $target->email)->delete();
                if (Schema::hasTable('password_reset_otps')) DB::table('password_reset_otps')->where('email', $target->email)->delete();
                foreach (['admin_recovery_codes', 'email_change_requests'] as $table) {
                    if (Schema::hasTable($table)) DB::table($table)->where('user_id', $target->id)->delete();
                }
                // Preserve foreign keys and transaction history; every normal
                // account/auth query excludes this removed account.
                $target->remember_token = null;
                $target->save();
                $target->delete();
                if ($target->role === 'admin' && ! $target->isSpectator()) $remaining--;
                $deleted[] = (int) $target->id;
            }

            return $deleted;
        }, 3);
    }
}
