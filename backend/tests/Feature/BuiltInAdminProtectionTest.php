<?php

namespace Tests\Feature;

use App\Models\{Order, Payment, User};
use App\Support\AdminAccounts;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{DB, Hash, Http, Mail, Schema};
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class BuiltInAdminProtectionTest extends TestCase
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

    private function original(): User
    {
        return User::factory()->create(['role' => 'admin', 'is_builtin_admin' => true, 'username' => 'original_admin']);
    }

    public function test_peer_admin_cannot_delete_original_via_directory_individual_or_bulk_endpoints(): void
    {
        $original = $this->original();
        $peer = User::factory()->create(['role' => 'admin']);
        $customer = User::factory()->create(['role' => 'customer']);
        $original->createToken('original');
        Sanctum::actingAs($peer);
        $rows = collect($this->getJson('/api/users')->assertOk()->json('data'));
        $this->assertTrue($rows->firstWhere('id', $original->id)['is_builtin_admin']);
        $this->assertFalse($rows->firstWhere('id', $original->id)['can_delete']);
        $this->assertStringContainsString('built-in Admin', $rows->firstWhere('id', $original->id)['delete_block_reason']);
        $this->deleteJson('/api/users/'.$original->id)->assertUnprocessable()->assertJsonFragment(['message' => 'The built-in Admin account is protected and cannot be deleted.']);
        $this->deleteJson('/api/users/delete-bulk', ['ids' => [$original->id, $peer->id, $customer->id]])
            ->assertOk()->assertJsonPath('processed_ids', [$customer->id])->assertJsonPath('skipped_ids', [$original->id, $peer->id]);
        $this->assertNotNull(User::find($original->id));
        $this->assertNotNull(User::find($peer->id));
        $this->assertEquals(1, $original->tokens()->count());
        $this->assertSoftDeleted($customer);
    }

    public function test_original_can_delete_other_admin_staff_and_customer_with_retained_records(): void
    {
        $original = $this->original();
        $peer = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $customer = User::factory()->create(['role' => 'customer']);
        $job = DB::table('appointment_product_jobs')->insertGetId(['customer_id' => $customer->id, 'service_name' => 'Fixture service', 'request_key' => 'retained-job', 'requirements' => '{}']);
        $quote = DB::table('appointment_product_quotes')->insertGetId(['job_id' => $job, 'version' => 1, 'request_key' => 'retained-quote', 'agreement' => '{}', 'total_centavos' => 10000, 'created_by' => $peer->id, 'sent_at' => now(), 'expires_at' => now()->addDay()]);
        $message = DB::table('appointment_product_messages')->insertGetId(['job_id' => $job, 'sender_id' => $peer->id, 'sender_name' => $peer->name, 'sender_role' => 'admin', 'body' => 'Retain this agreement', 'request_key' => 'retained-note']);
        $order = Order::create(['order_no' => 'KEEP-01', 'customer_id' => $customer->id, 'customer_name' => $customer->name,
            'customer_contact' => $customer->email, 'quantity' => 1, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'cash', 'fulfillment_type' => 'pickup', 'lifecycle_status' => 'pending', 'customer_stage' => 'to_ship']);
        $payment = Payment::create(['order_id' => $order->id, 'payment_no' => 'KEEP-PAY-01', 'method' => 'cash', 'amount' => 100, 'status' => 'paid', 'paid_at' => now()]);
        $receipt = DB::table('appointment_cash_entries')->insertGetId(['payment_id' => $payment->id, 'kind' => 'receipt', 'amount_centavos' => 10000, 'receipt_reference' => 'KEEP-RECEIPT', 'request_key' => 'retained-cash', 'actor_id' => $staff->id, 'confirmed_at' => now(), 'created_at' => now()]);
        $original->createToken('keep');
        foreach ([$peer, $staff, $customer] as $user) $user->createToken('remove');
        Sanctum::actingAs($original);
        $rows = collect($this->getJson('/api/users')->assertOk()->json('data'));
        foreach ([$peer, $staff, $customer] as $user) $this->assertTrue($rows->firstWhere('id', $user->id)['can_delete']);
        $this->deleteJson('/api/users/delete-bulk', ['ids' => [$original->id, $peer->id, $staff->id, $customer->id]])
            ->assertOk()->assertJsonPath('processed_count', 3)->assertJsonPath('skipped_ids', [$original->id]);
        foreach ([$peer, $staff, $customer] as $user) {
            $this->assertSoftDeleted($user);
            $this->assertNull(User::find($user->id));
            $this->assertEquals(0, $user->tokens()->count());
        }
        $this->assertEquals(1, $original->tokens()->count());
        $this->getJson('/api/users')->assertOk()->assertJsonCount(1, 'data');
        $this->assertDatabaseHas('appointment_product_jobs', ['id' => $job, 'customer_id' => $customer->id]);
        $this->assertDatabaseHas('appointment_product_quotes', ['id' => $quote, 'created_by' => $peer->id]);
        $this->assertDatabaseHas('appointment_product_messages', ['id' => $message, 'sender_id' => $peer->id]);
        $this->assertDatabaseHas('appointment_cash_entries', ['id' => $receipt, 'actor_id' => $staff->id, 'amount_centavos' => 10000]);
        $this->assertSame($customer->name, $order->fresh()->customer->name);
        $this->assertSame('pending', $order->fresh()->lifecycle_status);
        $this->assertSame('to_ship', $order->fresh()->customer_stage);
        $this->assertSame('paid', $payment->fresh()->status);
        $this->deleteJson('/api/users/'.$customer->id)->assertNotFound();
        $this->deleteJson('/api/users/delete-bulk', ['ids' => [$customer->id]])->assertNotFound();
    }

    public function test_original_protection_survives_identity_changes_and_cannot_be_claimed_on_creation(): void
    {
        $original = $this->original();
        $peer = User::factory()->create(['role' => 'admin']);
        $original->update(['name' => 'Updated identity', 'username' => 'renamed_original', 'email' => 'renamed.original@gmail.com']);
        Sanctum::actingAs($peer);
        $this->deleteJson('/api/users/'.$original->id)->assertUnprocessable();
        $created = $this->postJson('/api/users', ['name' => 'New Admin', 'username' => 'new_admin', 'email' => 'new.admin@gmail.com',
            'role' => 'admin', 'password' => 'SeparatePass123!', 'password_confirmation' => 'SeparatePass123!', 'is_builtin_admin' => true])
            ->assertCreated()->json('data.id');
        $this->assertFalse(User::findOrFail($created)->isBuiltInAdmin());
        $this->assertTrue($original->fresh()->isBuiltInAdmin());
    }

    public function test_model_cannot_delete_force_delete_or_demote_original(): void
    {
        $original = $this->original();
        foreach (['delete', 'forceDelete'] as $method) {
            try { $original->$method(); $this->fail('Original was deleted'); }
            catch (HttpException $error) { $this->assertEquals(422, $error->getStatusCode()); }
        }
        try { $original->forceFill(['is_builtin_admin' => false])->save(); $this->fail('Protection was removed'); }
        catch (HttpException $error) { $this->assertEquals(422, $error->getStatusCode()); }
        $this->assertTrue($original->fresh()->isBuiltInAdmin());
    }

    public function test_removed_account_cannot_sign_in_recover_or_reuse_an_old_token(): void
    {
        $original = $this->original();
        $peer = User::factory()->create(['role' => 'admin', 'email' => 'removed.admin@gmail.com', 'username' => 'removed_admin', 'password' => Hash::make('RemovedPass123!')]);
        $token = $peer->createToken('removed')->plainTextToken;
        DB::table('admin_recovery_codes')->insert(['user_id' => $peer->id, 'code_hash' => Hash::make('REMOVED-RECOVERY-CODE'), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('sessions')->insert(['id' => 'removed-session', 'user_id' => $peer->id, 'payload' => 'fixture', 'last_activity' => time()]);
        AdminAccounts::delete($original, [$peer->id]);
        $this->assertDatabaseMissing('sessions', ['user_id' => $peer->id]);
        $this->assertDatabaseMissing('admin_recovery_codes', ['user_id' => $peer->id]);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['login' => $peer->username, 'password' => 'RemovedPass123!'])->assertUnauthorized();
        $this->postJson('/api/forgot-password/send-otp', ['email' => $peer->email, 'portal' => 'admin_staff'])->assertNotFound();
        $this->postJson('/api/forgot-password/recovery-code', ['login' => $peer->username, 'recovery_code' => 'REMOVED-RECOVERY-CODE', 'new_password' => 'ResurrectPass123!', 'new_password_confirmation' => 'ResurrectPass123!'])->assertUnprocessable();
        $this->assertEquals(0, $peer->tokens()->count());
    }

    public function test_google_cannot_recreate_a_removed_account(): void
    {
        $original = $this->original();
        $customer = User::factory()->create(['role' => 'customer', 'email' => 'removed.google@gmail.com']);
        AdminAccounts::delete($original, [$customer->id]);
        Http::fake(['https://www.googleapis.com/oauth2/v3/userinfo' => Http::response(['email' => $customer->email, 'email_verified' => true, 'name' => 'Removed customer', 'given_name' => 'Removed'])]);
        $this->postJson('/api/auth/google', ['access_token' => 'removed-google-token'])->assertForbidden();
        $this->assertEquals(2, User::withTrashed()->count());
        $this->assertEquals(0, $customer->tokens()->count());
    }

    public function test_migration_pins_original_once_and_never_transfers_protection(): void
    {
        $spectator = User::factory()->create(['role' => 'admin', 'is_spectator' => true]);
        $original = User::factory()->create(['role' => 'admin']);
        $peer = User::factory()->create(['role' => 'admin', 'username' => 'admin']);
        $migration = require database_path('migrations/2026_11_13_000004_protect_builtin_admin_and_retain_deleted_users.php');
        $migration->up();
        $this->assertTrue($original->fresh()->isBuiltInAdmin());
        $this->assertFalse($spectator->fresh()->isBuiltInAdmin());
        $this->assertFalse($peer->fresh()->isBuiltInAdmin());
        $original->update(['username' => 'changed_original']);
        $migration->up();
        $this->assertTrue($original->fresh()->isBuiltInAdmin());
        $this->assertEquals(1, User::where('is_builtin_admin', true)->count());
    }

    public function test_missing_migration_blocks_deletion_but_keeps_directory_and_sign_in_available(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'username' => 'schema_admin', 'password' => Hash::make('SchemaPass123!')]);
        $customer = User::factory()->create(['role' => 'customer']);
        foreach (['email', 'username'] as $column) {
            Schema::table('users', fn (Blueprint $table) => $table->dropUnique('users_active_'.$column.'_unique'));
            Schema::table('users', fn (Blueprint $table) => $table->dropColumn('active_'.$column));
        }
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['is_builtin_admin', 'deleted_at']));
        User::forgetSchemaColumnCache();
        Sanctum::actingAs($admin);
        $rows = $this->getJson('/api/users')->assertOk()->json('data');
        $this->assertFalse(collect($rows)->firstWhere('id', $customer->id)['can_delete']);
        $this->deleteJson('/api/users/'.$customer->id)->assertStatus(503)->assertSee('Account deletion protection is not installed');
        $this->assertDatabaseHas('users', ['id' => $customer->id]);
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['login' => $admin->username, 'password' => 'SchemaPass123!'])->assertOk();
    }
}
