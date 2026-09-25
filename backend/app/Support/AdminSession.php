<?php

namespace App\Support;

use App\Models\User;
use Carbon\CarbonImmutable;
use Laravel\Sanctum\PersonalAccessToken;

class AdminSession
{
    public const IDLE_WARNING_MINUTES = 60;

    public const IDLE_EXPIRY_MINUTES = 63;

    public const ABSOLUTE_EXPIRY_HOURS = 6;

    public static function isOperator(?User $user): bool
    {
        return $user && in_array($user->role, ['admin', 'staff'], true);
    }

    /**
     * @return array{server_time: string, idle_warning_at: string, idle_expires_at: string, absolute_expires_at: string}
     */
    public static function status(PersonalAccessToken $token): array
    {
        $now = CarbonImmutable::now('UTC');
        $createdAt = CarbonImmutable::instance($token->created_at)->utc();
        $lastInteraction = $token->last_interaction_at
            ? CarbonImmutable::parse($token->last_interaction_at)->utc()
            : $createdAt;
        $absoluteExpiry = $createdAt->addHours(self::ABSOLUTE_EXPIRY_HOURS);

        // A token explicitly issued with an earlier deadline must keep it.
        if ($token->expires_at) {
            $absoluteExpiry = $absoluteExpiry->min(CarbonImmutable::instance($token->expires_at)->utc());
        }

        return [
            'server_time' => $now->toIso8601String(),
            'idle_warning_at' => $lastInteraction->addMinutes(self::IDLE_WARNING_MINUTES)->toIso8601String(),
            'idle_expires_at' => $lastInteraction->addMinutes(self::IDLE_EXPIRY_MINUTES)->toIso8601String(),
            'absolute_expires_at' => $absoluteExpiry->toIso8601String(),
        ];
    }

    public static function expirationCode(PersonalAccessToken $token): ?string
    {
        $status = self::status($token);
        $now = CarbonImmutable::parse($status['server_time']);

        if ($now->greaterThanOrEqualTo(CarbonImmutable::parse($status['absolute_expires_at']))) {
            return 'SESSION_EXPIRED';
        }

        if ($now->greaterThanOrEqualTo(CarbonImmutable::parse($status['idle_expires_at']))) {
            return 'SESSION_IDLE';
        }

        return null;
    }

    public static function expiredResponse(string $code): \Illuminate\Http\JsonResponse
    {
        $message = $code === 'SESSION_EXPIRED'
            ? 'Your session has expired. Please sign in again.'
            : 'Your session ended after inactivity. Please sign in again.';

        return response()->json(['message' => $message, 'code' => $code], 401)
            ->header('Cache-Control', 'no-store');
    }
}
