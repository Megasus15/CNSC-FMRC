<?php

namespace Tests\Feature;

use App\Models\AdminNotification;
use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\Payment;
use App\Models\Promotion;
use App\Models\User;
use App\Services\PayMongoService;
use App\Services\PwaNotifications;
use App\Services\PwaPushTransport;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PwaTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['pwa.push_enabled' => true, 'pwa.vapid.public_key' => rtrim(strtr(base64_encode("\x04".str_repeat('v', 64)), '+/', '-_'), '='),
            'pwa.vapid.private_key' => rtrim(strtr(base64_encode(str_repeat('s', 32)), '+/', '-_'), '=')]);
        DB::table('pwa_runtime')->insert(['key' => 'processor', 'value' => now()]);
    }

    private function headers(?User $user = null, ?array $device = null): array
    {
        $this->app['auth']->forgetGuards();

        return ($user ? ['Authorization' => 'Bearer '.$user->createToken('pwa-test')->plainTextToken] : [])
            + ($device ? ['X-FMRC-Device' => $device['credential']] : []);
    }

    private function subscription(string $app = 'customer'): array
    {
        return ['app' => $app, 'public_alerts' => $app === 'customer', 'account_alerts' => $app === 'team', 'subscription' => [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/'.bin2hex(random_bytes(10)),
            'keys' => ['p256dh' => rtrim(strtr(base64_encode("\x04".str_repeat('k', 64)), '+/', '-_'), '='),
                'auth' => rtrim(strtr(base64_encode(str_repeat('a', 16)), '+/', '-_'), '=')],
        ]];
    }

    private function device(?User $user = null, string $app = 'customer'): array
    {
        $body = $this->subscription($app);
        $body['account_alerts'] = (bool) $user;

        return $this->postJson('/api/pwa/subscriptions', $body, $this->headers($user))->assertOk()->json();
    }

    public function test_push_requires_schema_keys_feature_flag_and_recent_processor(): void
    {
        $this->getJson('/api/pwa/config')->assertJsonPath('push_available', true)->assertJsonMissingPath('private_key');
        config(['pwa.push_enabled' => false]);
        $this->getJson('/api/pwa/config')->assertJsonPath('push_available', false)->assertJsonPath('public_key', null);
        $this->postJson('/api/pwa/subscriptions', $this->subscription())->assertStatus(503);
        config(['pwa.push_enabled' => true]);
        DB::table('pwa_runtime')->update(['value' => now()->subMinutes(4)]);
        $this->getJson('/api/pwa/config')->assertJsonPath('push_available', false);
        Schema::drop('pwa_runtime');
        $this->getJson('/api/pwa/config')->assertOk()->assertJsonPath('inbox_available', false);
        Order::create(['customer_name' => 'Unowned guest']); // Existing business writes still work before rollout.
    }

    public function test_guest_and_role_registration_reject_private_access_and_arbitrary_endpoints(): void
    {
        $body = $this->subscription();
        $body['account_alerts'] = true;
        $this->postJson('/api/pwa/subscriptions', $body)->assertUnauthorized();
        $this->postJson('/api/pwa/subscriptions', $this->subscription('team'))->assertForbidden();
        $body = $this->subscription();
        $body['user_id'] = 123;
        $this->postJson('/api/pwa/subscriptions', $body)->assertUnprocessable();
        foreach (['https://127.0.0.1/push', 'https://fcm.googleapis.com.evil.test/push', 'http://fcm.googleapis.com/push', 'https://fcm.googleapis.com:444/push', 'https://user@fcm.googleapis.com/push'] as $url) {
            $body = $this->subscription();
            $body['subscription']['endpoint'] = $url;
            $this->postJson('/api/pwa/subscriptions', $body)->assertUnprocessable();
        }
        $customer = User::factory()->create(['role' => 'customer']);
        $this->postJson('/api/pwa/subscriptions', $this->subscription('team'), $this->headers($customer))->assertForbidden();
    }

    public function test_device_credentials_account_switch_and_logout_preserve_only_customer_public_opt_in(): void
    {
        $first = User::factory()->create(['role' => 'customer']);
        $second = User::factory()->create(['role' => 'customer']);
        $device = $this->device($first);
        $attempt = $this->subscription();
        $attempt['subscription']['endpoint'] = DB::table('pwa_subscriptions')->find($device['id'])->endpoint;
        $this->postJson('/api/pwa/subscriptions', $attempt, $this->headers($second))->assertStatus(409);
        $this->patchJson('/api/pwa/subscriptions/'.$device['id'], ['account_alerts' => false], $this->headers())->assertNotFound();
        $this->patchJson('/api/pwa/subscriptions/'.$device['id'], ['bind' => true], $this->headers($second, $device))->assertOk()->assertJsonPath('user_id', $second->id);
        $this->postJson('/api/logout', [], $this->headers($second, $device))->assertOk();
        $this->assertDatabaseHas('pwa_subscriptions', ['id' => $device['id'], 'user_id' => null, 'account_alerts' => false, 'public_alerts' => true]);
        $this->patchJson('/api/pwa/subscriptions/'.$device['id'], ['account_alerts' => true], $this->headers(null, $device))->assertUnauthorized();
        $this->deleteJson('/api/pwa/subscriptions/'.$device['id'], [], $this->headers(null, $device))->assertOk();
    }

    public function test_operator_grant_survives_session_expiry_but_explicit_logout_and_security_changes_revoke_it(): void
    {
        $staff = User::factory()->create(['role' => 'staff']);
        $device = $this->device($staff, 'team');
        $expired = $staff->createToken('expired', ['*'], now()->subMinute())->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/admin/session', ['Authorization' => 'Bearer '.$expired])->assertUnauthorized();
        $this->patchJson('/api/pwa/subscriptions/'.$device['id'], ['account_alerts' => true], $this->headers(null, $device))->assertOk();
        $this->postJson('/api/logout', [], $this->headers($staff, $device))->assertOk();
        $this->assertDatabaseMissing('pwa_subscriptions', ['id' => $device['id']]);
        $device = $this->device($staff, 'team');
        $staff->update(['password' => Hash::make('a-new-password')]);
        $this->assertDatabaseMissing('pwa_subscriptions', ['id' => $device['id']]);
        $device = $this->device($staff, 'team');
        $staff->update(['role' => 'admin']);
        $this->assertDatabaseMissing('pwa_subscriptions', ['id' => $device['id']]);
        $this->device($staff, 'team');
        $this->artisan('admin:revoke-sessions --force')->assertSuccessful();
        $this->assertDatabaseCount('pwa_subscriptions', 0);
    }

    public function test_customer_inbox_ownership_and_signed_in_read_receipts_are_shared_across_devices(): void
    {
        $first = User::factory()->create(['role' => 'customer']);
        $second = User::factory()->create(['role' => 'customer']);
        $service = app(PwaNotifications::class);
        $public = $service->publish(null, 'announcement', 'Public title', 'Public content', '/home-page/main.html', 'test:public');
        $private = $service->publish($first->id, 'order', 'Order update', 'Private content', '/home-page/main.html?orders=1', 'test:private');
        $this->getJson('/api/customer/notifications', $this->headers())->assertOk()->assertJsonCount(1, 'data')->assertJsonMissing(['message' => 'Private content']);
        $this->getJson('/api/customer/notifications/unread-count?after='.$public, $this->headers())->assertJsonPath('unread_count', 0);
        $this->getJson('/api/customer/notifications/unread-count?read_ids='.$public, $this->headers())->assertJsonPath('unread_count', 0);
        $this->getJson('/api/customer/notifications', $this->headers($first))->assertOk()->assertJsonCount(2, 'data');
        $this->patchJson('/api/customer/notifications/'.$private.'/read', [], $this->headers($second))->assertNotFound();
        $this->patchJson('/api/customer/notifications/'.$private.'/read', [], $this->headers($first))->assertOk();
        $this->getJson('/api/customer/notifications/unread-count', $this->headers($first))->assertJsonPath('unread_count', 1);
        $this->postJson('/api/customer/notifications/mark-all-read', [], $this->headers($first))->assertOk();
        $this->getJson('/api/customer/notifications/unread-count', $this->headers($first))->assertJsonPath('unread_count', 0);
        $this->patchJson('/api/customer/notifications/'.$public.'/read', [], $this->headers())->assertUnauthorized();
    }

    public function test_phone_tap_destination_is_visible_only_to_its_owner_or_public_guests(): void
    {
        $owner = User::factory()->create(['role' => 'customer']);
        $other = User::factory()->create(['role' => 'customer']);
        $admin = User::factory()->create(['role' => 'admin']);
        $service = app(PwaNotifications::class);
        $public = $service->publish(null, 'announcement', 'Title', 'Content', '/home-page/main.html?announcement=1', 'tap:public');
        $private = $service->publish($owner->id, 'order', 'Private title', 'Private content', '/home-page/main.html?orders=1&order_id=7', 'tap:private');

        $this->getJson('/api/customer/notifications/'.$public, $this->headers())->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')->assertJsonPath('id', $public)
            ->assertJsonMissingPath('title')->assertJsonMissingPath('message');
        $this->getJson('/api/customer/notifications/'.$private, $this->headers())->assertNotFound();
        $this->getJson('/api/customer/notifications/'.$private, $this->headers($other))->assertNotFound();
        $this->getJson('/api/customer/notifications/'.$private, $this->headers($admin))->assertForbidden();
        $this->getJson('/api/customer/notifications/'.$private, $this->headers($owner))->assertOk()
            ->assertJsonPath('target', '/home-page/main.html?orders=1&order_id=7');
        DB::table('customer_notifications')->where('id', $public)->update(['published_at' => now()->addHour()]);
        $this->getJson('/api/customer/notifications/'.$public, $this->headers())->assertNotFound();
    }

    public function test_real_business_changes_create_owned_alerts_and_rolled_back_changes_leave_no_alerts(): void
    {
        $user = User::factory()->create(['role' => 'customer']);
        $order = Order::create(['customer_id' => $user->id, 'customer_name' => 'Customer', 'lifecycle_status' => 'incoming']);
        $this->assertDatabaseCount('customer_notifications', 1);
        $order->update(['notes' => 'Ordinary edit']);
        $this->assertDatabaseCount('customer_notifications', 1);
        $order->update(['lifecycle_status' => 'pending']);
        $this->assertDatabaseCount('customer_notifications', 2);
        $payment = Payment::create(['order_id' => $order->id, 'status' => 'pending']);
        $payment->update(['status' => 'paid']);
        $return = OrderReturn::create(['order_id' => $order->id, 'customer_id' => $user->id, 'status' => 'requested']);
        $return->update(['status' => 'approved']);
        Appointment::create(['user_id' => $user->id, 'status' => 'pending']);
        Appointment::create(['email' => $user->email, 'status' => 'pending']);
        $this->assertDatabaseCount('customer_notifications', 6);
        DB::beginTransaction();
        $order->update(['lifecycle_status' => 'completed']);
        DB::rollBack();
        $this->assertDatabaseCount('customer_notifications', 6);
        $return->delete(); // Shared observer must not interfere with unrelated model deletion.
    }

    public function test_appointment_http_creation_uses_authenticated_account_and_never_guest_email_ownership(): void
    {
        Mail::fake();
        config(['services.turnstile.enabled' => false]);
        $customer = User::factory()->create(['role' => 'customer', 'email' => 'appointment.owner@gmail.com']);
        $body = ['first_name' => 'Maria', 'last_name' => 'Santos', 'contact_number' => '09171234567',
            'email' => $customer->email, 'country' => 'Philippines', 'full_address' => 'Daet, Camarines Norte',
            'client_type' => 'Student', 'purpose' => '3D Printing',
            'appointment_date' => now()->addWeek()->nextWeekday()->toDateString(), 'appointment_time' => '9:00 - 10:00 AM'];
        $this->postJson('/api/appointments', $body, $this->headers($customer))->assertCreated();
        $appointment = Appointment::first();
        $this->assertSame($customer->id, $appointment->user_id);
        $this->assertDatabaseHas('customer_notifications', ['user_id' => $customer->id, 'type' => 'appointment']);
        $body['appointment_time'] = '10:00 - 11:00 AM';
        $this->postJson('/api/appointments', $body, $this->headers())->assertCreated();
        $this->assertNull(Appointment::orderByDesc('id')->first()->user_id);
        $this->assertDatabaseCount('customer_notifications', 1);
    }

    public function test_scheduled_campaigns_publish_once_and_edits_disabled_expired_or_draft_records_do_not_rebroadcast(): void
    {
        $service = app(PwaNotifications::class);
        $announcement = Announcement::create(['title' => 'Scheduled news', 'message' => 'Details', 'is_enabled' => true, 'starts_at' => now()->addMinute()]);
        Promotion::create(['title' => 'Draft', 'discount_percent' => 10, 'is_enabled' => false]);
        Promotion::create(['title' => 'Expired', 'discount_percent' => 10, 'is_enabled' => true, 'ends_at' => now()->subMinute()]);
        $service->publishLiveCampaigns();
        $this->assertDatabaseCount('customer_notifications', 0);
        $this->travel(2)->minutes();
        $service->publishLiveCampaigns();
        $this->assertDatabaseCount('customer_notifications', 1);
        $announcement->update(['title' => 'Edited news']);
        $service->publishLiveCampaigns();
        $announcement->update(['is_enabled' => false]);
        $service->publishLiveCampaigns();
        $announcement->update(['is_enabled' => true]);
        $service->publishLiveCampaigns();
        $this->assertDatabaseCount('customer_notifications', 1);
        $this->travelBack();
    }

    public function test_outbox_deduplicates_filters_admin_only_and_never_contains_phone_preview_details(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $customer = User::factory()->create(['role' => 'customer']);
        $this->device($admin, 'team');
        $this->device($staff, 'team');
        $this->device($customer);
        $this->device();
        AdminNotification::create(['type' => 'account_request', 'title' => 'Sensitive name', 'message' => 'Sensitive payment details']);
        $this->assertDatabaseCount('pwa_delivery_outbox', 1);
        $service = app(PwaNotifications::class);
        $service->publish($customer->id, 'order', 'Secret title', 'Private order details', '/home-page/main.html', 'dedupe:order');
        $service->publish($customer->id, 'order', 'Secret title', 'Private order details', '/home-page/main.html', 'dedupe:order');
        $this->assertDatabaseCount('pwa_delivery_outbox', 2);
        foreach (DB::table('pwa_delivery_outbox')->get() as $row) {
            $payload = json_decode($row->payload, true);
            $this->assertArrayNotHasKey('message', $payload);
            $this->assertArrayNotHasKey('title', $payload);
            $this->assertStringNotContainsString('Sensitive', $row->payload);
            $this->assertStringNotContainsString('Private', $row->payload);
        }
        $service->publish(null, 'promotion', 'Public', 'Public details', '/products-page/product.html', 'dedupe:public');
        $this->assertDatabaseCount('pwa_delivery_outbox', 4);
    }

    public function test_delivery_retries_prunes_expired_subscriptions_and_revalidates_changed_bindings(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $device = $this->device($customer);
        app(PwaNotifications::class)->publish($customer->id, 'order', 'Title', 'Details', '/home-page/main.html', 'retry:order');
        $fake = $this->mock(PwaPushTransport::class);
        $fake->shouldReceive('send')->once()->andReturn(['success' => false, 'expired' => false, 'status' => 503]);
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertDatabaseHas('pwa_delivery_outbox', ['attempts' => 1, 'delivered_at' => null, 'discarded_at' => null]);
        DB::table('pwa_delivery_outbox')->update(['available_at' => now()]);
        $fake->shouldReceive('send')->once()->andReturn(['success' => false, 'expired' => true, 'status' => 410]);
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertDatabaseCount('pwa_subscriptions', 0);
        $this->assertDatabaseCount('pwa_delivery_outbox', 0);
        $device = $this->device($customer);
        app(PwaNotifications::class)->publish($customer->id, 'order', 'Title', 'Details', '/home-page/main.html', 'switch:order');
        $other = User::factory()->create(['role' => 'customer']);
        $this->patchJson('/api/pwa/subscriptions/'.$device['id'], ['bind' => true], $this->headers($other, $device))->assertOk();
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertDatabaseHas('pwa_delivery_outbox', ['last_error' => 'binding_changed_or_stale']);
    }

    public function test_disabled_delivery_does_not_send_or_queue_a_backlog_and_source_aliases_are_allowlisted(): void
    {
        $this->device();
        config(['pwa.push_enabled' => false]);
        app(PwaNotifications::class)->publish(null, 'announcement', 'Title', 'Details', '/home-page/main.html', 'disabled:public');
        $this->mock(PwaPushTransport::class)->shouldNotReceive('send');
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertDatabaseCount('pwa_delivery_outbox', 0);
        foreach (['/apps/customer/home-page/main', '/apps/customer/home-page/main.html', '/apps/team/staff-page/dashboard', '/apps/team/admin-auth/auth.html', '/apps/shared/pwa.js'] as $path) {
            $this->get($path)->assertOk();
        }
        foreach (['/apps/customer/admin-page/dashboard.html', '/apps/team/customer-auth/auth.html', '/apps/customer/backend/.env', '/apps/shared/../../backend/.env', '/apps/customer/home-page/../../../backend/composer.json'] as $path) {
            $this->get($path)->assertNotFound();
        }
        $this->get('/apps/customer/manifest.webmanifest')->assertHeader('Content-Type', 'application/manifest+json');
        $this->get('/images/FMRC%20Brand%20Logo.png')->assertOk();
    }

    public function test_installation_detection_links_use_the_current_site_origin_and_only_the_two_app_manifests(): void
    {
        foreach (['https://ucn-fabmanlab.com', 'https://staging.ucn-fabmanlab.com'] as $origin) {
            $this->getJson($origin.'/.well-known/assetlinks.json')->assertOk()->assertExactJson([
                ['relation' => ['delegate_permission/common.query_webapk'], 'target' => ['namespace' => 'web', 'site' => "$origin/apps/customer/manifest.webmanifest"]],
                ['relation' => ['delegate_permission/common.query_webapk'], 'target' => ['namespace' => 'web', 'site' => "$origin/apps/team/manifest.webmanifest"]],
            ])->assertHeader('X-Content-Type-Options', 'nosniff');
        }
    }

    public function test_successful_delivery_is_not_replayed_and_account_deletion_removes_the_device(): void
    {
        $customer = User::factory()->create(['role' => 'customer']);
        $device = $this->device($customer);
        app(PwaNotifications::class)->publish($customer->id, 'order', 'Title', 'Details', '/home-page/main.html', 'success:order');
        $this->mock(PwaPushTransport::class)->shouldReceive('send')->once()->andReturn(['success' => true, 'expired' => false, 'status' => 201]);
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertNotNull(DB::table('pwa_delivery_outbox')->first()->delivered_at);
        $this->artisan('pwa:process')->assertSuccessful();
        $customer->delete();
        $this->assertDatabaseMissing('pwa_subscriptions', ['id' => $device['id']]);
        $this->assertDatabaseCount('pwa_delivery_outbox', 0);
    }

    public function test_http_publication_sends_customer_and_team_alerts_without_waiting_for_cron(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $staff = User::factory()->create(['role' => 'staff']);
        $customer = User::factory()->create(['role' => 'customer']);
        $this->device($admin, 'team');
        $this->device($staff, 'team');
        $this->device($customer);
        $this->device();
        $seen = [];
        $this->mock(PwaPushTransport::class)->shouldReceive('send')->times(4)
            ->andReturnUsing(function ($device, $payload) use (&$seen) {
                $this->assertLessThanOrEqual(1, DB::transactionLevel(), 'A business transaction must commit before sending.');
                $seen[] = $device->app;
                return ['success' => true, 'expired' => false, 'status' => 201];
            });
        $this->postJson('/api/admin/announcements', ['title' => 'Prompt phone alert', 'message' => 'Staging test',
            'placement' => 'site', 'is_enabled' => true], $this->headers($admin))->assertCreated();
        $this->assertSame(['customer', 'customer', 'team', 'team'], $seen);
        $this->assertSame(4, DB::table('pwa_delivery_outbox')->whereNotNull('delivered_at')->count());
        $this->artisan('pwa:process')->assertSuccessful(); // The fallback must not replay these sends.
        $this->getJson('/api/pwa/config', $this->headers())->assertOk(); // Reads do not replay request state.
        $this->assertDatabaseCount('pwa_delivery_outbox', 4);
    }

    public function test_prompt_delivery_prioritizes_this_request_and_does_not_wait_for_a_cron_lock(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $this->device();
        app(PwaNotifications::class)->publish(null, 'announcement', 'Earlier', 'Earlier', '/home-page/main.html', 'old:pending');
        $fake = $this->mock(PwaPushTransport::class);
        $fake->shouldReceive('send')->once()->andReturn(['success' => true, 'expired' => false, 'status' => 201]);
        $lock = Cache::lock('pwa-push-processor', 120);
        $this->assertTrue($lock->get());
        try {
            $this->postJson('/api/admin/announcements', ['title' => 'New', 'message' => 'New', 'placement' => 'site',
                'is_enabled' => true], $this->headers($admin))->assertCreated();
        } finally {
            $lock->release();
        }
        $this->assertDatabaseHas('pwa_delivery_outbox', ['event_key' => 'old:pending', 'attempts' => 0, 'delivered_at' => null]);
        $this->assertSame(1, DB::table('pwa_delivery_outbox')->whereNotNull('delivered_at')->count());
        $fake->shouldReceive('send')->once()->andReturn(['success' => true, 'expired' => false, 'status' => 201]);
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertSame(2, DB::table('pwa_delivery_outbox')->whereNotNull('delivered_at')->count());
    }

    public function test_failed_prompt_send_keeps_successful_save_and_is_retried_by_cron(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $this->device();
        $fake = $this->mock(PwaPushTransport::class);
        $fake->shouldReceive('send')->once()->andReturn(['success' => false, 'expired' => false, 'status' => 503]);
        $this->postJson('/api/admin/announcements', ['title' => 'Saved even during outage', 'message' => 'New',
            'placement' => 'site', 'is_enabled' => true], $this->headers($admin))->assertCreated();
        $this->assertDatabaseHas('pwa_delivery_outbox', ['attempts' => 1, 'delivered_at' => null,
            'discarded_at' => null, 'last_error' => 'push_http_503']);
        $this->getJson('/api/pwa/config', $this->headers())->assertOk();
        DB::table('pwa_delivery_outbox')->update(['available_at' => now()]);
        $fake->shouldReceive('send')->once()->andReturn(['success' => true, 'expired' => false, 'status' => 201]);
        $this->artisan('pwa:process')->assertSuccessful();
        $this->assertSame(1, DB::table('pwa_delivery_outbox')->whereNotNull('delivered_at')->where('attempts', 2)->count());
    }

    public function test_rolled_back_http_business_changes_never_trigger_phone_delivery(): void
    {
        $this->device();
        $this->mock(PwaPushTransport::class)->shouldNotReceive('send');
        Route::post('/_test/pwa/rollback', function () {
            try {
                DB::transaction(function () {
                    app(PwaNotifications::class)->publish(null, 'announcement', 'Rollback', 'Rollback',
                        '/home-page/main.html', 'rolled-back:http');
                    throw new \RuntimeException('Test rollback');
                });
            } catch (\RuntimeException) {
                // The test returns normally so HTTP termination is still exercised.
            }
            return response()->json(['done' => true]);
        });
        $this->postJson('/_test/pwa/rollback')->assertOk();
        $this->assertDatabaseCount('customer_notifications', 0);
        $this->assertDatabaseCount('pwa_delivery_outbox', 0);
    }

    public function test_prompt_private_update_reaches_only_the_owning_customer(): void
    {
        $owner = User::factory()->create(['role' => 'customer']);
        $other = User::factory()->create(['role' => 'customer']);
        $device = $this->device($owner);
        $this->device($other);
        $this->device();
        $this->mock(PwaPushTransport::class)->shouldReceive('send')->once()
            ->withArgs(fn ($recipient, $payload) => $recipient->id === $device['id']
                && $payload['binding'] === $owner->id && ! $payload['public'])
            ->andReturn(['success' => true, 'expired' => false, 'status' => 201]);
        Route::post('/_test/pwa/owned-order', function () use ($owner) {
            DB::transaction(fn () => Order::create(['customer_id' => $owner->id, 'customer_name' => 'Customer',
                'lifecycle_status' => 'incoming']));
            return response()->json(['done' => true]);
        });
        $this->postJson('/_test/pwa/owned-order')->assertOk();
        $this->assertSame(1, DB::table('pwa_delivery_outbox')->whereNotNull('delivered_at')->count());
        $this->assertDatabaseCount('pwa_delivery_outbox', 1);
    }

    public function test_failed_background_processing_removes_capability_heartbeat(): void
    {
        $this->mock(PwaNotifications::class)->shouldReceive('publishLiveCampaigns')->once()->andThrow(new \RuntimeException('Simulated publication failure'));
        $this->artisan('pwa:process')->assertFailed();
        $this->getJson('/api/pwa/config', $this->headers())->assertJsonPath('push_available', false);
        $this->assertDatabaseMissing('pwa_runtime', ['key' => 'processor']);
    }

    public function test_payment_gateway_returns_stay_in_customer_app_without_accepting_client_urls(): void
    {
        config(['payments.paymongo.secret_key' => 'sk_test_example', 'payments.paymongo.sandbox_simulator' => false, 'app.frontend_url' => 'https://fmrc.example']);
        Http::fake(['api.paymongo.com/*' => Http::response(['data' => ['id' => 'cs_test']], 200)]);
        app(PayMongoService::class)->createCheckoutSession(10000, 'Order', 'ORD-1', 1, 1, 'customer');
        Http::assertSent(fn ($request) => $request['data']['attributes']['success_url'] === 'https://fmrc.example/apps/customer/products-page/product.html?payment=success&order_id=1'
            && $request['data']['attributes']['cancel_url'] === 'https://fmrc.example/apps/customer/products-page/product.html?payment=failed&order_id=1');
    }
}
