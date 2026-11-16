<?php

namespace Tests\Feature;

use App\Models\SiteSetting;
use App\Models\User;
use App\Support\EmailContacts;
use App\Support\EmailTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EmailContactsTest extends TestCase
{
    use RefreshDatabase;

    private const CONTACTS = ['facebook_url' => 'https://www.facebook.com/FMRC', 'website_url' => 'https://ucn-fabmanlab.com', 'phone' => '+63 912 345 6789'];

    public function test_one_saved_footer_is_in_every_template_and_private_from_public_settings(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->putJson('/api/admin/site-settings', [EmailContacts::KEY => json_encode(self::CONTACTS)])->assertOk();
        $this->getJson('/api/admin/email-templates')->assertOk()->assertJsonPath('data.contact_footer.effective', self::CONTACTS);
        foreach (EmailTemplate::slugs() as $slug) {
            $html = EmailTemplate::preview($slug);
            $this->assertStringContainsString('href="tel:+639123456789"', $html, $slug);
            $this->assertStringContainsString('https://www.facebook.com/FMRC', $html, $slug);
            $this->assertStringContainsString('Official website', $html, $slug);
            $this->assertStringContainsString('All rights reserved', $html, $slug);
        }
        $this->getJson('/api/site-settings')->assertOk()->assertJsonMissingPath('data.'.EmailContacts::KEY);
    }

    public function test_contacts_have_admin_only_validated_atomic_saves_and_preview_does_not_publish(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->putJson('/api/admin/site-settings', [EmailContacts::KEY => json_encode(self::CONTACTS)])->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        foreach (['javascript:alert(1)', 'https://user:password@example.com', 'http://example.com'] as $url) {
            $this->putJson('/api/admin/site-settings', [EmailContacts::KEY => json_encode(array_replace(self::CONTACTS, ['website_url' => $url])), 'contact_phone' => 'unchanged'])->assertUnprocessable();
            $this->assertDatabaseMissing('site_settings', ['key' => 'contact_phone']);
        }
        $this->postJson('/api/admin/email-templates/preview', ['slug' => 'order_received', 'contact_footer' => self::CONTACTS])->assertOk()->assertSee('Official website');
        $this->assertDatabaseMissing('site_settings', ['key' => EmailContacts::KEY]);
        SiteSetting::set('email_tpl_order_received', json_encode(['body_heading' => 'Previously saved notification heading']));
        $this->postJson('/api/admin/email-templates/preview', ['slug' => 'order_received', 'contact_footer' => self::CONTACTS])->assertOk()->assertSee('Previously saved notification heading');
    }

    public function test_defaults_restore_from_contact_then_footer_and_corruption_cannot_break_mail(): void
    {
        SiteSetting::set('footer_contact_phone', '0912-345-6789');
        SiteSetting::set('contact_phone', '0999-111-2222');
        SiteSetting::set('footer_contact_facebook_url', 'https://www.facebook.com/FallbackFMRC');
        SiteSetting::set(EmailContacts::KEY, '{broken');
        $this->assertSame('0999-111-2222', EmailContacts::resolve()['phone']);
        $this->assertStringContainsString('href="tel:09991112222"', EmailTemplate::preview('password_reset_otp'));
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->putJson('/api/admin/site-settings', [EmailContacts::KEY => json_encode(self::CONTACTS)])->assertOk();
        $this->putJson('/api/admin/site-settings', [EmailContacts::KEY => ''])->assertOk();
        $this->assertSame('0999-111-2222', EmailContacts::resolve()['phone']);
    }
}
