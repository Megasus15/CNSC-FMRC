<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\URL;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AdminSpectatorTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'PresentationPass!2026';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(\Illuminate\Support\Carbon::parse('2026-09-22 01:00:00', 'UTC'));
        config(['services.turnstile.enabled' => false]);
        User::forgetSchemaColumnCache();
    }

    protected function tearDown(): void
    {
        User::forgetSchemaColumnCache();
        parent::tearDown();
    }

    private function spectator(): User
    {
        $user = User::factory()->create([
            'username' => 'presentation',
            'email' => 'presentation@fmrc.invalid',
            'role' => 'admin',
            'password' => Hash::make(self::PASSWORD),
        ]);

        $user->forceFill([
            'is_spectator' => true,
            'spectator_expires_at' => now()->addWeek(),
        ])->save();

        return $user->fresh();
    }

    private function bearer(User $user): string
    {
        $token = $user->createToken('spectator-test')->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token);

        return $token;
    }

    public function test_spectator_signs_in_as_admin_with_read_only_metadata(): void
    {
        $user = $this->spectator();

        $response = $this->postJson('/api/login', [
            'login' => $user->username,
            'password' => self::PASSWORD,
        ])->assertOk()
            ->assertJsonPath('user.role', 'admin')
            ->assertJsonPath('user.is_spectator', true);

        $this->assertNotEmpty($response->json('access_token'));
        $this->assertNotEmpty($response->json('user.spectator_expires_at'));
        $this->assertSame(1, $user->tokens()->count());
        $this->assertNull($response->json('user.password'));
    }

    public function test_spectator_can_read_admin_only_pages_and_all_main_module_feeds(): void
    {
        $this->bearer($this->spectator());

        foreach ([
            '/api/user',
            '/api/users',
            '/api/admin/email-templates',
            '/api/admin/staff-account-requests',
            '/api/admin/recovery-codes',
            '/api/admin/dashboard/summary',
            '/api/admin/dashboard/live-counts',
            '/api/admin/orders',
            '/api/admin/walkin-orders',
            '/api/admin/products',
            '/api/admin/services',
            '/api/admin/inventory',
            '/api/admin/returns',
            '/api/admin/ratings',
            '/api/admin/promotions',
            '/api/admin/announcements',
            '/api/admin/notifications',
            '/api/admin/customer-messages',
            '/api/admin/archives',
            '/api/admin/reports?category=appointments&period=yearly&year=2026',
            '/api/admin/product-analytics/top-selling',
            '/api/appointments',
            '/api/appointments/calendar',
            '/api/site-settings',
            '/api/maintenance',
        ] as $uri) {
            $this->getJson($uri)->assertOk();
        }

        $this->json('HEAD', '/api/admin/dashboard/live-counts')->assertOk();
    }

    public function test_spectator_reads_current_records_and_realtime_archive_counts(): void
    {
        $this->bearer($this->spectator());
        $this->getJson('/api/admin/dashboard/live-counts')
            ->assertOk()->assertJsonPath('data.archives.appointments', 0);

        $appointment = Appointment::create([
            'reference_no' => 'AP-SPECTATOR-LIVE',
            'first_name' => 'Live',
            'last_name' => 'Presentation',
            'status' => 'Pending',
        ]);

        $this->getJson('/api/appointments')->assertOk()
            ->assertJsonFragment(['reference_no' => 'AP-SPECTATOR-LIVE']);

        $appointment->update(['status' => 'Archived']);

        $response = $this->getJson('/api/admin/dashboard/live-counts')
            ->assertOk()->assertJsonPath('data.archives.appointments', 1);
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    /**
     * Nonexistent model IDs deliberately prove that refusal happens before
     * binding/validation, including appointment routes without auth middleware.
     */
    #[DataProvider('writeRoutes')]
    public function test_spectator_bearer_cannot_write_through_any_portal_or_public_route(string $method, string $uri): void
    {
        $user = $this->spectator();
        $original = $user->getRawOriginal();
        $this->bearer($user);

        $this->json($method, $uri, [
            'name' => 'Changed',
            'email' => 'changed@gmail.com',
            'password' => 'ChangedPassword!2026',
            'current_password' => self::PASSWORD,
            'is_spectator' => false,
            'role' => 'admin',
        ])->assertForbidden()->assertJsonPath('code', 'SPECTATOR_READ_ONLY');

        $this->assertSame($original, $user->fresh()->getRawOriginal());
        $this->assertDatabaseCount('site_settings', 0);
        $this->assertDatabaseCount('appointments', 0);
        $this->assertDatabaseCount('admin_recovery_codes', 0);
    }

    public static function writeRoutes(): array
    {
        return [
            'create account' => ['POST', '/api/users'],
            'delete account' => ['DELETE', '/api/users/999999'],
            'own account' => ['PUT', '/api/user'],
            'password' => ['POST', '/api/change-password'],
            'confirm email' => ['POST', '/api/user/email-change/confirm'],
            'recovery codes' => ['POST', '/api/admin/recovery-codes/generate'],
            'create product' => ['POST', '/api/admin/products'],
            'edit product' => ['PUT', '/api/admin/products/999999'],
            'delete product' => ['DELETE', '/api/admin/products/999999'],
            'approve order' => ['POST', '/api/admin/orders/999999/approve'],
            'payment' => ['PATCH', '/api/admin/orders/999999/payment-status'],
            'tracking' => ['PATCH', '/api/admin/orders/999999/tracking'],
            'deduct stock' => ['POST', '/api/admin/inventory/999999/deduct'],
            'site content' => ['PUT', '/api/admin/site-settings'],
            'maintenance' => ['PUT', '/api/admin/maintenance'],
            'report logging' => ['POST', '/api/admin/reports/generate'],
            'archive auto delete' => ['POST', '/api/admin/archives/auto-delete'],
            'mark notifications read' => ['POST', '/api/admin/notifications/mark-all-read'],
            'mark inquiry read' => ['PATCH', '/api/admin/customer-messages/999999/read'],
            'public appointment create' => ['POST', '/api/appointments'],
            'public appointment delete' => ['DELETE', '/api/appointments/999999'],
            'public appointment archive' => ['PATCH', '/api/appointments/999999/archive'],
            'public appointment restore' => ['PATCH', '/api/appointments/999999/unarchive'],
            'public calendar edit' => ['PUT', '/api/appointments/calendar'],
            'customer profile' => ['PUT', '/api/customer/profile'],
            'customer cart' => ['POST', '/api/customer/cart/sync'],
        ];
    }

    public function test_real_appointment_and_own_account_remain_unchanged_after_denied_writes(): void
    {
        $user = $this->spectator();
        $this->bearer($user);
        $appointment = Appointment::create([
            'reference_no' => 'AP-SPECTATOR-PRESERVE',
            'first_name' => 'Preserved',
            'last_name' => 'Appointment',
            'status' => 'Pending',
        ]);

        $this->patchJson('/api/appointments/'.$appointment->id.'/archive')->assertForbidden();
        $this->deleteJson('/api/appointments/'.$appointment->id)->assertForbidden();
        $this->deleteJson('/api/users/'.$user->id)->assertForbidden();

        $this->assertSame('Pending', $appointment->fresh()->status);
        $this->assertNotNull($user->fresh());
        $this->assertTrue($user->fresh()->is_spectator);
    }

    public function test_spectator_may_preview_email_drafts_without_saving_them(): void
    {
        $this->bearer($this->spectator());

        $response = $this->postJson('/api/admin/email-templates/preview', [
            'slug' => 'order_received',
            'parts' => ['body_heading' => 'Presentation draft only'],
        ])->assertOk()->assertJsonPath('data.slug', 'order_received');

        $this->assertStringContainsString('Presentation draft only', $response->json('data.html'));
        $this->assertDatabaseCount('site_settings', 0);
    }

    public function test_reading_calendar_and_expired_email_change_does_not_seed_or_delete_data(): void
    {
        $user = $this->spectator();
        $this->bearer($user);
        DB::table('email_change_requests')->insert([
            'user_id' => $user->id,
            'new_email' => 'unused@gmail.com',
            'otp_hash' => Hash::make('123456'),
            'expires_at' => now()->subMinute(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->getJson('/api/appointments/calendar')->assertOk();
        $this->getJson('/api/user/email-change')->assertOk()->assertJsonPath('pending', false);

        $this->assertDatabaseCount('appointment_time_slots', 0);
        $this->assertDatabaseCount('email_change_requests', 1);
    }

    public function test_web_session_cannot_edit_password_profile_or_verify_email(): void
    {
        $user = $this->spectator()->forceFill(['email_verified_at' => null]);
        $user->save();
        $this->actingAs($user, 'web');

        $this->patchJson('/profile', ['name' => 'Changed', 'email' => 'changed@gmail.com'])
            ->assertForbidden()->assertJsonPath('code', 'SPECTATOR_READ_ONLY');
        $this->putJson('/password', [
            'current_password' => self::PASSWORD,
            'password' => 'ChangedPassword!2026',
            'password_confirmation' => 'ChangedPassword!2026',
        ])->assertForbidden()->assertJsonPath('code', 'SPECTATOR_READ_ONLY');
        $this->deleteJson('/profile', ['password' => self::PASSWORD])
            ->assertForbidden()->assertJsonPath('code', 'SPECTATOR_READ_ONLY');

        $url = URL::temporarySignedRoute('verification.verify', now()->addMinutes(30), [
            'id' => $user->id,
            'hash' => sha1($user->email),
        ]);
        $this->getJson($url)->assertForbidden()->assertJsonPath('code', 'SPECTATOR_READ_ONLY');

        $this->assertNull($user->fresh()->email_verified_at);
        $this->assertTrue(Hash::check(self::PASSWORD, $user->fresh()->password));
    }

    #[DataProvider('normalRoles')]
    public function test_normal_admin_and_staff_keep_existing_write_access(string $role): void
    {
        $user = User::factory()->create(['role' => $role]);
        $this->bearer($user);

        $this->putJson('/api/admin/site-settings', ['hero_title' => 'Saved by '.$role])->assertOk();
        $this->assertSame('Saved by '.$role, SiteSetting::get('hero_title'));
        $this->assertFalse((bool) $user->fresh()->is_spectator);
    }

    public static function normalRoles(): array
    {
        return [['admin'], ['staff']];
    }

    public function test_expired_spectator_cannot_login_or_keep_reading_with_an_existing_token(): void
    {
        $user = $this->spectator();
        $token = $this->bearer($user);
        $this->getJson('/api/admin/dashboard/live-counts')->assertOk();
        $this->travel(8)->days();

        $this->getJson('/api/admin/dashboard/live-counts')
            ->assertForbidden()->assertJsonPath('code', 'SPECTATOR_EXPIRED');

        $this->withoutToken();
        $this->app['auth']->forgetGuards();
        $tokenCount = $user->tokens()->count();
        $this->postJson('/api/login', [
            'login' => $user->username,
            'password' => self::PASSWORD,
        ])->assertForbidden()->assertJsonPath('code', 'SPECTATOR_EXPIRED');
        $this->assertSame($tokenCount, $user->tokens()->count());

        // Ending a session remains possible after the presentation window ends.
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/logout')->assertOk();
        $this->assertSame(0, $user->tokens()->count());
    }

    public function test_logout_revokes_the_spectator_token(): void
    {
        $user = $this->spectator();
        $this->bearer($user);

        $this->postJson('/api/logout')->assertOk();
        $this->assertSame(0, $user->tokens()->count());
        $this->assertNotNull($user->fresh());
    }

    public function test_missing_expiry_does_not_grant_unlimited_spectator_access(): void
    {
        $user = $this->spectator();
        $user->forceFill(['spectator_expires_at' => null])->save();
        $this->bearer($user);

        $this->getJson('/api/users')->assertForbidden()->assertJsonPath('code', 'SPECTATOR_EXPIRED');
    }

    public function test_expired_spectator_cannot_start_a_web_session(): void
    {
        $user = $this->spectator();
        $this->travel(8)->days();

        $this->postJson('/login', [
            'email' => $user->email,
            'password' => self::PASSWORD,
        ])->assertUnprocessable()->assertJsonValidationErrors('email');

        $this->assertGuest('web');
    }

    public function test_provisioning_creates_one_temporary_spectator_and_does_not_rotate_or_extend_it_on_rerun(): void
    {
        $this->freezeTime();
        $this->assertSame(0, Artisan::call('admin:spectator'));
        $this->assertSame(1, preg_match('/Password: ([A-Za-z0-9]+)/', Artisan::output(), $passwordMatch));

        $user = User::where('username', 'presentation')->sole();
        $this->assertSame('presentation@fmrc.invalid', $user->email);
        $this->assertSame('admin', $user->role);
        $this->assertTrue($user->is_spectator);
        $this->assertSame('2026-10-05 15:59:59', $user->spectator_expires_at->toDateTimeString());
        $this->assertGreaterThanOrEqual(20, strlen($passwordMatch[1]));
        $this->assertTrue(Hash::check($passwordMatch[1], $user->password));
        $original = $user->fresh()->getRawOriginal();
        $this->travel(1)->days();

        $this->artisan('admin:spectator')->assertSuccessful();

        $this->assertDatabaseCount('users', 1);
        $this->assertSame($original, $user->fresh()->getRawOriginal());
    }

    public function test_explicit_october_fifth_expiry_updates_only_the_presentation_account(): void
    {
        $user = $this->spectator();
        $ordinary = User::factory()->create(['role' => 'admin']);
        $passwordHash = $user->password;
        $ordinaryOriginal = $ordinary->fresh()->getRawOriginal();
        $token = $user->createToken('presentation')->plainTextToken;

        $this->artisan('admin:spectator', ['--expires' => '2026-10-05'])->assertSuccessful();

        $this->assertSame($passwordHash, $user->fresh()->password);
        $this->assertTrue($user->fresh()->is_spectator);
        $this->assertSame('2026-10-05 15:59:59', $user->fresh()->spectator_expires_at->toDateTimeString());
        $this->assertSame($ordinaryOriginal, $ordinary->fresh()->getRawOriginal());
        $this->travelTo(\Illuminate\Support\Carbon::parse('2026-10-05 23:59:58', 'Asia/Manila')->utc());
        $this->assertFalse($user->fresh()->spectatorHasExpired(), 'Now: '.now()->toIso8601String().' Expiry: '.$user->fresh()->spectator_expires_at->toIso8601String());
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user')->assertOk();
        $this->travelTo(\Illuminate\Support\Carbon::parse('2026-10-06 00:00:00', 'Asia/Manila')->utc());
        $this->getJson('/api/user')->assertForbidden()->assertJsonPath('code', 'SPECTATOR_EXPIRED');
    }

    public function test_creation_honors_explicit_expiry_and_invalid_dates_leave_accounts_untouched(): void
    {
        foreach (['2026-02-30', '2026-09-01', 'not-a-date'] as $date) {
            $this->artisan('admin:spectator', ['--expires' => $date])->assertFailed();
            $this->assertDatabaseCount('users', 0);
        }

        $this->artisan('admin:spectator', ['--expires' => '2026-10-05'])->assertSuccessful();
        $user = User::where('username', 'presentation')->sole();
        $this->assertSame('2026-10-05 15:59:59', $user->spectator_expires_at->toDateTimeString());
        $original = $user->getRawOriginal();
        $this->artisan('admin:spectator', ['--expires' => '2026-09-01'])->assertFailed();
        $this->assertSame($original, $user->fresh()->getRawOriginal());
    }

    public function test_removal_deletes_only_the_built_in_spectator_and_its_tokens(): void
    {
        $spectator = $this->spectator();
        $ordinary = User::factory()->create(['role' => 'admin']);
        $spectator->createToken('presentation');
        $ordinary->createToken('ordinary-admin');

        $this->artisan('admin:spectator', ['--remove' => true])->assertSuccessful();

        $this->assertDatabaseMissing('users', ['id' => $spectator->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_id' => $spectator->id]);
        $this->assertNotNull($ordinary->fresh());
        $this->assertSame(1, $ordinary->tokens()->count());
    }

    #[DataProvider('identityCollisions')]
    public function test_command_refuses_to_adopt_or_remove_an_ordinary_account_with_a_reserved_identity(array $identity): void
    {
        $user = User::factory()->create($identity + ['role' => 'admin']);
        $user->createToken('must-survive');
        $original = $user->fresh()->getRawOriginal();

        $this->artisan('admin:spectator')->assertFailed();
        $this->artisan('admin:spectator', ['--remove' => true])->assertFailed();

        $this->assertDatabaseCount('users', 1);
        $this->assertSame($original, $user->fresh()->getRawOriginal());
        $this->assertSame(1, $user->tokens()->count());
    }

    public static function identityCollisions(): array
    {
        return [
            'username' => [['username' => 'presentation']],
            'email' => [['email' => 'presentation@fmrc.invalid']],
        ];
    }

    private function spectatorMigration(): Migration
    {
        return require database_path('migrations/2027_01_07_000000_add_spectator_access_to_users_table.php');
    }

    public function test_command_refuses_to_create_an_unrestricted_admin_when_migration_is_missing(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn(['is_spectator', 'spectator_expires_at']);
        });

        try {
            $this->artisan('admin:spectator')->assertFailed();
            $this->assertDatabaseCount('users', 0);
        } finally {
            $this->spectatorMigration()->up();
        }
    }

    public function test_command_refreshes_a_user_column_cache_primed_before_the_migration(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn(['is_spectator', 'spectator_expires_at']);
        });
        User::forgetSchemaColumnCache();
        $ordinary = User::factory()->create(['role' => 'admin']);
        $this->assertFalse($ordinary->hasSchemaColumns(['is_spectator']));
        $this->spectatorMigration()->up();

        $this->artisan('admin:spectator')->assertSuccessful();

        $spectator = User::where('username', 'presentation')->sole();
        $this->assertTrue($spectator->is_spectator);
        $this->assertNotNull($spectator->spectator_expires_at);
        $this->assertFalse((bool) $ordinary->fresh()->is_spectator);
        $this->bearer($spectator);
        $this->putJson('/api/admin/site-settings', ['hero_title' => 'Must not save'])
            ->assertForbidden()->assertJsonPath('code', 'SPECTATOR_READ_ONLY');
    }

    public function test_rollback_refuses_to_remove_restrictions_while_a_spectator_exists(): void
    {
        $spectator = $this->spectator();
        $ordinary = User::factory()->create(['role' => 'admin']);
        $migration = $this->spectatorMigration();

        try {
            $migration->down();
            $this->fail('Rollback must not turn a spectator into an unrestricted admin.');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('Remove spectator accounts', $error->getMessage());
        }

        $this->assertTrue(Schema::hasColumns('users', ['is_spectator', 'spectator_expires_at']));
        $this->assertTrue($spectator->fresh()->is_spectator);
        $this->artisan('admin:spectator', ['--remove' => true])->assertSuccessful();

        try {
            $migration->down();
            $this->assertFalse(Schema::hasColumn('users', 'is_spectator'));
            $this->assertNotNull($ordinary->fresh());
        } finally {
            $migration->up();
        }
    }
}
