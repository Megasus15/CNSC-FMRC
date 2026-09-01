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
        $new = e($this->maskEmail($this->newEmail));
        $when = now()->format('F j, Y \a\t g:i A');
        $whenHtml = e($when);

        // Code-owned: the audit rows are the whole point of a security alert.
        $extra = <<<HTML
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
              <tr><td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">New Address</span><br>
                <span style="color:#111827;font-size:15px;font-weight:700;">{$new}</span>
              </td></tr>
              <tr><td style="padding:10px 20px;">
                <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">When</span><br>
                <span style="color:#374151;font-size:14px;font-weight:600;">{$whenHtml}</span>
              </td></tr>
            </table>
HTML;

        return EmailTemplate::render('admin_email_change_committed', [
            'admin_name'  => $this->user->name ?: 'Administrator',
            'new_email'   => $this->maskEmail($this->newEmail),
            'old_email'   => $this->oldEmail,
            'occurred_at' => $when,
        ], $extra);
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
