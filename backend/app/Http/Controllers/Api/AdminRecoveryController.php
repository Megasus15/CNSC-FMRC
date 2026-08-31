<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\AdminRecoveryCodeAlert;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;

/**
 * One-time recovery codes for the admin account.
 *
 * The portal has exactly one admin and no UI to create a second, so if the
 * account's Gmail becomes unreachable the emailed OTP reset
 * (PasswordResetController) is the only way back in -- and it stops working.
 * A recovery code stands in for that OTP: holding one earns the right to set a
 * new password.
 *
 * That is a stronger key than GitHub's equivalent (theirs replaces a second
 * factor, so the password is still required), which is why every code here is
 * long, hashed, single-use, throttled, and its use is emailed as an alert.
 */
class AdminRecoveryController extends Controller
{
    private const TABLE = 'admin_recovery_codes';

    private const CODE_COUNT = 10;

    /** Ambiguous glyphs (0/1/I/L/O/U) are excluded so codes can be read off paper. */
    private const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const CODE_LENGTH = 10;

    private const MAX_REDEEM_ATTEMPTS = 5;

    private const REDEEM_DECAY_MINUTES = 30;

    /**
     * Wrong-password guesses per hour on generate(). A *successful* generate is
     * never counted, so the admin can issue a fresh set at any time -- including
     * the moment the tenth code is spent.
     */
    private const MAX_GENERATE_ATTEMPTS = 5;

    /**
     * Two codes in the same set must differ in at least this many of their 10
     * positions. Stops a set like "K7MPQ-R4TWX" / "K7MPQ-R4TWZ" from being issued,
     * which is the pair an admin reading off paper would transcribe wrongly.
     */
    private const MIN_DIFFERING_POSITIONS = 3;

    /** Safety valve so a pathological rejection streak can never loop forever. */
    private const MAX_GENERATION_TRIES = 2000;

    private ?bool $tableSupported = null;

    private ?bool $passwordStateSupported = null;

    /**
     * Current recovery-code state for the signed-in admin.
     *
     * Returns 200 with supported:false when the migration has not been run yet,
     * so the account page can say "not installed" instead of looking broken.
     * Plaintext codes are never returned here -- only counts.
     */
    public function status(Request $request): JsonResponse
    {
        if ($forbidden = $this->ensureAdmin($request)) {
            return $forbidden;
        }

        if (!$this->supported()) {
            return response()->json([
                'supported' => false,
                'total' => 0,
                'remaining' => 0,
                'generated_at' => null,
                'last_used_at' => null,
            ]);
        }

        $user = $request->user();
        $rows = DB::table(self::TABLE)->where('user_id', $user->id)->get(['used_at', 'created_at']);

        $remaining = $rows->whereNull('used_at')->count();
        $generatedAt = $rows->max('created_at');
        $lastUsedAt = $rows->whereNotNull('used_at')->max('used_at');

        return response()->json([
            'supported' => true,
            'total' => $rows->count(),
            'remaining' => $remaining,
            'generated_at' => $generatedAt ? Carbon::parse($generatedAt)->toIso8601String() : null,
            'last_used_at' => $lastUsedAt ? Carbon::parse($lastUsedAt)->toIso8601String() : null,
        ]);
    }

