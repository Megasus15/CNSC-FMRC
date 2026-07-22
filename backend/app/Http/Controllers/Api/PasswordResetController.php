<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class PasswordResetController extends Controller
{
    /**
     * How long (in minutes) a reset link stays valid.
     */
    private const TOKEN_EXPIRY_MINUTES = 60;

    /**
     * Step 1 — Customer requests a password reset link.
     * Always returns the same generic message so we never reveal
     * which emails are (or aren't) registered.
     */
    public function sendResetLink(Request $request)
    {
        $request->validate([
            'email' => 'required|string|email|max:255',
        ]);

        $email = strtolower(trim($request->email));
        $user = User::where('email', $email)->first();

        // Only generate a token + send an email if the account actually exists.
        if ($user) {
            $plainToken = Str::random(64);

            DB::table('password_reset_tokens')->updateOrInsert(
                ['email' => $user->email],
                [
                    'email'      => $user->email,
                    'token'      => Hash::make($plainToken),
                    'created_at' => now(),
                ]
            );

            // Point the reset link at the Laravel backend itself (always running,
            // since it just sent this email) instead of the Live Server frontend
            // which may be offline. This avoids "127.0.0.1 refused to connect".
            $backendUrl = rtrim((string) config('app.url', 'http://127.0.0.1:8000'), '/');
            $resetLink = $backendUrl
                . '/reset-password?token=' . $plainToken
                . '&email=' . urlencode($user->email);


            $this->dispatchResetEmail($user, $resetLink);
        }

        return response()->json([
            'message' => 'If an account matches that email, a password reset link has been sent.',
        ]);
    }

    /**
     * Step 2 — Customer submits a new password using the token from the email.
     */
    public function resetPassword(Request $request)
    {
        $request->validate([
            'email'    => 'required|string|email|max:255',
            'token'    => 'required|string',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $email = strtolower(trim($request->email));

        $record = DB::table('password_reset_tokens')->where('email', $email)->first();

        if (!$record || !Hash::check($request->token, $record->token)) {
            return response()->json([
                'message' => 'This password reset link is invalid. Please request a new one.',
            ], 422);
        }

        // Reject expired tokens.
        if (Carbon::parse($record->created_at)->addMinutes(self::TOKEN_EXPIRY_MINUTES)->isPast()) {
            DB::table('password_reset_tokens')->where('email', $email)->delete();

            return response()->json([
                'message' => 'This password reset link has expired. Please request a new one.',
            ], 422);
        }

        $user = User::where('email', $email)->first();

        if (!$user) {
            return response()->json([
                'message' => 'We could not find an account for this email address.',
            ], 422);
        }

        $user->password = Hash::make($request->password);
        $user->save();

        // Invalidate any existing login tokens for safety.
        $user->tokens()->delete();

        // The token can only be used once.
        DB::table('password_reset_tokens')->where('email', $email)->delete();

        return response()->json([
            'message' => 'Your password has been reset successfully. You can now log in with your new password.',
        ]);
    }

    /**
     * Serve the self-contained "Reset Password" web page directly from Laravel
     * (port 8000, always running) so the email link never hits a dead
     * Live Server address. Mirrors the AppointmentController::verifyPage pattern.
     */
    public function showResetForm(Request $request)
    {
        $token = (string) $request->query('token', '');
        $email = (string) $request->query('email', '');

        $html = $this->buildResetPageHtml($token, $email);

        return response($html)->header('Content-Type', 'text/html');
    }

    /**
     * Send the reset email after the response is returned so the
     * user is not kept waiting on the SMTP round-trip.
     */

    private function dispatchResetEmail(User $user, string $resetLink): void
    {
        $emailAddress = $user->email;
        if (!$emailAddress || !filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        $emailHtml   = $this->buildResetEmailHtml($user, $resetLink);
        $userId      = (string) $user->id;
        $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
        $fromName    = config('mail.from.name', 'UCN-FMRC');

        $callback = function () use ($emailAddress, $emailHtml, $userId, $fromAddress, $fromName) {
            try {
                Mail::html($emailHtml, function ($message) use ($emailAddress, $fromAddress, $fromName) {
                    $message->to($emailAddress)
                        ->subject('Reset Your UCN-FMRC Password')
                        ->from($fromAddress, $fromName);
                });
                Log::info("Password reset email sent to {$emailAddress} for user #{$userId}");
            } catch (\Throwable $e) {
                Log::error("Password reset email FAILED for user #{$userId}: " . $e->getMessage());
            }
        };

        try {
            app()->terminating($callback);
        } catch (\Throwable $e) {
            $callback();
        }
    }

    private function buildResetEmailHtml(User $user, string $resetLink): string
    {
        $name    = e($user->name ?? 'Valued Customer');
        $link    = e($resetLink);
        $minutes = self::TOKEN_EXPIRY_MINUTES;
        $appName = config('app.name') ?: 'UCN-FMRC';
        if (strtolower($appName) === 'laravel') {
            $appName = 'UCN-FMRC';
        }
        $year   = now()->year;
        $accent = '#800000';

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:{$accent};padding:28px 32px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">UCN-FMRC</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Customer Portal &middot; Password Reset Request</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
    <h2 style="margin:0 0 12px;color:#1f2937;font-size:20px;font-weight:700;">Reset your password, {$name}</h2>
    <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
        We received a request to reset the password for your UCN-FMRC Customer Portal account.
        Click the button below to choose a new password.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td align="center">
        <a href="{$link}" style="display:inline-block;background:{$accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;">
          Reset My Password
        </a>
      </td></tr>
    </table>

    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.6;">
        Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 20px;word-break:break-all;">
        <a href="{$link}" style="color:#800000;font-size:13px;">{$link}</a>
    </p>

    <p style="margin:0 0 20px;padding:12px 16px;background:#fef3c7;border-left:4px solid #d97706;border-radius:6px;color:#92400e;font-size:13px;line-height:1.6;">
        <strong>Note:</strong> This link will expire in {$minutes} minutes and can only be used once.
    </p>

    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
        If you did not request a password reset, you can safely ignore this email &mdash; your password will remain unchanged.
    </p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">
    &copy; {$year} {$appName}. All rights reserved.<br>
    This is an automated notification &mdash; please do not reply to this email.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }

    /**
     * Build the self-contained reset-password web page (inline CSS + JS,
     * no external files) served from Laravel. Styled to match the customer
     * auth page. The embedded JS posts to /api/reset-password on the same
     * origin, so there are no CORS or "connection refused" problems.
     */
    private function buildResetPageHtml(string $token, string $email): string
    {
        // JSON-encode for safe embedding inside the inline <script>.
        $tokenJs = json_encode($token, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);
        $emailJs = json_encode($email, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);
        $emailDisplay = e($email !== '' ? $email : 'your account');
        $apiBase = rtrim((string) config('app.url', 'http://127.0.0.1:8000'), '/');
        $apiBaseJs = json_encode($apiBase . '/api/reset-password', JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);
        $year = now()->year;

        return <<<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UCN-FMRC Reset Password</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>

  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;font-family:'Montserrat','Segoe UI',Tahoma,Arial,sans-serif;color:#2d3748;background:#f4f7f6;background-image:radial-gradient(#e2e8f0 1px,transparent 1px);background-size:30px 30px;display:flex;justify-content:center;align-items:center;padding:30px 16px}
  .card{width:100%;max-width:440px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:0 32px 40px;position:relative;overflow:hidden}
  .accent{position:absolute;top:0;left:0;width:100%;height:6px;background:#9e1414}
  .hero{text-align:center;margin:48px 0 24px}
  .title{font-size:26px;color:#9e1414;font-weight:800;letter-spacing:-.5px}
  .caption{font-size:13px;color:#718096;margin-top:4px;font-weight:500}
  .desc{font-size:14px;color:#718096;line-height:1.5;text-align:center;margin-bottom:20px}
  .desc strong{color:#2d3748}
  label{display:block;font-size:13px;color:#2d3748;font-weight:600;margin-bottom:8px}
  .field{margin-bottom:18px}
  .input-row{position:relative;display:flex;align-items:center}
  input{width:100%;border:1px solid #e2e8f0;background:#fafbfc;border-radius:8px;padding:12px 44px 12px 14px;font-size:14px;color:#2d3748;font-family:inherit;transition:all .2s}
  input:focus{outline:none;border-color:#9e1414;background:#fff;box-shadow:0 0 0 3px rgba(158,20,20,.1)}
  .toggle{position:absolute;right:12px;border:none;background:transparent;color:#a0aec0;cursor:pointer;font-size:12px;font-weight:700;padding:6px 8px}
  .toggle:hover{color:#9e1414}
  .btn{width:100%;background:#9e1414;color:#fff;border:none;border-radius:8px;padding:14px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;transition:background-color .2s ease,transform .1s ease;box-shadow:0 6px 15px rgba(0,0,0,.16)}
  .btn:hover{background:#7a0f0f}
  .btn:active{transform:scale(.97)}
  .btn:disabled{opacity:.7;cursor:not-allowed}
  .err{color:#d32f2f;font-size:12px;font-weight:600;margin-top:6px;display:none}
  .field.has-error input{border-color:#d32f2f;box-shadow:0 0 0 3px rgba(211,47,47,.14);background:#fffafa}
  .field.has-error .err{display:block}
  .link-wrap{text-align:center;margin-top:20px}
  .link{color:#9e1414;text-decoration:none;font-weight:700;font-size:13px}
  .link:hover{text-decoration:underline}
  .foot{margin-top:24px;text-align:center;font-size:11px;color:#a0aec0}
  .ok-icon{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:#e6f4ea;color:#34a853;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800}
  .warn-icon{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:rgba(158,20,20,.1);color:#9e1414;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800}
  .center{text-align:center}
  h2.state{font-size:22px;color:#2d3748;margin-bottom:8px}
  p.state{color:#718096;font-size:14px;line-height:1.5;margin-bottom:24px}
  .hidden{display:none}
</style>
</head>
<body>
  <div class="card">
    <div class="accent"></div>

    <!-- Reset form -->
    <div id="formView">
      <div class="hero">
        <div class="title">Reset Password</div>
        <div class="caption">UCN-FMRC Customer Portal</div>
      </div>
      <p class="desc">Enter a new password for <strong>{$emailDisplay}</strong>.</p>
      <form id="resetForm" novalidate>
        <div class="field" id="passField">
          <label for="pass">New Password</label>
          <div class="input-row">
            <input id="pass" type="password" placeholder="Create a new password" autocomplete="new-password">
            <button class="toggle" type="button" data-target="pass">Show</button>
          </div>
          <div class="err" id="passErr"></div>
        </div>
        <div class="field" id="confirmField">
          <label for="confirm">Confirm New Password</label>
          <div class="input-row">
            <input id="confirm" type="password" placeholder="Confirm your new password" autocomplete="new-password">
            <button class="toggle" type="button" data-target="confirm">Show</button>
          </div>
          <div class="err" id="confirmErr"></div>
        </div>
        <button class="btn" type="submit" id="submitBtn">Reset Password</button>
      </form>
    </div>

    <!-- Success view -->
    <div id="successView" class="hidden center">
      <div class="hero"><div class="ok-icon">&#10003;</div></div>
      <h2 class="state">Password Reset</h2>
      <p class="state">Your password has been reset successfully. You can now log in with your new password.</p>
    </div>

    <!-- Invalid link view -->
    <div id="invalidView" class="hidden center">
      <div class="hero"><div class="warn-icon">!</div></div>
      <h2 class="state">Invalid or Expired Link</h2>
      <p class="state" id="invalidMsg">This password reset link is invalid or has expired. Please request a new one from the login page.</p>
    </div>

    <div class="foot">&copy; {$year} UCN-FMRC. All rights reserved.</div>
  </div>

<script>
  (function () {
    var TOKEN = {$tokenJs};
    var EMAIL = {$emailJs};
    var API_URL = {$apiBaseJs};

    var formView = document.getElementById('formView');
    var successView = document.getElementById('successView');
    var invalidView = document.getElementById('invalidView');

    // No token/email in the URL -> invalid link view.
    if (!TOKEN || !EMAIL) {
      formView.classList.add('hidden');
      invalidView.classList.remove('hidden');
      return;
    }

    var form = document.getElementById('resetForm');
    var pass = document.getElementById('pass');
    var confirm = document.getElementById('confirm');
    var submitBtn = document.getElementById('submitBtn');

    function setErr(fieldId, errId, msg) {
      document.getElementById(fieldId).classList.add('has-error');
      var el = document.getElementById(errId);
      el.textContent = msg;
    }
    function clearErr(fieldId) {
      document.getElementById(fieldId).classList.remove('has-error');
    }

    document.querySelectorAll('.toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.getAttribute('data-target'));
        if (!input) return;
        var isPw = input.type === 'password';
        input.type = isPw ? 'text' : 'password';
        btn.textContent = isPw ? 'Hide' : 'Show';
      });
    });

    pass.addEventListener('input', function () { if (pass.value.trim()) clearErr('passField'); });
    confirm.addEventListener('input', function () { if (confirm.value.trim()) clearErr('confirmField'); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErr('passField');
      clearErr('confirmField');

      var p = pass.value;
      var c = confirm.value;
      var hasError = false;

      if (!p) { setErr('passField', 'passErr', 'Password is required.'); hasError = true; }
      else if (p.length < 8) { setErr('passField', 'passErr', 'Password must be at least 8 characters.'); hasError = true; }
      else if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) { setErr('passField', 'passErr', 'Password must include at least one letter and one number.'); hasError = true; }

      if (!c) { setErr('confirmField', 'confirmErr', 'Please confirm your password.'); hasError = true; }
      else if (p !== c) { setErr('confirmField', 'confirmErr', 'Confirm password does not match.'); hasError = true; }

      if (hasError) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Resetting...';

      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: EMAIL, token: TOKEN, password: p, password_confirmation: c })
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
        })
        .then(function (r) {
          if (r.ok) {
            formView.classList.add('hidden');
            successView.classList.remove('hidden');
            return;
          }
          if (r.status === 422) {
            if (r.data.errors && r.data.errors.password && r.data.errors.password[0]) {
              setErr('passField', 'passErr', r.data.errors.password[0]);
            } else {
              // Invalid / expired token -> show invalid view.
              formView.classList.add('hidden');
              document.getElementById('invalidMsg').textContent = r.data.message || 'This reset link is invalid or has expired. Please request a new one from the login page.';
              invalidView.classList.remove('hidden');
            }
          } else {
            setErr('passField', 'passErr', (r.data && r.data.message) || 'Unable to reset password. Please try again.');
          }
        })
        .catch(function () {
          setErr('passField', 'passErr', 'Something went wrong. Please try again.');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Reset Password';
        });
    });
  })();
</script>
</body>
</html>
HTML;
    }
}


