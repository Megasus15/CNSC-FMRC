<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The 6-digit code that proves a proposed new Gmail address is actually reachable.
 *
 * Addressed to the NEW address, never the old one. Until this code is entered the
 * account keeps its existing Gmail, which is what stops a typo from silently
 * redirecting every future password reset to an address nobody owns.
 */
class AdminEmailChangeOtp extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly User $user,
        public readonly string $code,
        public readonly int $expiresInMinutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Confirm your new Gmail address — code ' . $this->code,
        );
    }

    public function content(): Content
    {
        return new Content(htmlString: $this->buildHtml());
    }

    private function buildHtml(): string
    {
        $accent = '#800000';
        $appName = config('app.name') ?: 'UCN-FMRC';
        if (strtolower($appName) === 'laravel') {
            $appName = 'UCN-FMRC';
        }
        $year = now()->year;
        $name = e($this->user->name ?: 'Administrator');
        $code = e($this->code);
        $minutes = (int) $this->expiresInMinutes;

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
  <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Confirm Your New Gmail</p>
</td></tr>

<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#1f2937;font-size:18px;font-weight:700;">Verify this address to finish the change</h2>
  <p style="margin:0 0 22px;color:#374151;font-size:14px;line-height:1.7;">
    Hi {$name},<br><br>
    This address was entered as the new Gmail for your {$appName} admin account. Enter the
    code below on the My Account page to confirm it. Your account keeps its current Gmail
    until you do.
  </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td align="center" style="padding:24px 20px;">
      <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Verification Code</span><br>
      <span style="color:{$accent};font-size:38px;font-weight:800;letter-spacing:10px;line-height:1.4;">{$code}</span><br>
      <span style="color:#9ca3af;font-size:12px;">Expires in {$minutes} minutes</span>
    </td></tr>
  </table>

  <p style="color:#374151;font-size:13px;line-height:1.7;margin:0;">
    If you were not expecting this, you can ignore this email — nothing has changed yet, and
    the request expires on its own.
  </p>
</td></tr>

<tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">
    &copy; {$year} {$appName}. All rights reserved.<br>
    This is an automated notification — please do not reply to this email.
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
