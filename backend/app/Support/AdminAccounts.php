<?php

namespace App\Support;

use App\Models\User;
use App\Services\AppointmentProducts;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

final class AdminAccounts
{
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

    public static function deletionBlocker(User $target, User $actor, int $fullCount, ?array $retained = null): ?string
    {
        if ($actor->isSpectator()) return 'Presentation accounts are view only.';
        if ((int) $target->id === (int) $actor->id) return 'Your signed-in account cannot be deleted.';
        if ($target->role === 'admin' && ! $target->isSpectator() && $fullCount <= 1) return 'At least one full Admin account must remain.';

        return AppointmentProducts::accountDeletionBlocker($target, $retained);
    }

    public static function delete(User $actor, array $ids, bool $bulk = false): array
    {
        return DB::transaction(function () use ($actor, $ids, $bulk): array {
            $roster = self::lockRoster($actor);
            $remaining = self::fullCount($roster);
            $targets = User::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
            $deleted = [];
            foreach ($targets as $target) {
                if ($bulk && (int) $target->id === (int) $actor->id) continue;
                if ($reason = self::deletionBlocker($target, $actor, $remaining)) abort(422, $reason);
                $target->tokens()->delete();
                Pwa::revokeUser((int) $target->id);
                $target->delete();
                if ($target->role === 'admin' && ! $target->isSpectator()) $remaining--;
                $deleted[] = (int) $target->id;
            }

            return $deleted;
        }, 3);
    }
}
