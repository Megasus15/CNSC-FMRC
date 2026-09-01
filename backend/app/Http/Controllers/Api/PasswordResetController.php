<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\EmailTemplate;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

class PasswordResetController extends Controller
{
    /**
     * How long (in minutes) a 6-digit OTP stays valid.
     */
    private const OTP_EXPIRY_MINUTES = 15;

    /**
     * Maximum OTP sends allowed before lockout.
     */
    private const MAX_SEND_LIMIT = 5;

    /**
     * Maximum invalid OTP entry attempts before invalidating the code.
     */
    private const MAX_VERIFY_ATTEMPTS = 5;

    public function __construct()
    {
        $this->ensureTable();
    }

    /**
     * Auto-ensure the password_reset_otps table exists across all environments.
     */
    private function ensureTable(): void
    {
        try {
            if (!Schema::hasTable('password_reset_otps')) {
                Schema::create('password_reset_otps', function (Blueprint $table) {
                    $table->id();
                    $table->string('email')->unique();
                    $table->string('otp')->nullable();
                    $table->integer('attempts')->default(0);
                    $table->integer('send_count')->default(0);
                    $table->integer('tier')->default(1);
                    $table->timestamp('locked_until')->nullable();
                    $table->timestamp('expires_at')->nullable();
                    $table->timestamps();
                });
            }
        } catch (\Throwable $e) {
            Log::warning('ensureTable exception: ' . $e->getMessage());
        }
    }

    /**
     * Progressive lockout durations in minutes.
     * Tier 1: 10 mins
     * Tier 2: 20 mins
     * Tier 3: 30 mins
     * Tier 4: 6 hours (360 mins)
     * Tier 5: 12 hours (720 mins)
     * Tier 6: 24 hours / 1 day (1440 mins)
     */
    private function getTierLockoutMinutes(int $tier): int
    {
        return match ($tier) {
            1 => 10,
            2 => 20,
            3 => 30,
            4 => 360,
            5 => 720,
            default => 1440,
        };
    }

    private function formatSecondsReadable(int $totalSeconds): string
    {
        if ($totalSeconds < 60) {
            return "{$totalSeconds} second" . ($totalSeconds === 1 ? '' : 's');
        }

        $hours = floor($totalSeconds / 3600);
        $minutes = floor(($totalSeconds % 3600) / 60);
        $seconds = $totalSeconds % 60;

        $parts = [];
        if ($hours > 0) {
            $parts[] = "{$hours} hr" . ($hours == 1 ? '' : 's');
        }
        if ($minutes > 0) {
            $parts[] = "{$minutes} min" . ($minutes == 1 ? '' : 's');
        }
        if ($seconds > 0 && $hours == 0) {
            $parts[] = "{$seconds} sec" . ($seconds == 1 ? '' : 's');
        }

        return implode(' ', $parts) ?: 'a few seconds';
    }

    private function formatDurationReadable(int $minutes): string
    {
        if ($minutes < 60) {
            return "{$minutes} minutes";
        }
        $hours = floor($minutes / 60);
        if ($hours >= 24) {
            return "1 day (24 hours)";
        }
        return "{$hours} hours";
    }

