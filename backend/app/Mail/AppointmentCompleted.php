<?php

namespace App\Mail;

use App\Models\Appointment;
use App\Models\SiteSetting;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

// NOTE: ShouldQueue is intentionally NOT implemented here, exactly like
// AppointmentConfirmation. Mail goes out synchronously (no queue worker on
// Hostinger) and AppointmentController::markCompleted() defers the send with
// OrderNotifier::afterResponse() inside a try/catch, so SMTP latency or an
// SMTP failure can never affect the PATCH response the portal is waiting on.
class AppointmentCompleted extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * Office details as seeded in SiteSettingSeeder. Used when site_settings
     * has no value for a key — or cannot be read at all — so the thank-you
     * note always carries a way to reach the laboratory.
     */
    private const FALLBACKS = [
        'location' => 'First Flr., Graduate School Building, University of Camarines Norte, Daet, Philippines',
        'email' => 'fmrc@cnsc.edu.ph',
        'phone' => '0909-099-0000',
        'facebook' => 'UCN FMRC',
        'facebook_url' => 'https://www.facebook.com/share/18MJcUvJeM/',
        'hours_days' => 'Monday - Friday',
        'hours_time' => '7:00am - 6:00pm',
        'site_url' => 'https://ucn-fabmanlab.com',
    ];

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
            subject: "Thank You for Visiting UCN-FMRC - {$referenceNo}",
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
     * Resolve the public office details from site_settings.
     *
     * Contact-section keys win, the Footer keys are the second choice (the two
     * are edited on different Website Management tabs and either one may be
     * blank), and self::FALLBACKS is the last resort.
     */
    private function officeDetails(): array
    {
        $settings = [];

        try {
            $settings = SiteSetting::whereIn('key', [
                'contact_location', 'contact_location_url', 'contact_email', 'contact_phone',
                'contact_facebook', 'contact_facebook_url',
                'footer_contact_location', 'footer_contact_location_url', 'footer_contact_email',
                'footer_contact_phone', 'footer_contact_facebook', 'footer_contact_facebook_url',
                'footer_hours_days', 'footer_hours_time',
            ])->pluck('value', 'key')->all();
        } catch (\Throwable $e) {
            // Settings unavailable — fall through to the seeded defaults below.
            $settings = [];
        }

        $pick = static function (array $keys, string $fallback) use ($settings): string {
            foreach ($keys as $key) {
                $value = trim((string) ($settings[$key] ?? ''));
                if ($value !== '') {
                    return $value;
                }
            }

            return $fallback;
        };

        $hoursDays = $pick(['footer_hours_days'], self::FALLBACKS['hours_days']);
        $hoursTime = $pick(['footer_hours_time'], self::FALLBACKS['hours_time']);

        return [
            'location' => $pick(['contact_location', 'footer_contact_location'], self::FALLBACKS['location']),
            'location_url' => $pick(['contact_location_url', 'footer_contact_location_url'], ''),
            'email' => $pick(['contact_email', 'footer_contact_email'], self::FALLBACKS['email']),
            'phone' => $pick(['contact_phone', 'footer_contact_phone'], self::FALLBACKS['phone']),
            'facebook' => $pick(['contact_facebook', 'footer_contact_facebook'], self::FALLBACKS['facebook']),
            'facebook_url' => $pick(['contact_facebook_url', 'footer_contact_facebook_url'], self::FALLBACKS['facebook_url']),
            'hours' => trim($hoursDays . ' · ' . $hoursTime, ' ·'),
            'site_url' => rtrim((string) (config('app.frontend_url') ?: self::FALLBACKS['site_url']), '/'),
        ];
    }

    /**
     * Build the HTML email body for the completed-visit thank-you note.
     * Same 600px shell, maroon header and footer as AppointmentConfirmation so
     * the two messages read as one family.
     */
    private function buildHtml(): string
    {
        $appointment = $this->appointment;
        $office = $this->officeDetails();

        $mi = trim((string) ($appointment->middle_initial ?? ''));
        $mi = $mi ? rtrim($mi, '.') . '.' : '';
        $clientName = implode(' ', array_filter([
            trim((string) $appointment->first_name),
            $mi,
            trim((string) $appointment->last_name),
        ])) ?: 'Valued Client';
        $firstName = trim((string) $appointment->first_name) ?: $clientName;

        $refNo   = e($appointment->reference_no ?? 'N/A');
        $date    = e(optional($appointment->appointment_date)->format('F j, Y') ?? 'N/A');
        $time    = e($appointment->appointment_time ?? 'N/A');
        $purpose = e($appointment->purpose ?? 'N/A');
        $name    = e($clientName);
        $hello   = e($firstName);

        $appName = config('app.name') ?: 'UCN-FMRC';
        if (strtolower($appName) === 'laravel') {
            $appName = 'UCN-FMRC';
        }
        $year    = now()->year;
        $accent  = '#800000';
        $success = '#0f7b52';

        $siteUrl  = e($office['site_url']);
        $location = e($office['location']);
        $hours    = e($office['hours']);
        $mailTo   = e($office['email']);
        $phone    = e($office['phone']);
        $telHref  = e(preg_replace('/[^0-9+]/', '', (string) $office['phone']));

        $locationValue = $office['location_url'] !== ''
            ? '<a href="' . e($office['location_url']) . '" style="color:' . $accent . ';text-decoration:none;font-weight:600;">' . $location . '</a>'
            : $location;

        $facebookRow = $office['facebook'] !== '' ? "
        <tr>
          <td style=\"padding:8px 20px 14px;\">
            <span style=\"color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;\">Facebook</span><br>
            <a href=\"" . e($office['facebook_url']) . "\" style=\"color:{$accent};font-size:14px;font-weight:600;text-decoration:none;\">" . e($office['facebook']) . "</a>
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
  <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Thank You for Your Visit</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#1f2937;font-size:18px;font-weight:700;">Thank You for Visiting Us, {$hello}!</h2>
  <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
    Hi {$name},<br><br>
    It was a genuine pleasure to welcome you to the <strong>Fabrication and Manufacturing Research Center</strong>. Your appointment is now complete, and we hope our team, our facilities and our service made your visit worthwhile.<br><br>
    Maraming salamat for trusting us with your project &mdash; clients like you are the very reason this laboratory exists.
  </p>

  <!-- Visit Summary Card -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Reference Number</span><br>
        <span style="color:{$accent};font-size:18px;font-weight:800;">{$refNo}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Visit Schedule</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$date} &mdash; {$time}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Purpose of Visit</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$purpose}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 20px;">
        <span style="display:inline-block;background:{$success};color:#fff;padding:5px 16px;border-radius:999px;font-size:12px;font-weight:700;">Status: Completed</span>
      </td>
    </tr>
  </table>
  <!-- Invitation to come back -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fff8f6;border:1px solid #f0d9d4;border-radius:10px;">
    <tr>
      <td style="padding:20px;text-align:center;">
        <h3 style="margin:0 0 6px;color:{$accent};font-size:16px;font-weight:800;">You Are Always Welcome Back</h3>
        <p style="margin:0 0 16px;color:#4b5563;font-size:13.5px;line-height:1.7;">
          Have another idea, prototype or project in mind? Booking is open anytime &mdash; pick a schedule that fits you and our team will be glad to accommodate you again.
        </p>
        <a href="{$siteUrl}" style="display:inline-block;background:{$accent};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:999px;">Set Another Appointment</a>
        <p style="margin:12px 0 0;color:#9ca3af;font-size:11.5px;">
          Or open <a href="{$siteUrl}" style="color:{$accent};text-decoration:none;font-weight:600;">{$siteUrl}</a> in your browser.
        </p>
      </td>
    </tr>
  </table>

  <!-- Contact Information -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr>
      <td style="padding:14px 20px 8px;">
        <span style="color:{$accent};font-size:13px;font-weight:800;letter-spacing:.02em;">Reach Us Anytime</span>
      </td>
    </tr>
    <tr>
      <td style="padding:6px 20px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Office Hours</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$hours}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 20px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Location</span><br>
        <span style="color:#374151;font-size:14px;font-weight:600;">{$locationValue}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 20px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Email</span><br>
        <a href="mailto:{$mailTo}" style="color:{$accent};font-size:14px;font-weight:600;text-decoration:none;">{$mailTo}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 20px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Phone</span><br>
        <a href="tel:{$telHref}" style="color:{$accent};font-size:14px;font-weight:600;text-decoration:none;">{$phone}</a>
      </td>
    </tr>{$facebookRow}
  </table>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
    Your feedback helps us serve the next client better, so please tell us how we did through any of the channels above. Until your next visit &mdash; keep creating, and we will keep the machines ready for you.
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