    /**
     * Issue a fresh set of codes. Every previous code -- used or not -- dies here,
     * exactly like GitHub's "generate new recovery codes".
     *
     * The plaintext is returned once and never again; only bcrypt hashes are kept.
     */
    public function generate(Request $request): JsonResponse
    {
        if ($forbidden = $this->ensureAdmin($request)) {
            return $forbidden;
        }

        if (!$this->supported()) {
            return response()->json([
                'supported' => false,
                'message' => 'Recovery codes are not installed on this server yet. Run the pending database migration first.',
            ], 422);
        }

        $request->validate([
            'current_password' => 'required|string',
        ], [
            'current_password.required' => 'Your current password is required to generate recovery codes.',
        ]);

        $user = $request->user();

        $throttleKey = 'admin-recovery-generate:' . $user->id;
        if (RateLimiter::tooManyAttempts($throttleKey, self::MAX_GENERATE_ATTEMPTS)) {
            return response()->json([
                'message' => 'Too many incorrect password attempts. Please try again later.',
                'retry_after_seconds' => RateLimiter::availableIn($throttleKey),
            ], 429);
        }

        if (!Hash::check($request->input('current_password'), $user->password)) {
            RateLimiter::hit($throttleKey, 3600);

            return response()->json(['message' => 'Current password does not match.'], 422);
        }

        // Only failures are throttled. Regenerating is deliberately unlimited: the
        // admin must be able to refill the set the instant the last code is used.
        RateLimiter::clear($throttleKey);

        $codes = $this->makeCodeSet();
        $rows = [];
        $now = now();

        foreach ($codes as $raw) {
            $rows[] = [
                'user_id' => $user->id,
                'code_hash' => Hash::make($raw),
                'used_at' => null,
                'used_ip' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        DB::transaction(function () use ($user, $rows) {
            DB::table(self::TABLE)->where('user_id', $user->id)->delete();
            DB::table(self::TABLE)->insert($rows);
        });

        Log::info("Admin recovery codes regenerated for user #{$user->id}");
        $this->sendAlertEmail($user, 'regenerated');

        return response()->json([
            'supported' => true,
            'message' => 'Save these codes now. They will not be shown again.',
            'codes' => array_map(fn (string $raw) => $this->formatCode($raw), $codes),
            'total' => self::CODE_COUNT,
            'remaining' => self::CODE_COUNT,
            'generated_at' => $now->toIso8601String(),
        ]);
    }

    /**
     * Public: trade one unused recovery code for a new password.
     *
     * This is the emailed-OTP replacement, so it deliberately mirrors
     * PasswordResetController::verifyOtpAndReset() -- set the password, then drop
     * every Sanctum token so any session opened with the old one dies too.
     */
    public function redeem(Request $request): JsonResponse
    {
        $request->validate([
            'login' => 'required|string',
            'recovery_code' => 'required|string|max:64',
            'new_password' => 'required|string|min:8|confirmed',
        ], [
            'new_password.min' => 'New password must be at least 8 characters.',
            'new_password.confirmed' => 'New password confirmation does not match.',
        ]);

        if (!$this->supported()) {
            return response()->json([
                'supported' => false,
                'message' => 'Recovery codes are not enabled on this server. Please use the Gmail code option instead.',
            ], 422);
        }

        $login = trim((string) $request->input('login'));

        // Throttle on IP + identifier together: one attacker cannot burn the
        // real admin's allowance, and one IP cannot grind through the keyspace.
        $throttleKey = 'admin-recovery-redeem:' . sha1($request->ip() . '|' . mb_strtolower($login));
        if (RateLimiter::tooManyAttempts($throttleKey, self::MAX_REDEEM_ATTEMPTS)) {
            return response()->json([
                'message' => 'Too many incorrect attempts. Please wait before trying again.',
                'retry_after_seconds' => RateLimiter::availableIn($throttleKey),
            ], 429);
        }

        // Same resolution rule as AuthController::login().
        $loginField = filter_var($login, FILTER_VALIDATE_EMAIL) ? 'email' : 'username';
        $user = User::where($loginField, $login)->first();

        // A non-existent account, a staff/customer account and a wrong code all
        // return the identical message, so this endpoint cannot be used to
        // discover the admin's username or confirm which accounts exist.
        if (!$user || $user->role !== 'admin') {
            RateLimiter::hit($throttleKey, self::REDEEM_DECAY_MINUTES * 60);

            return response()->json(['message' => $this->genericFailure()], 422);
        }

        $normalized = $this->normalizeCode((string) $request->input('recovery_code'));
        if (strlen($normalized) !== self::CODE_LENGTH) {
            RateLimiter::hit($throttleKey, self::REDEEM_DECAY_MINUTES * 60);

            return response()->json(['message' => $this->genericFailure()], 422);
        }

        $candidates = DB::table(self::TABLE)
            ->where('user_id', $user->id)
            ->whereNull('used_at')
            ->get(['id', 'code_hash']);

        $matchId = null;
        foreach ($candidates as $candidate) {
            if (Hash::check($normalized, $candidate->code_hash)) {
                $matchId = $candidate->id;
                break;
            }
        }

        if ($matchId === null) {
            RateLimiter::hit($throttleKey, self::REDEEM_DECAY_MINUTES * 60);
            Log::warning("Failed admin recovery-code attempt for user #{$user->id} from {$request->ip()}");

            return response()->json(['message' => $this->genericFailure()], 422);
        }

        $usedAt = now();
        $ip = substr((string) $request->ip(), 0, 45);

        DB::transaction(function () use ($matchId, $usedAt, $ip, $user, $request) {
            // Burn the code first. If anything below fails the code is still
            // spent, which is the safe direction to fail in.
            DB::table(self::TABLE)
                ->where('id', $matchId)
                ->whereNull('used_at')
                ->update(['used_at' => $usedAt, 'used_ip' => $ip, 'updated_at' => $usedAt]);

            $user->password = Hash::make($request->input('new_password'));
            if ($this->supportsPasswordState()) {
                $user->has_custom_password = true;
            }
            $user->save();

            $user->tokens()->delete();
        });

        RateLimiter::clear($throttleKey);

        $remaining = DB::table(self::TABLE)
            ->where('user_id', $user->id)
            ->whereNull('used_at')
            ->count();

        Log::info("Admin recovery code redeemed for user #{$user->id} from {$ip}; {$remaining} left");
        $this->sendAlertEmail($user, 'redeemed', $remaining, $ip);

        return response()->json([
            'message' => $remaining === 0
                ? 'Password updated. That was your last recovery code — sign in and generate a new set right away.'
                : 'Password updated. You can now sign in with your new password.',
            'remaining' => $remaining,
            'exhausted' => $remaining === 0,
        ]);
    }

    private function genericFailure(): string
    {
        return 'That recovery code is not valid, or it has already been used.';
    }

    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor || $actor->role !== 'admin') {
            return response()->json([
                'message' => 'Forbidden. Admin access is required.',
            ], 403);
        }

        return null;
    }

