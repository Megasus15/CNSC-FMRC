<?php

namespace Tests\Feature;

use App\Models\{Order, User};
use App\Support\AdminAccounts;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Hash, Http, Mail, Schema};
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReusableAccountIdentifiersTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        User::forgetSchemaColumnCache();
        Mail::fake();
    }

    protected function tearDown(): void
    {
        User::forgetSchemaColumnCache();
        parent::tearDown();
    }

    private function payload(array $extra = []): array
    {
        return $extra + ['name' => 'New Account', 'username' => 'reusable_account', 'email' => 'reusable.account@gmail.com',
            'role' => 'admin', 'password' => 'FreshPassword123!', 'password_confirmation' => 'FreshPassword123!'];
    }

    public function test_already_deleted_accounts_can_be_reused_without_restoring_or_sharing_their_history(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'is_builtin_admin' => true]);
        $removed = User::factory()->create(['role' => 'customer', 'username' => 'reusable_account', 'email' => 'reusable.account@gmail.com', 'password' => Hash::make('OldPassword123!')]);
        $oldToken = $removed->createToken('removed')->plainTextToken;
        $order = Order::create(['order_no' => 'OLD-IDENTITY-01', 'customer_id' => $removed->id, 'customer_name' => $removed->name,
            'customer_contact' => $removed->email, 'quantity' => 1, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'cash', 'fulfillment_type' => 'pickup']);
        AdminAccounts::delete($admin, [$removed->id]);
        Sanctum::actingAs($admin);
        $created = $this->postJson('/api/users', $this->payload())->assertCreated()->assertJsonMissingPath('data.active_email')->assertJsonMissingPath('data.active_username')->json('data.id');
        $this->assertNotEquals($removed->id, $created);
        $this->assertSoftDeleted($removed);
        $this->assertSame($removed->id, $order->fresh()->customer_id);
        $this->assertSame($removed->name, $order->fresh()->customer->name);
        $this->assertSame('reusable.account@gmail.com', $order->fresh()->customer->email);
        $this->assertEquals(0, User::findOrFail($created)->orders()->count());
        $rows = collect($this->getJson('/api/users')->assertOk()->json('data'));
        $this->assertFalse($rows->contains('id', $removed->id));
        $this->assertTrue($rows->contains('id', $created));
        $this->app['auth']->forgetGuards();
        $this->withToken($oldToken)->getJson('/api/user')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['login' => 'reusable_account', 'password' => 'OldPassword123!'])->assertUnauthorized();
        $this->postJson('/api/login', ['login' => 'reusable_account', 'password' => 'FreshPassword123!'])->assertOk()->assertJsonPath('user.id', $created);
    }

    public function test_active_accounts_still_return_one_specific_validation_message_per_duplicate_field(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        User::factory()->create(['role' => 'staff', 'username' => 'reusable_account', 'email' => 'reusable.account@gmail.com']);
        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/users', $this->payload())->assertUnprocessable()->assertJsonValidationErrors(['email', 'username']);
        $this->assertSame(['This Gmail address is already used by an active account.'], $response->json('errors.email'));
        $this->assertSame(['This username is already used by an active account.'], $response->json('errors.username'));
        $this->assertDatabaseCount('users', 2);
    }

    public function test_database_enforces_active_email_and_username_uniqueness_even_without_validation(): void
    {
        $original = User::factory()->create(['email' => 'unique.active@gmail.com', 'username' => 'unique_active']);
        foreach ([['email' => $original->email, 'username' => 'another_name'], ['email' => 'another.active@gmail.com', 'username' => $original->username]] as $identifiers) {
            try {
                DB::transaction(fn () => User::factory()->create($identifiers));
                $this->fail('Duplicate active identity was accepted');
            } catch (UniqueConstraintViolationException $error) {
                $this->assertStringContainsString('active_', $error->getMessage());
            }
        }
        $this->assertEquals(1, User::count());
    }

    public function test_google_uses_the_new_active_identity_instead_of_the_older_deleted_record(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $removed = User::factory()->create(['role' => 'customer', 'email' => 'reusable.account@gmail.com']);
        AdminAccounts::delete($admin, [$removed->id]);
        $current = User::factory()->create(['role' => 'staff', 'email' => $removed->email]);
        Http::fake(['https://www.googleapis.com/oauth2/v3/userinfo' => Http::response(['email' => $current->email, 'email_verified' => true, 'name' => 'Current identity', 'given_name' => 'Current'])]);
        $this->postJson('/api/auth/google', ['access_token' => 'new-identity-google-token'])->assertOk()->assertJsonPath('user.id', $current->id)->assertJsonPath('user.role', 'staff');
        $this->assertSoftDeleted($removed);
        $this->assertEquals(0, $removed->tokens()->count());
    }

    public function test_staff_requests_can_use_a_deleted_identity_and_approval_creates_a_fresh_user(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $removed = User::factory()->create(['role' => 'staff', 'username' => 'reusable_account', 'email' => 'reusable.account@gmail.com']);
        AdminAccounts::delete($admin, [$removed->id]);
        $this->postJson('/api/staff-account-requests', $this->payload())->assertCreated();
        $requestId = DB::table('staff_account_requests')->where('email', $removed->email)->value('id');
        Sanctum::actingAs($admin);
        $this->postJson('/api/admin/staff-account-requests/'.$requestId.'/approve')->assertOk();
        $current = User::where('email', $removed->email)->firstOrFail();
        $this->assertNotEquals($removed->id, $current->id);
        $this->assertSame('staff', $current->role);
        $this->assertSoftDeleted($removed);
    }

    public function test_migration_applies_to_existing_deleted_rows_and_is_safe_to_rerun(): void
    {
        $migration = require database_path('migrations/2026_11_13_000005_allow_reusing_deleted_account_identifiers.php');
        $migration->down();
        User::forgetSchemaColumnCache();
        $removed = User::factory()->create(['email' => 'upgrade.deleted@gmail.com', 'username' => 'upgrade_deleted']);
        $removed->delete();
        $migration->up();
        $migration->up();
        User::forgetSchemaColumnCache();
        $current = User::factory()->create(['email' => $removed->email, 'username' => $removed->username]);
        $this->assertNotEquals($removed->id, $current->id);
        $this->assertSoftDeleted($removed);
        $this->assertNull(DB::table('users')->where('id', $removed->id)->value('active_email'));
        $this->assertTrue(Schema::hasIndex('users', 'users_active_email_unique'));
        try { $migration->down(); $this->fail('Rollback would invalidate reused identities'); }
        catch (\RuntimeException $error) { $this->assertStringContainsString('Cannot roll back reusable', $error->getMessage()); }
        $this->assertNotNull(User::find($current->id));
        $this->assertSoftDeleted($removed);
    }
}
