<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Mail\AdminEmailChangeCommitted;
use App\Mail\AdminEmailChangeOtp;
use App\Mail\AdminRecoveryCodeAlert;
use App\Mail\AppointmentCompleted;
use App\Mail\AppointmentConfirmation;
use App\Mail\StaffAccountRequestApproved;
use App\Mail\StaffAccountRequestRejected;
use App\Models\Appointment;
use App\Models\Order;
use App\Models\StaffAccountRequest;
use App\Models\User;
use App\Support\Branding;
use App\Support\OrderNotifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Regression guard for the UCN-FMRC email rebrand.
 *
 * Every template used to read `config('app.name')` and only correct itself when the
 * value was empty or the literal string "laravel". The live .env says
 * `APP_NAME=CNSC-FMRC`, which is neither -- so the retired institution name went out
 * in the header and the footer of every message. Each test below deliberately sets
 * `app.name` and `mail.from.name` back to the wrong value, proving the templates no
 * longer listen to either.
 *
 * Email ADDRESSES are intentionally left alone (fmrc@cnsc.edu.ph and friends are real
 * mailboxes), so the assertions are case-sensitive on "CNSC-FMRC" and the address
 * assertions confirm the addresses survived.
 */
class EmailBrandingTest extends TestCase
{
    use RefreshDatabase;

    /** Put the wrong branding back in config so each render has to ignore it. */
    private function misconfigureBranding(): void
    {
        config([
            'app.name' => 'CNSC-FMRC',
            'mail.from.name' => 'CNSC-FMRC',
        ]);
    }

    /** The shared assertions every rendered template has to satisfy. */
    private function assertBranded(string $html): void
    {
        $this->assertStringContainsString('UCN-FMRC', $html);
        $this->assertStringNotContainsString('CNSC-FMRC', $html);
        $this->assertStringNotContainsString('Camarines Norte State College', $html);
    }