    /**
     * Fail soft before the migration is run by hand on the live server.
     */
    private function supported(): bool
    {
        return $this->tableSupported ??= Schema::hasTable(self::TABLE);
    }

    private function supportsPasswordState(): bool
    {
        return $this->passwordStateSupported ??= Schema::hasColumn('users', 'has_custom_password');
    }

    /**
     * Build one full set of 10 codes that cannot be confused with each other.
     *
     * Every code is drawn fresh from the CSPRNG on every generate, so no set is ever
     * a repeat of an earlier one. On top of plain uniqueness a candidate is thrown
     * away when it looks too much like one already accepted:
     *
     *  - identical first block  ("K7MPQ-xxxxx" twice)
     *  - identical second block ("xxxxx-R4TWX" twice)
     *  - fewer than 3 differing positions out of 10
     *  - three identical characters in a row, which is hard to count off paper
     *
     * @return list<string> 10 raw (undashed) codes
     */
    private function makeCodeSet(): array
    {
        $codes = [];
        $tries = 0;

        while (count($codes) < self::CODE_COUNT) {
            if (++$tries > self::MAX_GENERATION_TRIES) {
                // Unreachable in practice (30^10 keyspace, 10 picks). Falling back to
                // plain uniqueness is still safe -- only the readability rule relaxes.
                $candidate = $this->makeCode();
                if (!in_array($candidate, $codes, true)) {
                    $codes[] = $candidate;
                }
                continue;
            }

            $candidate = $this->makeCode();

            if (in_array($candidate, $codes, true) || $this->hasCharacterRun($candidate)) {
                continue;
            }

            if ($this->looksLikeAny($candidate, $codes)) {
                continue;
            }

            $codes[] = $candidate;
        }

        return $codes;
    }

