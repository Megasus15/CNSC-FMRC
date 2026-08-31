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
 * Notice sent to the OLD address once a Gmail change is committed.
 *
 * The new address already proved itself with a code, so this exists purely so the
 * previous owner of the account inbox finds out -- it is the last warning an admin
 * gets if someone else changed the address.
 */
class AdminEmailChangeCommitted extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User $user,
        public readonly string $oldEmail,
        public readonly string $newEmail,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Security alert: the Gmail on your account was changed',
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
        $old = e($this->oldEmail);
        $new = e($this->maskEmail($this->newEmail));
        $when = e(now()->format('F j, Y \a\t g:i A'));

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
  <h2 style="margin:0 0 8px;color:#1f2937;font-size:18px;font-weight:700;">The Gmail on your account was changed</h2>
  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
    Hi {$name},<br><br>
    Password resets and notifications for your {$appName} admin account will now go to the
    new address. This message is the last one sent to <strong>{$old}</strong>.
  </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">New Address</span><br>
      <span style="color:#111827;font-size:15px;font-weight:700;">{$new}</span>
    </td></tr>
    <tr><td style="padding:10px 20px;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">When</span><br>
      <span style="color:#374151;font-size:14px;font-weight:600;">{$when}</span>
    </td></tr>
  </table>

  <p style="color:#374151;font-size:13px;line-height:1.7;margin:0;">
    If you did not make this change, use one of your one-time recovery codes on the admin
    sign-in page to take the account back, then set a new password immediately.
  </p>
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

    /** Show enough of the new address to recognise it, not enough to hand it over. */
    private function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2 || $parts[0] === '') {
            return $email;
        }

        $local = $parts[0];
        $visible = mb_substr($local, 0, min(2, mb_strlen($local)));

        return $visible . str_repeat('*', max(1, mb_strlen($local) - mb_strlen($visible))) . '@' . $parts[1];
    }
}
