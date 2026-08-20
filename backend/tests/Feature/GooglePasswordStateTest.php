<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GooglePasswordStateTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_new_google_customer_is_marked_as_needing_a_password(): void
    {
        Mail::fake();
        Http::fake([
            'https://www.googleapis.com/oauth2/v3/userinfo' => Http::response([
                'email' => 'google.customer@gmail.com',
                'email_verified' => true,
                'name' => 'Google Customer',
                'given_name' => 'Google',
            ]),
        ]);

        $response = $this->postJson('/api/auth/google', [
            'access_token' => 'test-google-access-token',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('user.signed_with_google', true)
            ->assertJsonPath('user.has_custom_password', false);

        $this->assertDatabaseHas('users', [
            'email' => 'google.customer@gmail.com',
            'signed_with_google' => true,
            'has_custom_password' => false,
        ]);
    }

    public function test_setting_a_google_password_is_saved_and_returned_on_the_next_google_sign_in(): void
    {
        $customer = User::factory()->create([
            'name' => 'Returning Google Customer',
            'username' => 'returning_google_customer',
            'email' => 'returning.google@gmail.com',
            'role' => 'customer',
            'signed_with_google' => true,
            'has_custom_password' => false,
        ]);

        Sanctum::actingAs($customer);

        $this->postJson('/api/change-password', [
            'new_password' => 'NewPassword123!',
            'new_password_confirmation' => 'NewPassword123!',
        ])
            ->assertOk()
            ->assertJsonPath('data.signed_with_google', true)
            ->assertJsonPath('data.has_custom_password', true);

        $customer->refresh();
        $this->assertTrue($customer->has_custom_password);
        $this->assertTrue(Hash::check('NewPassword123!', $customer->password));

        Mail::fake();
        Http::fake([
            'https://www.googleapis.com/oauth2/v3/userinfo' => Http::response([
                'email' => 'returning.google@gmail.com',
                'email_verified' => true,
                'name' => 'Returning Google Customer',
                'given_name' => 'Returning',
            ]),
        ]);

        $this->postJson('/api/auth/google', [
            'access_token' => 'returning-google-access-token',
        ])
            ->assertOk()
            ->assertJsonPath('user.signed_with_google', true)
            ->assertJsonPath('user.has_custom_password', true);

        $this->getJson('/api/customer/profile')
            ->assertOk()
            ->assertJsonPath('data.signed_with_google', true)
            ->assertJsonPath('data.has_custom_password', true);
    }

    public function test_password_already_set_accounts_require_the_current_password_for_later_changes(): void
    {
        $customer = User::factory()->create([
            'role' => 'customer',
            'has_custom_password' => true,
        ]);

        Sanctum::actingAs($customer);

        $this->postJson('/api/change-password', [
            'new_password' => 'AnotherPassword123!',
            'new_password_confirmation' => 'AnotherPassword123!',
        ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Current password is required to change your password.');
    }

    public function test_admin_user_management_receives_the_saved_password_status(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $googleCustomer = User::factory()->create([
            'role' => 'customer',
            'signed_with_google' => true,
            'has_custom_password' => false,
        ]);

        Sanctum::actingAs($admin);

        $this->getJson('/api/users')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $googleCustomer->id,
                'signed_with_google' => true,
                'has_custom_password' => false,
            ]);
    }
}
