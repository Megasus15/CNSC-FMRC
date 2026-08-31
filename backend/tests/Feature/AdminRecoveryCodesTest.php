<?php

namespace Tests\Feature;

use App\Mail\AdminRecoveryCodeAlert;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminRecoveryCodesTest extends TestCase
{
    use RefreshDatabase;

    private const ADMIN_PASSWORD = 'AdminPass!2026';

    private function admin(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'name' => 'Administrator',
            'username' => 'admin',
            'email' => 'admin@cnsc.edu.ph',
            'role' => 'admin',
            'password' => Hash::make(self::ADMIN_PASSWORD),
        ], $overrides));
    }

    /** @return list<string> The 10 dashed codes as the admin sees them. */
    private function generateCodes(User $admin): array
    {
        Sanctum::actingAs($admin);

        return $this->postJson('/api/admin/recovery-codes/generate', [
            'current_password' => self::ADMIN_PASSWORD,
        ])->assertOk()->json('codes');
    }

    private function raw(string $dashed): string
    {
        return str_replace('-', '', $dashed);
    }

    public function test_generating_codes_requires_the_correct_current_password(): void
    {
        Mail::fake();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->postJson('/api/admin/recovery-codes/generate', [
            'current_password' => 'not-the-password',
        ])->assertStatus(422)->assertJsonPath('message', 'Current password does not match.');

        $this->assertDatabaseCount('admin_recovery_codes', 0);

        $this->postJson('/api/admin/recovery-codes/generate', [
            'current_password' => self::ADMIN_PASSWORD,
        ])->assertOk();

        $this->assertDatabaseCount('admin_recovery_codes', 10);
    }

    public function test_only_an_admin_can_reach_the_recovery_code_endpoints(): void
    {
        Mail::fake();
        $staff = User::factory()->create(['role' => 'staff', 'password' => Hash::make(self::ADMIN_PASSWORD)]);
        Sanctum::actingAs($staff);

        $this->getJson('/api/admin/recovery-codes')->assertForbidden();
        $this->postJson('/api/admin/recovery-codes/generate', [
            'current_password' => self::ADMIN_PASSWORD,
        ])->assertForbidden();

        $this->assertDatabaseCount('admin_recovery_codes', 0);
    }

    public function test_ten_codes_are_issued_and_only_hashes_are_stored(): void
    {
        Mail::fake();
        $admin = $this->admin();

        $codes = $this->generateCodes($admin);

        $this->assertCount(10, $codes);
        $this->assertCount(10, array_unique($codes), 'Codes within a set must be unique.');
        $this->assertDatabaseCount('admin_recovery_codes', 10);

        $stored = DB::table('admin_recovery_codes')->pluck('code_hash')->all();
        foreach ($codes as $code) {
            $this->assertStringNotContainsString($this->raw($code), implode('|', $stored));
        }

        // Every stored hash must verify against exactly one issued code.
        foreach ($stored as $hash) {
            $matches = array_filter($codes, fn (string $c) => Hash::check($this->raw($c), $hash));
            $this->assertCount(1, $matches);
        }
    }

    public function test_a_generated_set_contains_no_look_alike_codes(): void
    {
        Mail::fake();
        $admin = $this->admin();

        // Repeat: the readability rules only matter if they hold on every draw.
        for ($round = 0; $round < 5; $round++) {
            $codes = $this->generateCodes($admin);
            $raws = array_map(fn (string $c) => $this->raw($c), $codes);

            foreach ($codes as $code) {
                $this->assertMatchesRegularExpression(
                    '/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/',
                    $code,
                    'Codes must be xxxxx-xxxxx over the unambiguous alphabet (no 0/1/I/L/O/U).'
                );
            }

            $firstBlocks = array_map(fn (string $r) => substr($r, 0, 5), $raws);
            $lastBlocks = array_map(fn (string $r) => substr($r, 5, 5), $raws);
            $this->assertCount(10, array_unique($firstBlocks), 'First blocks must all differ.');
            $this->assertCount(10, array_unique($lastBlocks), 'Second blocks must all differ.');

            foreach ($raws as $i => $a) {
                $this->assertDoesNotMatchRegularExpression(
                    '/(.)\1{2}/',
                    $a,
                    'No code may repeat a character three times in a row.'
                );

                foreach ($raws as $j => $b) {
                    if ($j <= $i) {
                        continue;
                    }

                    $differing = 0;
                    for ($k = 0; $k < 10; $k++) {
                        if ($a[$k] !== $b[$k]) {
                            $differing++;
                        }
                    }

                    $this->assertGreaterThanOrEqual(
                        3,
                        $differing,
                        "Codes {$a} and {$b} differ in only {$differing} positions."
                    );
                }
            }
        }
    }

    public function test_status_reports_counts_and_never_returns_plaintext(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        Sanctum::actingAs($admin);
        $response = $this->getJson('/api/admin/recovery-codes')->assertOk();

        $response->assertJsonPath('supported', true)
            ->assertJsonPath('total', 10)
            ->assertJsonPath('remaining', 10)
            ->assertJsonMissingPath('codes');

        $this->assertNotNull($response->json('generated_at'));
        $this->assertNull($response->json('last_used_at'));

        $body = $response->getContent();
        foreach ($codes as $code) {
            $this->assertStringNotContainsString($this->raw($code), $body);
        }
    }

    public function test_redeeming_a_code_sets_the_password_and_kills_every_session(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        $admin->createToken('desktop');
        $admin->createToken('phone');
        $this->assertDatabaseCount('personal_access_tokens', 2);

        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin',
            'recovery_code' => $codes[0],
            'new_password' => 'BrandNewPass!9',
            'new_password_confirmation' => 'BrandNewPass!9',
        ])->assertOk()->assertJsonPath('remaining', 9)->assertJsonPath('exhausted', false);

        $admin->refresh();
        $this->assertTrue(Hash::check('BrandNewPass!9', $admin->password));
        $this->assertDatabaseCount('personal_access_tokens', 0);

        $used = DB::table('admin_recovery_codes')->whereNotNull('used_at')->get();
        $this->assertCount(1, $used);
        $this->assertTrue(Hash::check($this->raw($codes[0]), $used->first()->code_hash));

        Mail::assertSent(AdminRecoveryCodeAlert::class, function (AdminRecoveryCodeAlert $mail) {
            return $mail->event === 'redeemed'
                && $mail->remaining === 9
                && $mail->hasTo('admin@cnsc.edu.ph');
        });
    }

    public function test_a_code_works_once_and_the_others_still_work(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin@cnsc.edu.ph',
            'recovery_code' => $codes[0],
            'new_password' => 'FirstPass!11',
            'new_password_confirmation' => 'FirstPass!11',
        ])->assertOk();

        // Second use of the same code is refused with the generic message.
        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin@cnsc.edu.ph',
            'recovery_code' => $codes[0],
            'new_password' => 'SecondPass!22',
            'new_password_confirmation' => 'SecondPass!22',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'That recovery code is not valid, or it has already been used.');

        $admin->refresh();
        $this->assertTrue(Hash::check('FirstPass!11', $admin->password));

        // A different code from the same set still works.
        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin@cnsc.edu.ph',
            'recovery_code' => $codes[1],
            'new_password' => 'ThirdPass!33',
            'new_password_confirmation' => 'ThirdPass!33',
        ])->assertOk()->assertJsonPath('remaining', 8);

        $this->assertTrue(Hash::check('ThirdPass!33', $admin->refresh()->password));
    }

    public function test_lower_case_and_missing_dash_are_both_accepted(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin',
            'recovery_code' => strtolower($this->raw($codes[3])),
            'new_password' => 'TypedLower!44',
            'new_password_confirmation' => 'TypedLower!44',
        ])->assertOk();

        $this->assertTrue(Hash::check('TypedLower!44', $admin->refresh()->password));
    }

    public function test_staff_and_customer_accounts_get_the_same_generic_failure(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        $staff = User::factory()->create([
            'role' => 'staff',
            'username' => 'staff_jane',
            'password' => Hash::make('StaffPass!1'),
        ]);

        foreach (['staff_jane', 'ghost_user_404'] as $login) {
            $this->postJson('/api/forgot-password/recovery-code', [
                'login' => $login,
                'recovery_code' => $codes[0],
                'new_password' => 'ShouldNotApply!1',
                'new_password_confirmation' => 'ShouldNotApply!1',
            ])->assertStatus(422)
                ->assertJsonPath('message', 'That recovery code is not valid, or it has already been used.');
        }

        $this->assertTrue(Hash::check('StaffPass!1', $staff->refresh()->password));
        $this->assertDatabaseCount('admin_recovery_codes', 10);
        $this->assertSame(10, DB::table('admin_recovery_codes')->whereNull('used_at')->count());
    }

    public function test_regenerating_cancels_every_previous_code(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $first = $this->generateCodes($admin);
        $second = $this->generateCodes($admin);

        $this->assertDatabaseCount('admin_recovery_codes', 10);
        $this->assertEmpty(array_intersect($first, $second), 'A new set must not reissue an old code.');

        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin',
            'recovery_code' => $first[0],
            'new_password' => 'ShouldNotApply!2',
            'new_password_confirmation' => 'ShouldNotApply!2',
        ])->assertStatus(422);

        $this->assertTrue(Hash::check(self::ADMIN_PASSWORD, $admin->refresh()->password));

        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin',
            'recovery_code' => $second[0],
            'new_password' => 'FreshSetWorks!3',
            'new_password_confirmation' => 'FreshSetWorks!3',
        ])->assertOk();

        Mail::assertSent(
            AdminRecoveryCodeAlert::class,
            fn (AdminRecoveryCodeAlert $mail) => $mail->event === 'regenerated'
        );
    }

    public function test_all_ten_codes_can_be_spent_and_a_fresh_set_issued_immediately(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        foreach (array_values($codes) as $index => $code) {
            $password = 'Rotate' . $index . '!Pass';

            $this->postJson('/api/forgot-password/recovery-code', [
                'login' => 'admin',
                'recovery_code' => $code,
                'new_password' => $password,
                'new_password_confirmation' => $password,
            ])->assertOk()
                ->assertJsonPath('remaining', 9 - $index)
                ->assertJsonPath('exhausted', $index === 9);
        }

        $this->assertSame(0, DB::table('admin_recovery_codes')->whereNull('used_at')->count());

        $admin->refresh();
        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/recovery-codes')
            ->assertOk()
            ->assertJsonPath('remaining', 0)
            ->assertJsonPath('total', 10);

        // With every code spent, a new set must still be one click away.
        $refill = $this->postJson('/api/admin/recovery-codes/generate', [
            'current_password' => 'Rotate9!Pass',
        ])->assertOk();

        $this->assertCount(10, $refill->json('codes'));
        $this->assertEmpty(array_intersect($codes, $refill->json('codes')));
        $this->assertSame(10, DB::table('admin_recovery_codes')->whereNull('used_at')->count());
    }

    public function test_successful_regeneration_is_not_rate_limited(): void
    {
        Mail::fake();
        $admin = $this->admin();

        // Well past the 5-attempt allowance, which only counts wrong passwords.
        for ($i = 0; $i < 8; $i++) {
            $this->generateCodes($admin);
        }

        $this->assertDatabaseCount('admin_recovery_codes', 10);
    }

    public function test_redeeming_is_throttled_after_five_wrong_codes(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $codes = $this->generateCodes($admin);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/forgot-password/recovery-code', [
                'login' => 'admin',
                'recovery_code' => 'ZZZZZ-ZZZZ' . $i,
                'new_password' => 'GuessPass!1',
                'new_password_confirmation' => 'GuessPass!1',
            ])->assertStatus(422);
        }

        // Even a genuine code is refused once the allowance is gone.
        $blocked = $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin',
            'recovery_code' => $codes[0],
            'new_password' => 'GuessPass!1',
            'new_password_confirmation' => 'GuessPass!1',
        ])->assertStatus(429);

        $this->assertGreaterThan(0, $blocked->json('retry_after_seconds'));
        $this->assertTrue(Hash::check(self::ADMIN_PASSWORD, $admin->refresh()->password));
        $this->assertSame(10, DB::table('admin_recovery_codes')->whereNull('used_at')->count());
    }

    public function test_the_feature_fails_soft_when_the_migration_has_not_been_run(): void
    {
        Mail::fake();
        $admin = $this->admin();

        Schema::drop('admin_recovery_codes');

        Sanctum::actingAs($admin);
        $this->getJson('/api/admin/recovery-codes')
            ->assertOk()
            ->assertJsonPath('supported', false)
            ->assertJsonPath('remaining', 0);

        $this->postJson('/api/admin/recovery-codes/generate', [
            'current_password' => self::ADMIN_PASSWORD,
        ])->assertStatus(422)->assertJsonPath('supported', false);

        $this->postJson('/api/forgot-password/recovery-code', [
            'login' => 'admin',
            'recovery_code' => 'ABCDE-FGHJK',
            'new_password' => 'NoTablePass!1',
            'new_password_confirmation' => 'NoTablePass!1',
        ])->assertStatus(422)->assertJsonPath('supported', false);

        $this->assertTrue(Hash::check(self::ADMIN_PASSWORD, $admin->refresh()->password));
    }
}