    private function makeUser(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'name' => 'Site Administrator',
            'role' => 'admin',
        ], $overrides));
    }

    private function makeAppointment(): Appointment
    {
        return Appointment::create([
            'reference_no' => 'AP-BRAND-001',
            'first_name' => 'Jose',
            'middle_initial' => 'P',
            'last_name' => 'Rizal',
            'email' => 'jose.rizal@example.test',
            'contact_number' => '09171234567',
            'full_address' => 'Daet, Camarines Norte',
            'client_type' => 'Student',
            'purpose' => 'Laser Cutting',
            'appointment_date' => '2026-09-10',
            'appointment_time' => '1:00 PM - 2:00 PM',
            'status' => 'Scheduled',
        ]);
    }

    public function test_the_sender_display_name_is_pinned_in_code_not_in_the_env_file(): void
    {
        // AppServiceProvider::boot() normalises this at boot, which is what fixes the
        // five mailables that never set `from:` on their envelope.
        $this->assertSame('UCN-FMRC', config('mail.from.name'));
        $this->assertSame('UCN-FMRC', Branding::mailFromName());
        $this->assertSame('University of Camarines Norte', Branding::INSTITUTION);
    }

    public function test_appointment_confirmation_is_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        $html = (new AppointmentConfirmation($this->makeAppointment()))->render();

        $this->assertBranded($html);
        $this->assertStringContainsString('AP-BRAND-001', $html);
    }

    public function test_appointment_completion_is_branded_and_keeps_the_real_mailbox(): void
    {
        $this->misconfigureBranding();

        // site_settings left empty on purpose so the seeded fallbacks render.
        $html = (new AppointmentCompleted($this->makeAppointment()))->render();

        $this->assertBranded($html);
        $this->assertStringContainsString('fmrc@cnsc.edu.ph', $html);
    }

    public function test_recovery_code_alert_is_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        $html = (new AdminRecoveryCodeAlert($this->makeUser(), 'redeemed', 4, '203.0.113.7'))->render();

        $this->assertBranded($html);
    }

    public function test_email_change_otp_is_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        $html = (new AdminEmailChangeOtp($this->makeUser(), '123456', 10))->render();

        $this->assertBranded($html);
    }

    public function test_email_change_committed_notice_is_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        $html = (new AdminEmailChangeCommitted(
            $this->makeUser(),
            'old.admin@gmail.com',
            'new.admin@gmail.com',
        ))->render();

        $this->assertBranded($html);
    }

    public function test_order_status_email_is_branded_and_its_copyright_year_is_not_frozen(): void
    {
        $this->misconfigureBranding();

        $order = (new Order())->forceFill([
            'id' => 4242,
            'order_no' => 'ORD-BRAND-01',
            'total' => 1250.5,
            'customer_stage' => 'to_ship',
        ]);

        $html = OrderNotifier::buildEmailHtml($order, 'Your order is being prepared', 'Thank you for ordering.');

        $this->assertBranded($html);
        $this->assertStringContainsString('University of Camarines Norte', $html);
        // The footer used to read "© 2025" forever.
        $this->assertStringContainsString('&copy; ' . date('Y'), $html);
        $this->assertStringNotContainsString('&copy; 2025 ', $html);
    }

    public function test_password_reset_otp_email_is_branded_and_names_the_current_institution(): void
    {
        $this->misconfigureBranding();

        $html = $this->renderPrivate(
            new PasswordResetController(),
            'buildOtpEmailHtml',
            [$this->makeUser(['role' => 'customer', 'name' => 'Andres Bonifacio']), '654321', 1, 1, null],
        );

        $this->assertBranded($html);
        $this->assertStringContainsString('University of Camarines Norte', $html);
        $this->assertStringContainsString('6 5 4 3 2 1', $html);
    }

    public function test_welcome_email_is_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        $html = $this->renderPrivate(
            new AuthController(),
            'buildWelcomeEmailHtml',
            [$this->makeUser(['role' => 'customer', 'name' => 'Gabriela Silang'])],
        );

        $this->assertBranded($html);
    }

    public function test_admin_created_account_email_is_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        $html = $this->renderPrivate(
            new AuthController(),
            'buildAdminCreatedAccountEmailHtml',
            [$this->makeUser(['role' => 'staff', 'name' => 'Melchora Aquino']), 'TempPass!2026'],
        );

        $this->assertBranded($html);
    }

    public function test_staff_account_request_decision_emails_are_branded_ucn_fmrc(): void
    {
        $this->misconfigureBranding();

        // Unsaved rows: these two templates read only their own columns, so there
        // is no reason to touch the database to render them.
        $request = (new StaffAccountRequest())->forceFill([
            'id' => 77,
            'name' => 'Melchora Aquino',
            'username' => 'melchora',
            'email' => 'melchora.aquino@gmail.com',
            'status' => StaffAccountRequest::STATUS_APPROVED,
        ]);

        $approved = (new StaffAccountRequestApproved($request))->render();
        $this->assertBranded($approved);
        $this->assertStringContainsString('University of Camarines Norte', $approved);
        $this->assertStringContainsString('melchora', $approved);

        $rejected = (new StaffAccountRequestRejected((new StaffAccountRequest())->forceFill([
            'id' => 78,
            'name' => 'Melchora Aquino',
            'username' => 'melchora',
            'email' => 'melchora.aquino@gmail.com',
            'status' => StaffAccountRequest::STATUS_REJECTED,
            'decision_note' => 'Affiliation could not be confirmed.',
        ])))->render();

        $this->assertBranded($rejected);
        $this->assertStringContainsString('Affiliation could not be confirmed.', $rejected);
    }

    /**
     * Render one of the inline email builders. They are private helpers on their
     * controllers rather than mailables, so reflection is the only way to render one
     * without going through an endpoint that would actually dispatch mail.
     */
    private function renderPrivate(object $controller, string $method, array $args): string
    {
        $reflected = new ReflectionMethod($controller, $method);
        $reflected->setAccessible(true);

        return (string) $reflected->invokeArgs($controller, $args);
    }
}
