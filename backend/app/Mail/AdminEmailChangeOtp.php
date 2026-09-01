<?php

namespace App\Mail;

use App\Models\User;
use App\Support\EmailTemplate;
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
        $code = e($this->code);
        $minutes = (int) $this->expiresInMinutes;
        $accent = EmailTemplate::color(EmailTemplate::resolve('admin_email_change_otp')['header_color']);

        // Code-owned: the verification code block and the "nothing has changed
        // yet" reassurance cannot be edited out of a verification email.
        $extra = <<<HTML
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
              <tr><td align="center" style="padding:24px 20px;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Verification Code</span><br>
                <span style="color:{$accent};font-size:38px;font-weight:800;letter-spacing:10px;line-height:1.4;">{$code}</span><br>
                <span style="color:#9ca3af;font-size:12px;">Expires in {$minutes} minutes</span>
              </td></tr>
            </table>
HTML;

        return EmailTemplate::render('admin_email_change_otp', [
            'admin_name' => $this->user->name ?: 'Administrator',
            'otp_code'   => $this->code,
            'minutes'    => (string) $minutes,
        ], $extra);
    }
}
