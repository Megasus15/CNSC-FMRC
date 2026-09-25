<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Shared password-login state for the Customer and Admin/Staff portals.
 * Account rows survive browser closure, refreshes, and independent app workers.
 */
class LoginLockoutService
{
    private const IP_LIMIT = 120;

    private const UNKNOWN_IDLE_MINUTES = 60;

    /** An outer limit against credential spraying across many account names. */
    public function ipLimitResponse(string $ip): ?JsonResponse
    {
        return $this->rateLimitResponse(
            $ip, 'login-ip:', self::IP_LIMIT, 'LOGIN_RATE_LIMITED',
            'Too many sign-in requests. Please wait a moment and try again.'
        );
    }

    public function statusIpLimitResponse(string $ip): ?JsonResponse
    {
        return $this->rateLimitResponse(
            $ip, 'login-status-ip:', 120, 'LOGIN_STATUS_RATE_LIMITED',
            'Too many status requests. Please wait a moment and try again.'
        );
    }

    private function rateLimitResponse(string $ip, string $prefix, int $limit, string $code, string $message): ?JsonResponse
    {
        $key = $prefix.hash_hmac('sha256', $ip, (string) config('app.key'));
        $attempts = RateLimiter::hit($key, 60);

        if ($attempts <= $limit) {
            return null;
        }

        $seconds = max(1, RateLimiter::availableIn($key));

        return response()->json([
            'message' => $message,
            'code' => $code,
            'server_time' => now()->utc()->toIso8601String(),
            'retry_after' => $seconds,
        ], 429)->header('Retry-After', (string) $seconds);
    }

    /** Return the current lockout, if any, without incrementing its counter. */
    public function activeLockout(?User $user, string $identifier, string $ip): ?array
    {
        $row = DB::table('login_failure_states')
            ->where('scope_key', $this->scopeKey($user, $identifier, $ip))
            ->first();

        return $row ? $this->activeState($row) : null;
    }

