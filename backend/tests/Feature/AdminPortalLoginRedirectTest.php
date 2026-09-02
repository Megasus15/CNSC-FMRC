<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The Admin/Staff sign-in page decides, on its own, which portal a signed-in
 * account may open. /api/login has no role gate -- it authenticates anyone with
 * a correct password and hands back a token -- so every rule about who reaches
 * the back office lives in admin-auth/auth.js. These tests pin both halves:
 * what the endpoint promises, and what the page does with it.
 */
class AdminPortalLoginRedirectTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'PortalPass!2026';

    private function loginScript(): string
    {
        $path = dirname(__DIR__, 3).DIRECTORY_SEPARATOR.'admin-auth'.DIRECTORY_SEPARATOR.'auth.js';
        $this->assertFileExists($path);

        return (string) file_get_contents($path);
    }

    private function signIn(string $role, string $username): \Illuminate\Testing\TestResponse
    {
        User::factory()->create([
            'name' => ucfirst($role).' Account',
            'username' => $username,
            'role' => $role,
            'password' => Hash::make(self::PASSWORD),
        ]);

        return $this->postJson('/api/login', [
            'login' => $username,
            'password' => self::PASSWORD,
        ]);
    }

    public function test_staff_sign_in_returns_a_token_and_the_staff_role(): void
    {
        $response = $this->signIn('staff', 'staffmember');

        $response->assertOk();
        $this->assertSame('staff', $response->json('user.role'));
        $this->assertNotEmpty($response->json('access_token'));
    }

    public function test_admin_sign_in_returns_a_token_and_the_admin_role(): void
    {
        $response = $this->signIn('admin', 'administrator');

        $response->assertOk();
        $this->assertSame('admin', $response->json('user.role'));
        $this->assertNotEmpty($response->json('access_token'));
    }

    /**
     * A customer's correct password is still a correct password: the endpoint
     * answers 200 and mints a token. That is exactly why the page has to refuse
     * them itself, and why it must not keep the token it was handed.
     */
    public function test_a_customer_also_receives_a_token_from_the_portal_endpoint(): void
    {
        $response = $this->signIn('customer', 'shopper');

        $response->assertOk();
        $this->assertSame('customer', $response->json('user.role'));
        $this->assertNotEmpty($response->json('access_token'));
    }

    /**
     * The redirect must read the same normalised role the storage keys are
     * chosen from. Comparing the raw value stranded anyone whose stored role was
     * not lowercase: a token was written, neither redirect matched, and the only
     * thing on screen was a refusal.
     */
    public function test_the_login_page_picks_its_redirect_from_the_normalised_role(): void
    {
        $script = $this->loginScript();

        $this->assertStringContainsString('const userRole = (data.user?.role || "").toLowerCase();', $script);
        $this->assertStringContainsString('if (userRole === "admin" || userRole === "staff")', $script);
        $this->assertStringNotContainsString('data.user.role === "admin"', $script);
        $this->assertStringNotContainsString('data.user.role === "staff"', $script);
    }

    /**
     * A customer who signs in here must leave no portal session behind. Writing
     * the token to admin_auth_token -- which the refusal branch used to do --
     * put a customer's token where every back-office page looks for the
     * admin's.
     */
    public function test_the_login_page_clears_both_portal_sessions_when_it_refuses(): void
    {
        $script = $this->loginScript();
        $refusal = strstr($script, 'This portal is for admin and staff only.');

        $this->assertNotFalse($refusal, 'The refusal branch is missing from admin-auth/auth.js.');

        $branch = strstr($script, '// The credentials were valid, so the API answered 200');
        $this->assertNotFalse($branch);
        $branch = substr((string) $branch, 0, strpos((string) $branch, 'setFieldError') ?: 0);

        foreach (['admin_auth_token', 'admin_user_info', 'staff_auth_token', 'staff_user_info'] as $key) {
            $this->assertStringContainsString('localStorage.removeItem("'.$key.'")', $branch, $key);
        }
    }

    public function test_the_login_page_loads_a_cache_busted_auth_script(): void
    {
        $path = dirname(__DIR__, 3).DIRECTORY_SEPARATOR.'admin-auth'.DIRECTORY_SEPARATOR.'auth.html';
        $this->assertFileExists($path);

        $this->assertSame(1, preg_match('/auth\.js\?v=\d+(?:\.\d+)?/', (string) file_get_contents($path)));
    }
}
