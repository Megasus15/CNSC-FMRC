<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class OperatorSessionPolicy
{
    public const DEFAULTS = ['enabled' => true, 'max_hours' => 6];

    public static function installed(): bool
    {
        return Schema::hasColumn('user_portal_preferences', 'session_policy')
            && Schema::hasColumn('personal_access_tokens', 'operator_session_max_hours');
    }

    public static function forUser(User $user): array
    {
        if (! self::installed()) {
            return self::DEFAULTS;
        }
        $stored = json_decode(DB::table('user_portal_preferences')->where('user_id', $user->id)->value('session_policy') ?? 'null', true);
        if (! is_array($stored) || ! is_bool($stored['enabled'] ?? null)
            || ! in_array($stored['max_hours'] ?? null, [6, 12], true)) {
            return self::DEFAULTS;
        }

        return array_intersect_key($stored, self::DEFAULTS);
    }

    public static function save(User $user, array $policy): void
    {
        $now = now();
        DB::table('user_portal_preferences')->upsert([[
            'user_id' => $user->id, 'session_policy' => json_encode($policy, JSON_THROW_ON_ERROR),
            'created_at' => $now, 'updated_at' => $now,
        ]], ['user_id'], ['session_policy', 'updated_at']);
    }
}