    /**
     * Step 1 / Resend — Send 6-digit OTP to Customer's Gmail with progressive rate-limiting.
     */
    public function sendOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|string|email|max:255',
        ], [
            'email.required' => 'Please enter your Gmail address.',
            'email.email' => 'Please enter a valid Gmail address.',
        ]);

        $email = strtolower(trim($request->email));
        $user = User::where('email', $email)->first();

        $portal = strtolower(trim((string) $request->input('portal', '')));

        if ($portal === 'admin_staff' || $portal === 'admin' || $portal === 'staff') {
            if (!$user) {
                return response()->json([
                    'message' => 'We could not find an Admin or Staff account registered with that email address.',
                ], 404);
            }
            if ($user->role === 'customer') {
                return response()->json([
                    'message' => 'This email belongs to a customer account. Please use the Customer portal to reset your password.',
                ], 403);
            }
            if (!in_array($user->role, ['admin', 'staff'])) {
                return response()->json([
                    'message' => 'Unauthorized account type.',
                ], 403);
            }
        } else {
            // Customer portal flow (default)
            if (!$user) {
                return response()->json([
                    'message' => 'We could not find a customer account registered with that email address.',
                ], 404);
            }
            if ($user->role !== 'customer') {
                return response()->json([
                    'message' => 'This email belongs to an Admin or Staff account. Please use the Admin/Staff portal to reset your password.',
                ], 403);
            }
        }

        $this->ensureTable();
        $record = DB::table('password_reset_otps')->where('email', $email)->first();

        $now = Carbon::now();

        // 1. Check if currently locked out
        if ($record && !empty($record->locked_until)) {
            $lockedUntil = Carbon::parse($record->locked_until);
            if ($lockedUntil->isFuture()) {
                $remainingSeconds = $now->diffInSeconds($lockedUntil);
                $readable = $this->formatSecondsReadable($remainingSeconds);

                return response()->json([
                    'message' => "You have exhausted the 5 OTP limit for this Gmail. Please wait {$readable} before requesting another OTP.",
                    'locked' => true,
                    'remaining_seconds' => $remainingSeconds,
                    'tier' => (int) $record->tier,
                ], 429);
            }
        }

        // 2. Determine current tier and cycle status
        $tier = $record ? (int) $record->tier : 1;
        $sendCount = $record ? (int) $record->send_count : 0;

        // If previous lockout expired, start a new 5-attempt cycle and advance tier for next exhaustion
        if ($record && !empty($record->locked_until) && Carbon::parse($record->locked_until)->isPast()) {
            $tier = min($tier + 1, 6);
            $sendCount = 0;
        }

        // Check if user already hit 5 sends in this active batch
        if ($sendCount >= self::MAX_SEND_LIMIT) {
            $lockoutMinutes = $this->getTierLockoutMinutes($tier);
            $lockedUntil = $now->copy()->addMinutes($lockoutMinutes);

            DB::table('password_reset_otps')->updateOrInsert(
                ['email' => $email],
                [
                    'send_count' => self::MAX_SEND_LIMIT,
                    'tier' => $tier,
                    'locked_until' => $lockedUntil,
                    'updated_at' => $now,
                ]
            );

            $remainingSeconds = $now->diffInSeconds($lockedUntil);
            $readable = $this->formatSecondsReadable($remainingSeconds);

            return response()->json([
                'message' => "You have reached the limit of 5 OTP requests. Please wait {$readable} before requesting another OTP.",
                'locked' => true,
                'remaining_seconds' => $remainingSeconds,
                'tier' => $tier,
            ], 429);
        }

        // 3. Increment send count
        $newSendCount = $sendCount + 1;
        $lockedUntil = null;

        // If this is the 5th send, apply lockout
        if ($newSendCount >= self::MAX_SEND_LIMIT) {
            $lockoutMinutes = $this->getTierLockoutMinutes($tier);
            $lockedUntil = $now->copy()->addMinutes($lockoutMinutes);
        }

        // 4. Generate 6-digit numeric OTP
        $otpCode = sprintf('%06d', random_int(100000, 999999));
        $expiresAt = $now->copy()->addMinutes(self::OTP_EXPIRY_MINUTES);

        DB::table('password_reset_otps')->updateOrInsert(
            ['email' => $email],
            [
                'otp' => Hash::make($otpCode),
                'attempts' => 0,
                'send_count' => $newSendCount,
                'tier' => $tier,
                'locked_until' => $lockedUntil,
                'expires_at' => $expiresAt,
                'updated_at' => $now,
            ]
        );

        // 5. Send OTP email in background
        $this->dispatchResetOtpEmail($user, $otpCode, $newSendCount, $tier, $lockedUntil);

        $remainingSends = max(0, self::MAX_SEND_LIMIT - $newSendCount);
        $lockoutReadable = $this->formatDurationReadable($this->getTierLockoutMinutes($tier));

        $notice = $remainingSends > 0
            ? "You have {$remainingSends} OTP request" . ($remainingSends === 1 ? '' : 's') . " remaining in this cycle."
            : "You have reached the 5/5 limit. Next request will require a {$lockoutReadable} cooldown.";

        return response()->json([
            'message' => 'A 6-digit OTP code has been sent to your Gmail address.',
            'email' => $email,
            'send_count' => $newSendCount,
            'remaining_sends' => $remainingSends,
            'is_last_attempt' => ($newSendCount >= self::MAX_SEND_LIMIT),
            'tier' => $tier,
            'notice' => $notice,
            'expires_in_minutes' => self::OTP_EXPIRY_MINUTES,
        ]);
    }

    /**
     * Resend OTP wrapper.
     */
    public function resendOtp(Request $request)
    {
        return $this->sendOtp($request);
    }

    /**
     * Check if a specific email is currently in lockout cooldown.
     */
    public function checkLockout(Request $request)
    {
        $request->validate([
            'email' => 'required|string|email|max:255',
        ]);

        $email = strtolower(trim($request->email));
        $record = DB::table('password_reset_otps')->where('email', $email)->first();

        if ($record && !empty($record->locked_until)) {
            $lockedUntil = Carbon::parse($record->locked_until);
            if ($lockedUntil->isFuture()) {
                $remainingSeconds = Carbon::now()->diffInSeconds($lockedUntil);
                return response()->json([
                    'locked' => true,
                    'remaining_seconds' => $remainingSeconds,
                    'tier' => (int) $record->tier,
                    'message' => "This Gmail is in cooldown. Please wait " . $this->formatSecondsReadable($remainingSeconds) . ".",
                ]);
            }
        }

        return response()->json([
            'locked' => false,
            'send_count' => $record ? (int) $record->send_count : 0,
            'remaining_sends' => $record ? max(0, self::MAX_SEND_LIMIT - (int) $record->send_count) : self::MAX_SEND_LIMIT,
            'tier' => $record ? (int) $record->tier : 1,
        ]);
    }

    /**
     * Step 2 — Verify 6-digit OTP and reset password.
     */
    public function verifyOtpAndReset(Request $request)
    {
        $request->validate([
            'email' => 'required|string|email|max:255',
            'otp' => 'required|string|size:6',
            'password' => 'required|string|min:8|confirmed',
        ], [
            'otp.required' => 'Please enter the 6-digit OTP code.',
            'otp.size' => 'The OTP code must be exactly 6 digits.',
            'password.min' => 'Your new password must be at least 8 characters.',
            'password.confirmed' => 'Password confirmation does not match.',
        ]);

        $email = strtolower(trim($request->email));
        $record = DB::table('password_reset_otps')->where('email', $email)->first();

        if (!$record || empty($record->otp)) {
            return response()->json([
                'message' => 'No active OTP request found for this email. Please request a new code.',
            ], 422);
        }

        // Check if expired
        if (Carbon::parse($record->expires_at)->isPast()) {
            return response()->json([
                'message' => 'This 6-digit OTP code has expired. Please request a new code.',
            ], 422);
        }

        // Check brute-force attempts
        if ((int) $record->attempts >= self::MAX_VERIFY_ATTEMPTS) {
            DB::table('password_reset_otps')->where('email', $email)->update([
                'otp' => null,
                'updated_at' => now(),
            ]);

            return response()->json([
                'message' => 'Too many failed verification attempts. Please request a new OTP code.',
            ], 422);
        }

        // Verify OTP hash
        if (!Hash::check($request->otp, $record->otp)) {
            $newAttempts = (int) $record->attempts + 1;
            DB::table('password_reset_otps')->where('email', $email)->update([
                'attempts' => $newAttempts,
                'updated_at' => now(),
            ]);

            $attemptsLeft = max(0, self::MAX_VERIFY_ATTEMPTS - $newAttempts);
            return response()->json([
                'message' => $attemptsLeft > 0
                    ? "Invalid 6-digit OTP code. You have {$attemptsLeft} attempt" . ($attemptsLeft === 1 ? '' : 's') . " remaining."
                    : "Too many failed attempts. Please request a new OTP code.",
            ], 422);
        }

        $user = User::where('email', $email)->first();
        $portal = strtolower(trim((string) $request->input('portal', '')));

        if ($portal === 'admin_staff' || $portal === 'admin' || $portal === 'staff') {
            if (!$user) {
                return response()->json(['message' => 'We could not find an Admin or Staff account registered with that email address.'], 404);
            }
            if ($user->role === 'customer') {
                return response()->json(['message' => 'This email belongs to a customer account. Please use the Customer portal to reset your password.'], 403);
            }
        } else {
            if (!$user) {
                return response()->json(['message' => 'We could not find a customer account registered with that email address.'], 404);
            }
            if ($user->role !== 'customer') {
                return response()->json(['message' => 'This email belongs to an Admin or Staff account. Please use the Admin/Staff portal to reset your password.'], 403);
            }
        }

        // Update password & invalidate old session tokens
        $user->password = Hash::make($request->password);
        if (Schema::hasColumn('users', 'has_custom_password')) {
            $user->has_custom_password = true;
        }
        $user->save();
        $user->tokens()->delete();

        // Clear OTP record and reset lockout on successful completion
        DB::table('password_reset_otps')->where('email', $email)->delete();

        return response()->json([
            'message' => 'Your password has been reset successfully! You can now log in with your new password.',
        ]);
    }

    /**
     * Backward-compatible methods.
     */
    public function sendResetLink(Request $request)
    {
        return $this->sendOtp($request);
    }

    public function resetPassword(Request $request)
    {
        if ($request->has('otp')) {
            return $this->verifyOtpAndReset($request);
        }
        return response()->json(['message' => 'Please provide the 6-digit OTP code.'], 422);
    }

    /**
     * Dispatch OTP Email in the background.
     */
    private function dispatchResetOtpEmail(User $user, string $otpCode, int $sendCount, int $tier, ?Carbon $lockedUntil): void
    {
        $emailAddress = $user->email;
        if (!$emailAddress || !filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        $emailHtml = $this->buildOtpEmailHtml($user, $otpCode, $sendCount, $tier, $lockedUntil);
        $userId = (string) $user->id;
        $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
        $fromName = config('mail.from.name', 'UCN-FMRC');

        $callback = function () use ($emailAddress, $emailHtml, $userId, $fromAddress, $fromName) {
            try {
                Mail::html($emailHtml, function ($message) use ($emailAddress, $fromAddress, $fromName) {
                    $message->to($emailAddress)
                        ->subject('Your 6-Digit Password Reset OTP Code')
                        ->from($fromAddress, $fromName);
                });
                Log::info("Password reset OTP email sent to {$emailAddress} for user #{$userId}");
            } catch (\Throwable $e) {
                Log::error("Password reset OTP email FAILED for user #{$userId}: " . $e->getMessage());
            }
        };

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

    /**
     * Password-reset OTP email. The header, body copy, footer note and header
     * colour come from the admin-editable `password_reset_otp` template; the
     * OTP box, the lockout warning and the instruction line are code-owned so
     * an edit can never send an OTP email without the OTP in it.
     */
    private function buildOtpEmailHtml(User $user, string $otpCode, int $sendCount, int $tier, ?Carbon $lockedUntil): string
    {
        $formattedOtp = e(implode(' ', str_split($otpCode)));

        $lockoutWarningHtml = '';
        if ($sendCount >= self::MAX_SEND_LIMIT && $lockedUntil) {
            $durationReadable = e($this->formatDurationReadable($this->getTierLockoutMinutes($tier)));
            $lockoutWarningHtml = <<<HTML

            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:20px 0 10px;text-align:left;">
                <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                    ⚠️ <strong>Notice:</strong> You have reached your 5/5 OTP request limit for this cycle. If you require another code later, a <strong>{$durationReadable}</strong> security cooldown will apply.
                </p>
            </div>
HTML;
        }

        $extra = <<<HTML
<!-- OTP Code Box -->
            <div style="background:#fdf2f2;border:2px dashed #dc2626;border-radius:12px;padding:24px 16px;text-align:center;margin:0 0 24px;">
                <span style="display:block;font-size:12px;font-weight:700;color:#991b1b;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">YOUR 6-DIGIT OTP CODE</span>
                <span style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:800;color:#800000;letter-spacing:8px;display:inline-block;padding:4px 12px;background:#ffffff;border-radius:8px;border:1px solid #fecaca;">{$formattedOtp}</span>
                <span style="display:block;font-size:13px;color:#6b7280;margin-top:12px;">Valid for <strong>15 minutes</strong></span>
            </div>{$lockoutWarningHtml}
            <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px;">
                Enter this code in the password reset form along with your new password to complete the update.
            </p>
HTML;

        return EmailTemplate::render('password_reset_otp', [
            'customer_name' => $user->name ?? 'Valued Customer',
            'otp_code'      => $formattedOtp,
        ], $extra);
    }
}
