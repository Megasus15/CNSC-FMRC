<?php

namespace Tests\Feature;

use App\Mail\AdminEmailChangeCommitted;
use App\Mail\AdminEmailChangeOtp;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminEmailChangeVerificationTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'name' => 'Administrator',
            'username' => 'admin',
            'email' => 'admin@cnsc.edu.ph',
            'role' => 'admin',
            'password' => Hash::make('AdminPass!2026'),
        ]);
    }

    /** Pull the 6-digit code straight off the mailable the controller queued. */
    private function capturedOtp(): string
    {
        $code = null;

        Mail::assertSent(AdminEmailChangeOtp::class, function (AdminEmailChangeOtp $mail) use (&$code) {
            $code = $mail->code;

            return true;
        });

        $this->assertNotNull($code, 'No verification code was mailed.');

        return $code;
    }

    public function test_an_admin_gmail_change_is_parked_until_the_new_address_is_verified(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])
            ->assertOk()
            ->assertJsonPath('email_verification_required', true)
            ->assertJsonPath('pending_email', 'fm*********@gmail.com')
            ->assertJsonPath('data.email', 'admin@cnsc.edu.ph');

        // The live address must not have moved.
        $this->assertSame('admin@cnsc.edu.ph', $admin->refresh()->email);
        $this->assertDatabaseCount('email_change_requests', 1);
        $this->assertDatabaseHas('email_change_requests', [
            'user_id' => $admin->id,
            'new_email' => 'fmrc.newbox@gmail.com',
            'attempts' => 0,
        ]);

        // The code goes to the NEW address only -- that is the whole point.
        Mail::assertSent(
            AdminEmailChangeOtp::class,
            fn (AdminEmailChangeOtp $mail) => $mail->hasTo('fmrc.newbox@gmail.com')
                && !$mail->hasTo('admin@cnsc.edu.ph')
        );

        // Plaintext code is never stored.
        $row = DB::table('email_change_requests')->first();
        $this->assertNotSame($this->capturedOtp(), $row->otp_hash);
        $this->assertTrue(Hash::check($this->capturedOtp(), $row->otp_hash));
    }

    public function test_a_username_change_still_applies_while_the_gmail_waits(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', [
            'email' => 'fmrc.newbox@gmail.com',
            'username' => 'admin-primary',
        ])->assertOk()->assertJsonPath('email_verification_required', true);

        $admin->refresh();
        $this->assertSame('admin-primary', $admin->username);
        $this->assertSame('admin@cnsc.edu.ph', $admin->email);
    }

    /** @return list<string> Every verification code mailed so far, in send order. */
    private function mailedCodes(): array
    {
        $codes = [];

        Mail::assertSent(AdminEmailChangeOtp::class, function (AdminEmailChangeOtp $mail) use (&$codes) {
            $codes[] = $mail->code;

            return true;
        });

        return $codes;
    }

    public function test_the_right_code_commits_the_change_and_warns_the_old_address(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])->assertOk();

        $this->postJson('/api/user/email-change/confirm', ['otp' => $this->capturedOtp()])
            ->assertOk()
            ->assertJsonPath('pending', false)
            ->assertJsonPath('data.email', 'fmrc.newbox@gmail.com');

        $this->assertSame('fmrc.newbox@gmail.com', $admin->refresh()->email);
        $this->assertDatabaseCount('email_change_requests', 0);

        // The address losing control is told, so a hijacked session cannot move the
        // password-reset destination quietly.
        Mail::assertSent(
            AdminEmailChangeCommitted::class,
            fn (AdminEmailChangeCommitted $mail) => $mail->hasTo('admin@cnsc.edu.ph')
                && $mail->oldEmail === 'admin@cnsc.edu.ph'
                && $mail->newEmail === 'fmrc.newbox@gmail.com'
        );
    }

    public function test_a_wrong_code_leaves_the_old_gmail_in_place(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])->assertOk();

        // 000001 can never be the real code: codes are drawn from 100000-999999.
        $this->postJson('/api/user/email-change/confirm', ['otp' => '000001'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'That code is not correct.')
            ->assertJsonPath('attempts_left', 4)
            ->assertJsonPath('pending', true);

        $this->assertSame('admin@cnsc.edu.ph', $admin->refresh()->email);
        $this->assertDatabaseHas('email_change_requests', ['attempts' => 1]);

        // A miss does not burn the request -- the real code still finishes it.
        $this->postJson('/api/user/email-change/confirm', ['otp' => $this->capturedOtp()])
            ->assertOk();

        $this->assertSame('fmrc.newbox@gmail.com', $admin->refresh()->email);
    }

    public function test_five_wrong_codes_throw_the_pending_change_away(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])->assertOk();
        $realCode = $this->capturedOtp();

        for ($i = 1; $i <= 4; $i++) {
            $this->postJson('/api/user/email-change/confirm', ['otp' => '00000' . $i])
                ->assertStatus(422)
                ->assertJsonPath('attempts_left', 5 - $i);
        }

        $this->postJson('/api/user/email-change/confirm', ['otp' => '000005'])
            ->assertStatus(422)
            ->assertJsonPath('attempts_left', 0)
            ->assertJsonPath('pending', false);

        $this->assertDatabaseCount('email_change_requests', 0);

        // Once the request is gone even the genuine code is worthless.
        $this->postJson('/api/user/email-change/confirm', ['otp' => $realCode])
            ->assertStatus(422)
            ->assertJsonPath('message', 'There is no Gmail change waiting for confirmation.');

        $this->assertSame('admin@cnsc.edu.ph', $admin->refresh()->email);
    }

    public function test_a_code_older_than_fifteen_minutes_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])->assertOk();
        $code = $this->capturedOtp();

        $this->travel(16)->minutes();

        $this->postJson('/api/user/email-change/confirm', ['otp' => $code])
            ->assertStatus(422)
            ->assertJsonPath('message', 'That code has expired. Please request the Gmail change again.');

        $this->assertDatabaseCount('email_change_requests', 0);
        $this->assertSame('admin@cnsc.edu.ph', $admin->refresh()->email);

        $this->travelBack();
    }

    public function test_the_pending_strip_survives_a_reload_and_can_be_cancelled(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->getJson('/api/user/email-change')
            ->assertOk()
            ->assertJsonPath('supported', true)
            ->assertJsonPath('pending', false);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])->assertOk();

        $this->getJson('/api/user/email-change')
            ->assertOk()
            ->assertJsonPath('pending', true)
            ->assertJsonPath('pending_email', 'fm*********@gmail.com')
            ->assertJsonPath('attempts_left', 5);

        $this->postJson('/api/user/email-change/cancel')
            ->assertOk()
            ->assertJsonPath('pending', false)
            ->assertJsonPath('data.email', 'admin@cnsc.edu.ph');

        $this->assertDatabaseCount('email_change_requests', 0);
        $this->getJson('/api/user/email-change')->assertOk()->assertJsonPath('pending', false);
    }

    public function test_a_second_request_replaces_the_first(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.first@gmail.com'])->assertOk();
        $firstCode = $this->capturedOtp();

        $this->putJson('/api/user', ['email' => 'fmrc.second@gmail.com'])->assertOk();

        // One pending change at a time -- the first address is forgotten entirely.
        $this->assertDatabaseCount('email_change_requests', 1);
        $this->assertDatabaseHas('email_change_requests', [
            'new_email' => 'fmrc.second@gmail.com',
            'attempts' => 0,
        ]);

        // The deferred send is registered on the app, which lives for the whole test,
        // so the first code can be replayed; the new code is whatever is not the first.
        $fresh = array_values(array_diff($this->mailedCodes(), [$firstCode]));
        $secondCode = $fresh[0] ?? $firstCode;

        // Two draws can repeat (1 in 900k), so only assert the dead code when it differs.
        if ($secondCode !== $firstCode) {
            $this->postJson('/api/user/email-change/confirm', ['otp' => $firstCode])
                ->assertStatus(422)
                ->assertJsonPath('message', 'That code is not correct.');
        }

        $this->postJson('/api/user/email-change/confirm', ['otp' => $secondCode])->assertOk();
        $this->assertSame('fmrc.second@gmail.com', $admin->refresh()->email);
    }

    public function test_a_non_gmail_address_is_still_rejected_before_anything_is_parked(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'admin@yahoo.com'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');

        $this->assertDatabaseCount('email_change_requests', 0);
        $this->assertSame('admin@cnsc.edu.ph', $admin->refresh()->email);
        Mail::assertNothingSent();
    }

    /**
     * The whole branch is gated on role === 'admin'. Staff and customers must keep
     * the old immediate-apply behaviour, byte for byte.
     */
    public function test_staff_and_customer_email_changes_still_apply_immediately(): void
    {
        Mail::fake();

        foreach (['staff' => 'staff_jane', 'customer' => 'cust_rico'] as $role => $username) {
            $user = User::factory()->create([
                'role' => $role,
                'username' => $username,
                'email' => $username . '@cnsc.edu.ph',
            ]);

            Sanctum::actingAs($user);

            $this->putJson('/api/user', ['email' => $username . '.new@gmail.com'])
                ->assertOk()
                ->assertJsonPath('email_verification_required', false)
                ->assertJsonPath('data.email', $username . '.new@gmail.com');

            $this->assertSame($username . '.new@gmail.com', $user->refresh()->email);
        }

        $this->assertDatabaseCount('email_change_requests', 0);
        Mail::assertNothingSent();
    }

    public function test_an_address_claimed_while_the_code_waited_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])->assertOk();
        $code = $this->capturedOtp();

        // Another account claims the address during the 15-minute window.
        User::factory()->create(['username' => 'squatter', 'email' => 'fmrc.newbox@gmail.com']);

        $this->postJson('/api/user/email-change/confirm', ['otp' => $code])
            ->assertStatus(422)
            ->assertJsonPath('pending', false);

        $this->assertSame('admin@cnsc.edu.ph', $admin->refresh()->email);
        $this->assertDatabaseCount('email_change_requests', 0);
    }

    /**
     * Hostinger deploys copy files only, so the table can be absent for a while.
     * The Gmail change must keep working the old way until the migration is run.
     */
    public function test_the_change_applies_immediately_when_the_migration_is_missing(): void
    {
        Mail::fake();
        $admin = $this->admin();

        Schema::drop('email_change_requests');

        Sanctum::actingAs($admin);

        $this->getJson('/api/user/email-change')
            ->assertOk()
            ->assertJsonPath('supported', false)
            ->assertJsonPath('pending', false);

        $this->putJson('/api/user', ['email' => 'fmrc.newbox@gmail.com'])
            ->assertOk()
            ->assertJsonPath('email_verification_required', false);

        $this->assertSame('fmrc.newbox@gmail.com', $admin->refresh()->email);

        $this->postJson('/api/user/email-change/confirm', ['otp' => '123456'])
            ->assertStatus(422)
            ->assertJsonPath('supported', false);

        $this->postJson('/api/user/email-change/cancel')->assertOk();
    }

    public function test_the_email_change_endpoints_require_a_signed_in_user(): void
    {
        Mail::fake();
        $this->admin();

        $this->getJson('/api/user/email-change')->assertUnauthorized();
        $this->postJson('/api/user/email-change/confirm', ['otp' => '123456'])->assertUnauthorized();
        $this->postJson('/api/user/email-change/cancel')->assertUnauthorized();
    }
}
