<?php

namespace App\Mail;

use App\Models\Appointment;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

// NOTE: ShouldQueue is intentionally NOT implemented here.
// Emails are sent synchronously so no queue worker is required.
// The AppointmentController wraps Mail::send() in a try/catch to ensure
// SMTP failures never prevent the HTTP 201 response from being returned.
class AppointmentConfirmation extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * No queue retry settings needed — mail is sent synchronously.
     */

    public function __construct(
        public readonly Appointment $appointment,
    ) {}

    /**
     * Get the message envelope.
     */
    public function envelope(): Envelope
    {
        $referenceNo = $this->appointment->reference_no ?? 'N/A';

        return new Envelope(
            subject: "Appointment Confirmed - {$referenceNo}",
        );
    }

    /**
     * Get the message content definition.
     */
    public function content(): Content
    {
        return new Content(
            htmlString: $this->buildHtml(),
        );
    }

    /**
     * Build the HTML email body for the appointment confirmation.
     */
    private function buildHtml(): string
    {
        $appointment = $this->appointment;

        $mi = trim((string) ($appointment->middle_initial ?? ''));
        $mi = $mi ? rtrim($mi, '.') . '.' : '';
        $clientName = implode(' ', array_filter([
            trim((string) $appointment->first_name),
            $mi,
            trim((string) $appointment->last_name),
        ])) ?: 'Valued Client';

        $refNo      = e($appointment->reference_no ?? 'N/A');
        $date       = e(optional($appointment->appointment_date)->format('Y-m-d') ?? 'N/A');
        $time       = e($appointment->appointment_time ?? 'N/A');
        $purpose    = e($appointment->purpose ?? 'N/A');
        $clientType = e($appointment->client_type ?? 'N/A');
        $contact    = e($appointment->contact_number ?? 'N/A');
        $email      = e($appointment->email ?? 'N/A');
        $address    = e($appointment->full_address ?? 'N/A');
        $notes      = e($appointment->additional_notes ?? '');
        $name       = e($clientName);

        $appName = config('app.name') ?: 'UCN-FMRC';
        if (strtolower($appName) === 'laravel') {
            $appName = 'UCN-FMRC';
        }
        $year   = now()->year;
        $accent = '#800000';

        $notesRow = $notes ? "
        <tr>
          <td style=\"padding:10px 20px;border-bottom:1px solid #f1f4f8;\">
            <span style=\"color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;\">Additional Notes</span><br>
            <span style=\"color:#374151;font-size:14px;font-weight:600;margin-top:4px;display:inline-block;\">{$notes}</span>
          </td>
        </tr>" : '';

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
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">{$appName}</h1>
  <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Appointment Confirmation</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#1f2937;font-size:18px;font-weight:700;">Your Appointment Has Been Scheduled</h2>
  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
    Hi {$name},<br><br>
    Thank you for scheduling an appointment with UCN-FMRC. Below are the details of your booking. Please keep your reference number for your records.
  </p>

  <!-- Appointment Details Card -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Reference Number</span><br>
        <span style="color:{$accent};font-size:18px;font-weight:800;">{$refNo}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Schedule</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$date} &mdash; {$time}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Full Name</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$name}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Purpose</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$purpose}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Type of Client</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$clientType}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Contact Number</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$contact}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Email</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$email}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Address</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$address}</span>
      </td>
    </tr>{$notesRow}
    <tr>
      <td style="padding:12px 20px;">
        <span style="display:inline-block;background:{$accent};color:#fff;padding:5px 16px;border-radius:999px;font-size:12px;font-weight:700;">Status: Scheduled</span>
      </td>
    </tr>
  </table>

  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
    Please arrive at the UCN-FMRC office at least 10 minutes before your scheduled time. If you need to cancel or reschedule, please contact us directly.
  </p>
</td></tr>

<!-- Footer -->
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
