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
        $slug = $this->event === 'redeemed'
            ? 'admin_recovery_code_used'
            : 'admin_recovery_codes_replaced';

        $accent = EmailTemplate::color(EmailTemplate::resolve($slug)['header_color']);
        $when = $this->occurredAt ?: now()->format('F j, Y \a\t g:i A');
        $whenHtml = e($when);
        $ip = $this->ip ?: 'unknown';
        $ipHtml = e($ip);

        // Code-owned: the audit rows, and the last-code warning. An admin must
        // not be able to edit away the fact that no codes are left.
        if ($this->event === 'redeemed') {
            $remaining = (int) $this->remaining;
            $detailRows = <<<ROWS
<tr><td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">When</span><br>
                <span style="color:#111827;font-size:15px;font-weight:700;">{$whenHtml}</span>
              </td></tr>
              <tr><td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">IP Address</span><br>
                <span style="color:#374151;font-size:14px;font-weight:600;">{$ipHtml}</span>
              </td></tr>
              <tr><td style="padding:10px 20px;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Codes Remaining</span><br>
                <span style="color:{$accent};font-size:18px;font-weight:800;">{$remaining} of 10</span>
              </td></tr>
ROWS;
        } else {
            $detailRows = <<<ROWS
<tr><td style="padding:10px 20px;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">When</span><br>
                <span style="color:#111827;font-size:15px;font-weight:700;">{$whenHtml}</span>
              </td></tr>
ROWS;
        }

        $lastCodeHtml = '';
        if ($this->event === 'redeemed' && $this->remaining === 0) {
            $lastCodeHtml = <<<HTML

            <p style="margin:0 0 20px;padding:12px 16px;background:#fef3c7;border-left:4px solid #d97706;border-radius:6px;color:#92400e;font-size:13px;line-height:1.6;">
              <strong>That was your last recovery code.</strong> Sign in now and generate a new set from <strong>My Account</strong> — until you do, you have no offline way back into the account. If this was not you, change your password first.
            </p>
HTML;
        }

        $extra = <<<HTML
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
              {$detailRows}
            </table>{$lastCodeHtml}
HTML;

        return EmailTemplate::render($slug, [
            'admin_name'  => $this->user->name ?: 'Administrator',
            'occurred_at' => $when,
            'ip'          => $ip,
            'remaining'   => (string) ((int) $this->remaining),
        ], $extra);
    }
}
