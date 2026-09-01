<?php

namespace App\Mail;

use App\Models\Appointment;
use App\Support\EmailTemplate;
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
     *
     * The header, body copy, footer note and header colour come from the
     * admin-editable `appointment_confirmed` template. The details card is
     * code-owned: a confirmation without the reference number and schedule
     * would be useless to the client.
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

        $accent = EmailTemplate::color(EmailTemplate::resolve('appointment_confirmed')['header_color']);

        $notesRow = $notes ? "
              <tr>
                <td style=\"padding:10px 20px;border-bottom:1px solid #f1f4f8;\">
                  <span style=\"color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;\">Additional Notes</span><br>
                  <span style=\"color:#374151;font-size:14px;font-weight:600;margin-top:4px;display:inline-block;\">{$notes}</span>
                </td>
              </tr>" : '';

        $extra = <<<HTML
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
HTML;

        return EmailTemplate::render('appointment_confirmed', [
            'client_name'  => $clientName,
            'reference_no' => (string) ($appointment->reference_no ?? 'N/A'),
            'date'         => (string) (optional($appointment->appointment_date)->format('Y-m-d') ?? 'N/A'),
            'time'         => (string) ($appointment->appointment_time ?? 'N/A'),
            'purpose'      => (string) ($appointment->purpose ?? 'N/A'),
        ], $extra);
    }

}