    /**
     * Serialize counter changes under a database row lock. In MySQL, a burst of
     * requests cannot cross a ten-failure boundary without triggering its break.
     */
    public function recordFailure(?User $user, string $identifier, string $ip): ?array
    {
        $key = $this->scopeKey($user, $identifier, $ip);

        $active = DB::transaction(function () use ($user, $key) {
            $now = now();
            DB::table('login_failure_states')->insertOrIgnore([
                'scope_key' => $key,
                'user_id' => $user?->id,
                'failed_attempts' => 0,
                'lockout_count' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $row = DB::table('login_failure_states')->where('scope_key', $key)->lockForUpdate()->first();
            if ($active = $this->activeState($row)) {
                return $active; // A blocked submission does not count as another failure.
            }

            $reset = $this->needsReset($row, $user, $now);
            $failures = ($reset ? 0 : (int) $row->failed_attempts) + 1;
            $breaks = $reset ? 0 : (int) $row->lockout_count;
            $changes = [
                'failed_attempts' => $failures,
                'lockout_count' => $breaks,
                'locked_until' => null,
                'ticket_hash' => null,
                'ticket_ciphertext' => null,
                'last_failed_at' => $now,
                'updated_at' => $now,
            ];

            if ($failures % 10 === 0) {
                $breaks++;
                $seconds = $breaks > 10 ? 24 * 60 * 60 : min($breaks * 5, 25) * 60;
                $ticket = Str::random(64);
                $changes['lockout_count'] = $breaks;
                $changes['locked_until'] = $now->copy()->addSeconds($seconds);
                $changes['ticket_hash'] = hash('sha256', $ticket);
                $changes['ticket_ciphertext'] = Crypt::encryptString($ticket);
            }

            DB::table('login_failure_states')->where('id', $row->id)->update($changes);

            return isset($seconds)
                ? ['locked_until' => $changes['locked_until'], 'ticket' => $ticket]
                : null;
        });

        // Unknown names are intentionally short-lived. Sampled pruning keeps
        // credential-spraying traffic from growing this table indefinitely.
        if (! $user && random_int(1, 100) === 1) {
            DB::table('login_failure_states')
                ->whereNull('user_id')
                ->where('last_failed_at', '<', now()->subDays(2))
                ->delete();
        }

        return $active;
    }

    /**
     * Keep the account-state row locked through token creation. This prevents
     * a parallel bad attempt from locking the account between the final check
     * and minting the new session token.
     *
     * @param  callable(): string  $mintToken
     * @return string|array{locked_until: Carbon, ticket: string}
     */
    public function mintOnSuccess(User $user, callable $mintToken): string|array
    {
        return DB::transaction(function () use ($user, $mintToken) {
            $key = $this->scopeKey($user, '', '');
            $now = now();
            DB::table('login_failure_states')->insertOrIgnore([
                'scope_key' => $key,
                'user_id' => $user->id,
                'failed_attempts' => 0,
                'lockout_count' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $row = DB::table('login_failure_states')
                ->where('scope_key', $key)
                ->lockForUpdate()
                ->first();

            if ($active = $this->activeState($row)) {
                return $active;
            }

            $token = $mintToken();
            // Retain the row so a concurrent failed request waiting for this
            // lock always finds it after the transaction commits.
            DB::table('login_failure_states')->where('id', $row->id)->update([
                'failed_attempts' => 0,
                'lockout_count' => 0,
                'locked_until' => null,
                'ticket_hash' => null,
                'ticket_ciphertext' => null,
                'last_failed_at' => null,
                'updated_at' => now(),
            ]);

            return $token;
        });
    }

    /** A high-entropy ticket is the only lookup key; no account lookup is exposed. */
    public function ticketStatus(string $ticket): array
    {
        $row = DB::table('login_failure_states')
            ->where('ticket_hash', hash('sha256', $ticket))
            ->first();
        $active = $row ? $this->activeState($row) : null;

        return $active
            ? $this->statusPayload($active)
            : ['locked' => false, 'server_time' => now()->utc()->toIso8601String()];
    }

    public function lockedResponse(array $active): JsonResponse
    {
        $payload = $this->statusPayload($active);
        $minutes = (int) ceil($payload['retry_after'] / 60);
        $duration = $minutes > 60
            ? (int) ceil($minutes / 60).' hours'
            : $minutes.' '.($minutes === 1 ? 'minute' : 'minutes');

        return response()->json(array_merge($payload, [
            'message' => 'Too many unsuccessful sign-in attempts. Try again in '.$duration.'.',
            'code' => 'LOGIN_LOCKED',
            'ticket' => $active['ticket'],
        ]), 429)->header('Retry-After', (string) $payload['retry_after']);
    }

    private function statusPayload(array $active): array
    {
        $now = now()->utc();
        $deadline = $active['locked_until']->copy()->utc();

        return [
            'locked' => true,
            'locked_until' => $deadline->toIso8601String(),
            'server_time' => $now->toIso8601String(),
            'retry_after' => max(1, (int) ceil($now->diffInSeconds($deadline, false))),
        ];
    }

    private function activeState(object $row): ?array
    {
        if (! $row->locked_until) {
            return null;
        }

        $deadline = Carbon::parse($row->locked_until, 'UTC');
        if ($deadline->lessThanOrEqualTo(now())) {
            return null;
        }

        return [
            'locked_until' => $deadline,
            'ticket' => $row->ticket_ciphertext ? Crypt::decryptString($row->ticket_ciphertext) : '',
        ];
    }

    private function needsReset(object $row, ?User $user, Carbon $now): bool
    {
        if ((int) $row->lockout_count > 10 && $row->locked_until) {
            return Carbon::parse($row->locked_until, 'UTC')->lessThanOrEqualTo($now);
        }

        return ! $user && $row->last_failed_at
            && Carbon::parse($row->last_failed_at, 'UTC')->addMinutes(self::UNKNOWN_IDLE_MINUTES)->lessThanOrEqualTo($now);
    }

    private function scopeKey(?User $user, string $identifier, string $ip): string
    {
        $scope = $user
            ? 'account:'.$user->getKey()
            : 'unknown:'.mb_strtolower(trim($identifier)).'|'.$ip;

        return hash_hmac('sha256', $scope, (string) config('app.key'));
    }
}
