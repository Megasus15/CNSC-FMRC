<?php

namespace App\Mail;

use App\Models\User;
use App\Support\Branding;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Security alert sent whenever an admin recovery code is used or the whole set is
 * regenerated. A recovery code can reset the password on its own, so its use must
 * never be silent -- this email is how a stolen code gets noticed.
 *
 * Sent synchronously (no ShouldQueue) like the other mailables here; the caller
 * defers it past the response instead of using a queue worker.
 */
class AdminRecoveryCodeAlert extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User $user,
        public readonly string $event,
        public readonly ?int $remaining = null,
        public readonly ?string $ip = null,
        public readonly ?string $occurredAt = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->event === 'redeemed'
                ? 'Security alert: a recovery code was used on your account'
                : 'Security alert: your recovery codes were replaced',
        );
    }

    public function content(): Content
    {
        return new Content(htmlString: $this->buildHtml());
    }

    private function buildHtml(): string
    {
        $accent = '#800000';
        $appName = Branding::NAME;
        $year = now()->year;
        $name = e($this->user->name ?: 'Administrator');
        $when = e($this->occurredAt ?: now()->format('F j, Y \a\t g:i A'));
        $ip = e($this->ip ?: 'unknown');

        if ($this->event === 'redeemed') {
            $headline = 'A recovery code was used to reset your password';
            $lead = 'Someone signed in to the admin recovery page and used one of your one-time '
                . 'recovery codes to set a new password. That code has now been used up and '
                . 'cannot be used again.';
            $detailRows = <<<ROWS
    <tr><td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">When</span><br>
      <span style="color:#111827;font-size:15px;font-weight:700;">{$when}</span>
    </td></tr>
    <tr><td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">IP Address</span><br>
      <span style="color:#374151;font-size:14px;font-weight:600;">{$ip}</span>
    </td></tr>
    <tr><td style="padding:10px 20px;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Codes Remaining</span><br>
      <span style="color:{$accent};font-size:18px;font-weight:800;">{$this->remaining} of 10</span>
    </td></tr>
ROWS;
            $action = 'If this was not you, sign in immediately, change your password, and '
                . 'generate a new set of recovery codes from <strong>My Account</strong>. '
                . 'Generating a new set instantly cancels every remaining old code.';

            if ($this->remaining === 0) {
                $action = '<strong>That was your last recovery code.</strong> Sign in now and '
                    . 'generate a new set from <strong>My Account</strong> — until you do, you '
                    . 'have no offline way back into the account. '
                    . 'If this was not you, change your password first.';
            }
        } else {
            $headline = 'Your recovery codes were replaced';
            $lead = 'A new set of 10 one-time recovery codes was generated for your admin '
                . 'account. Every code from the previous set has been cancelled and will no '
                . 'longer work.';
            $detailRows = <<<ROWS
    <tr><td style="padding:10px 20px;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">When</span><br>
      <span style="color:#111827;font-size:15px;font-weight:700;">{$when}</span>
    </td></tr>
ROWS;
            $action = 'If you did not do this, your account password may be compromised. '
                . 'Change your password right away.';
        }

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<tr><td style="background:{$accent};padding:28px 32px;text-align:center;">
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">{$appName}</h1>
  <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Account Security Alert</p>
</td></tr>

<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#1f2937;font-size:18px;font-weight:700;">{$headline}</h2>
  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
    Hi {$name},<br><br>{$lead}
  </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
{$detailRows}
  </table>

  <p style="color:#374151;font-size:13px;line-height:1.7;margin:0;">{$action}</p>
</td></tr>

<tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">
    &copy; {$year} {$appName}. All rights reserved.<br>
    This is an automated security notification — please do not reply to this email.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }
}
