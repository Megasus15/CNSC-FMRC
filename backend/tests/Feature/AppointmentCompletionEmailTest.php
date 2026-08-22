<?php

namespace Tests\Feature;

use App\Mail\AppointmentCompleted;
use App\Models\Appointment;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers the thank-you email that goes out when Admin or Staff use the
 * "Mark Appointment as Done" modal (PATCH /api/appointments/{id}/complete).
 */
class AppointmentCompletionEmailTest extends TestCase
{
    use RefreshDatabase;

    private function actingAdmin(): User
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function makeAppointment(array $overrides = []): Appointment
    {
        return Appointment::create(array_merge([
            'reference_no' => 'AP-THANKS-001',
            'first_name' => 'Maria',
            'middle_initial' => 'L',
            'last_name' => 'Santos',
            'email' => 'maria.santos@example.test',
            'contact_number' => '09171234567',
            'full_address' => 'Daet, Camarines Norte',
            'client_type' => 'Student',
            'purpose' => '3D Printing',
            'appointment_date' => '2026-08-24',
            'appointment_time' => '9:00 AM - 10:00 AM',
            'status' => 'Scheduled',
        ], $overrides));
    }

    public function test_marking_an_appointment_done_emails_a_thank_you_with_site_contact_details(): void
    {
        Mail::fake();
        $this->actingAdmin();

        SiteSetting::set('contact_email', 'hello@fmrc.test');
        SiteSetting::set('contact_phone', '0917-555-0101');
        SiteSetting::set('contact_location', 'Innovation Hall, UCN Daet');
        SiteSetting::set('contact_location_url', 'https://maps.example.test/ucn');
        SiteSetting::set('contact_facebook', 'FMRC Official');
        SiteSetting::set('contact_facebook_url', 'https://facebook.example.test/fmrc');
        SiteSetting::set('footer_hours_days', 'Monday - Saturday');
        SiteSetting::set('footer_hours_time', '8:00am - 5:00pm');

        $appointment = $this->makeAppointment();

        $this->patchJson('/api/appointments/' . $appointment->id . '/complete')
            ->assertOk()
            ->assertJsonPath('data.status', 'Completed');

        Mail::assertSent(AppointmentCompleted::class, function (AppointmentCompleted $mail) use ($appointment) {
            $html = $mail->render();

            $this->assertStringContainsString('Thank You for Visiting Us, Maria!', $html);
            $this->assertStringContainsString('Maria L. Santos', $html);
            $this->assertStringContainsString('AP-THANKS-001', $html);
            $this->assertStringContainsString('August 24, 2026', $html);
            $this->assertStringContainsString('Status: Completed', $html);
            $this->assertStringContainsString('Set Another Appointment', $html);
            $this->assertStringContainsString('hello@fmrc.test', $html);
            $this->assertStringContainsString('0917-555-0101', $html);
            $this->assertStringContainsString('Innovation Hall, UCN Daet', $html);
            $this->assertStringContainsString('https://maps.example.test/ucn', $html);
            $this->assertStringContainsString('Monday - Saturday', $html);
            $this->assertStringContainsString('8:00am - 5:00pm', $html);
            $this->assertStringContainsString('FMRC Official', $html);

            return $mail->hasTo($appointment->email)
                && str_contains($mail->envelope()->subject, 'AP-THANKS-001');
        });
    }

    public function test_thank_you_email_falls_back_to_the_official_contact_details(): void
    {
        Mail::fake();
        $this->actingAdmin();

        // site_settings intentionally left empty.
        $appointment = $this->makeAppointment(['reference_no' => 'AP-THANKS-002']);

        $this->patchJson('/api/appointments/' . $appointment->id . '/complete')->assertOk();

        Mail::assertSent(AppointmentCompleted::class, function (AppointmentCompleted $mail) {
            $html = $mail->render();

            $this->assertStringContainsString('fmrc@cnsc.edu.ph', $html);
            $this->assertStringContainsString('0909-099-0000', $html);
            $this->assertStringContainsString('Graduate School Building', $html);
            $this->assertStringContainsString('Monday - Friday', $html);
            $this->assertStringContainsString('7:00am - 6:00pm', $html);

            return true;
        });
    }

    public function test_thank_you_email_links_back_to_the_customer_website(): void
    {
        Mail::fake();
        $this->actingAdmin();
        config(['app.frontend_url' => 'https://ucn-fabmanlab.test/']);

        $appointment = $this->makeAppointment(['reference_no' => 'AP-THANKS-004']);

        $this->patchJson('/api/appointments/' . $appointment->id . '/complete')->assertOk();

        Mail::assertSent(AppointmentCompleted::class, function (AppointmentCompleted $mail) {
            // Trailing slash trimmed so the href never doubles up.
            $this->assertStringContainsString('href="https://ucn-fabmanlab.test"', $mail->render());

            return true;
        });
    }

    public function test_completion_still_succeeds_when_the_appointment_has_no_usable_email(): void
    {
        Mail::fake();
        $this->actingAdmin();

        $appointment = $this->makeAppointment([
            'reference_no' => 'AP-THANKS-003',
            'email' => 'walk-in-no-email',
        ]);

        $this->patchJson('/api/appointments/' . $appointment->id . '/complete')->assertOk();

        Mail::assertNothingSent();
        $this->assertDatabaseHas('appointments', [
            'id' => $appointment->id,
            'status' => 'Completed',
        ]);
    }

    public function test_an_already_completed_appointment_is_rejected_and_sends_nothing(): void
    {
        Mail::fake();
        $this->actingAdmin();

        $appointment = $this->makeAppointment([
            'reference_no' => 'AP-THANKS-005',
            'status' => 'Completed',
        ]);

        $this->patchJson('/api/appointments/' . $appointment->id . '/complete')
            ->assertStatus(422);

        Mail::assertNothingSent();
    }

    public function test_staff_marking_an_appointment_done_also_sends_the_thank_you(): void
    {
        Mail::fake();

        // SQLite retains the original users-role CHECK constraint, so persist an
        // Admin fixture and expose Staff on the authenticated in-memory model —
        // the same shim AdminReportGenerationTest uses.
        $staff = User::factory()->create(['role' => 'admin']);
        $staff->setAttribute('role', 'staff');
        Sanctum::actingAs($staff);

        $appointment = $this->makeAppointment(['reference_no' => 'AP-THANKS-006']);

        $this->patchJson('/api/appointments/' . $appointment->id . '/complete')->assertOk();

        Mail::assertSent(AppointmentCompleted::class, 1);
    }
}