    /** @param list<string> $accepted */
    private function looksLikeAny(string $candidate, array $accepted): bool
    {
        foreach ($accepted as $existing) {
            if (substr($candidate, 0, 5) === substr($existing, 0, 5)) {
                return true;
            }

            if (substr($candidate, 5, 5) === substr($existing, 5, 5)) {
                return true;
            }

            if ($this->differingPositions($candidate, $existing) < self::MIN_DIFFERING_POSITIONS) {
                return true;
            }
        }

        return false;
    }

    private function differingPositions(string $a, string $b): int
    {
        $length = min(strlen($a), strlen($b));
        $diff = abs(strlen($a) - strlen($b));

        for ($i = 0; $i < $length; $i++) {
            if ($a[$i] !== $b[$i]) {
                $diff++;
            }
        }

        return $diff;
    }

    private function hasCharacterRun(string $code, int $run = 3): bool
    {
        $streak = 1;

        for ($i = 1, $len = strlen($code); $i < $len; $i++) {
            $streak = $code[$i] === $code[$i - 1] ? $streak + 1 : 1;
            if ($streak >= $run) {
                return true;
            }
        }

        return false;
    }

    /**
     * CSPRNG-backed code: 10 symbols from a 30-symbol alphabet is ~49 bits.
     */
    private function makeCode(): string
    {
        $alphabet = self::CODE_ALPHABET;
        $max = strlen($alphabet) - 1;
        $code = '';

        for ($i = 0; $i < self::CODE_LENGTH; $i++) {
            $code .= $alphabet[random_int(0, $max)];
        }

        return $code;
    }

    /** Strip the display dash and case so the admin can type it either way. */
    private function normalizeCode(string $code): string
    {
        return preg_replace('/[^A-Z0-9]/', '', strtoupper(trim($code))) ?? '';
    }

    private function formatCode(string $raw): string
    {
        return substr($raw, 0, 5) . '-' . substr($raw, 5, 5);
    }

    /**
     * A recovery code can reset the password on its own, so its use is never
     * silent. Failure to send must not fail the request -- the password change has
     * already happened by the time this runs.
     */
    private function sendAlertEmail(
        User $user,
        string $event,
        ?int $remaining = null,
        ?string $ip = null,
    ): void {
        $address = $user->email;
        if (!$address || !filter_var($address, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        $mailable = new AdminRecoveryCodeAlert(
            user: $user,
            event: $event,
            remaining: $remaining,
            ip: $ip,
            occurredAt: now()->format('F j, Y \a\t g:i A'),
        );

        $userId = (string) $user->id;

        $this->dispatchAfterResponse(function () use ($address, $mailable, $userId, $event) {
            try {
                Mail::to($address)->send($mailable);
                Log::info("Admin recovery {$event} alert sent for user #{$userId}");
            } catch (\Throwable $e) {
                Log::error("Admin recovery {$event} alert FAILED for user #{$userId}: " . $e->getMessage());
            }
        });
    }

    /**
     * Same deferred-send trick as AuthController::dispatchAfterResponse() and
     * PasswordResetController::dispatchResetOtpEmail(): flush the response, then
     * talk to SMTP, so a slow mail server never stalls the caller.
     */
    private function dispatchAfterResponse(callable $callback): void
    {
        try {
            app()->terminating(function () use ($callback) {
                if (function_exists('fastcgi_finish_request')) {
                    @fastcgi_finish_request();
                }
                $callback();
            });
        } catch (\Throwable $e) {
            if (function_exists('fastcgi_finish_request')) {
                @fastcgi_finish_request();
            }
            $callback();
        }
    }
}
