<?php

namespace Tests\Feature;

use App\Models\SiteSetting;
use App\Models\User;
use App\Support\PortalAppearanceSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PortalAppearanceSettingsTest extends TestCase
{
    use RefreshDatabase;

    public static function editorRoles(): array
    {
        return [['admin']];
    }

    private function signIn(string $role): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => $role]));
    }

    #[DataProvider('editorRoles')]
    public function test_each_editor_can_save_portals_independently_and_read_them_publicly(string $role): void
    {
        $this->signIn($role);
        SiteSetting::set('portal_logo_primary_image', '/images/legacy-primary.png');
        SiteSetting::set('portal_logo_secondary_image', '/images/legacy-secondary.png');
        $customer = [
            'portal_customer_background_image' => 'data:image/png;base64,iVBORw0KGgo=',
            'portal_customer_logo_primary_image' => '/images/customer-primary.png',
            'portal_customer_logo_secondary_image' => null,
            'portal_customer_image_side' => 'right',
            'portal_customer_image_position' => 'top',
            'portal_customer_overlay_opacity' => 1,
        ];
        foreach (PortalAppearanceSettings::TEXT_LIMITS as $suffix => $limit) {
            $customer['portal_customer_'.$suffix] = str_repeat('x', $limit);
        }
        $customer['portal_customer_image_title'] = "Made for ideas.\nBuilt for you.";
        $this->putJson('/api/admin/site-settings', $customer)->assertOk();
        $this->putJson('/api/admin/site-settings', [
            'portal_admin_brand_name' => 'UCN-FMRC',
            'portal_admin_image_side' => 'left',
            'portal_admin_image_position' => 'bottom',
            'portal_admin_overlay_opacity' => 0,
        ])->assertOk();

        $response = $this->getJson('/api/site-settings')->assertOk();
        foreach ($customer as $key => $value) {
            $response->assertJsonPath('data.'.$key, $value === null ? null : (string) $value);
        }
        $response->assertJsonPath('data.portal_admin_image_side', 'left')
            ->assertJsonPath('data.portal_admin_overlay_opacity', '0')
            ->assertJsonPath('data.portal_logo_primary_image', '/images/legacy-primary.png')
            ->assertJsonPath('data.portal_logo_secondary_image', '/images/legacy-secondary.png');
    }

    public static function invalidAppearance(): array
    {
        return [
            'unsupported side' => ['image_side', 'middle'],
            'side is required when included' => ['image_side', null],
            'unsupported image crop' => ['image_position', 'left'],
            'negative opacity' => ['overlay_opacity', -0.01],
            'opacity exceeds full intensity' => ['overlay_opacity', 1.01],
            'non-numeric opacity' => ['overlay_opacity', 'opaque'],
            'array image' => ['background_image', ['not-an-image']],
            'array logo' => ['logo_primary_image', ['not-an-image']],
            'script image URL' => ['background_image', 'javascript:alert(1)'],
            'SVG image URL' => ['logo_secondary_image', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
            'malformed data URL' => ['background_image', 'data:image/png;base64,%%%'],
            'protocol-relative image' => ['background_image', '//example.test/image.png'],
            'brand name too long' => ['brand_name', str_repeat('x', 81)],
            'image title too long' => ['image_title', str_repeat('x', 161)],
            'image description too long' => ['image_description', str_repeat('x', 321)],
            'emoji matches browser maxlength' => ['portal_name', str_repeat("\u{1F600}", 41)],
        ];
    }

    public function test_both_portals_can_save_and_publicly_read_full_overlay_intensity(): void
    {
        $this->signIn('admin');
        foreach ([0.55, 0.75, 1] as $intensity) {
            $payload = [
                'portal_customer_overlay_opacity' => $intensity,
                'portal_admin_overlay_opacity' => $intensity,
            ];
            $this->putJson('/api/admin/site-settings', $payload)->assertOk();
            $response = $this->getJson('/api/site-settings')->assertOk();
            foreach ($payload as $key => $value) {
                $response->assertJsonPath('data.'.$key, (string) $value);
            }
        }
    }

    #[DataProvider('invalidAppearance')]
    public function test_invalid_appearance_is_rejected_without_partial_updates(string $suffix, mixed $value): void
    {
        $this->signIn('admin');
        SiteSetting::set('hero_title', 'Original title');
        SiteSetting::set('portal_customer_brand_name', 'Original brand');
        $fields = ['portal_customer_'.$suffix, 'portal_admin_'.$suffix];
        $payload = array_fill_keys($fields, $value);
        $payload['hero_title'] = 'Must not save';
        $this->putJson('/api/admin/site-settings', $payload)->assertUnprocessable()
            ->assertJsonValidationErrors($fields);
        $this->assertSame('Original title', SiteSetting::get('hero_title'));
        $this->assertSame('Original brand', SiteSetting::get('portal_customer_brand_name'));
        $this->assertNull(SiteSetting::get('portal_admin_brand_name'));
    }

    public function test_portal_namespaces_reject_auth_form_settings_even_when_empty(): void
    {
        $this->signIn('admin');
        $this->putJson('/api/admin/site-settings', [
            'portal_customer_login_button' => 'Enter',
            'portal_admin_password_label' => null,
            'portal_customer_brand_name' => 'Must not save',
        ])->assertUnprocessable()->assertJsonValidationErrors([
            'portal_customer_login_button', 'portal_admin_password_label',
        ]);
        $this->assertNull(SiteSetting::get('portal_customer_brand_name'));
        $this->assertNull(SiteSetting::get('portal_admin_password_label'));
    }

    public function test_clearing_artwork_and_copy_preserves_other_portal_and_generic_settings(): void
    {
        $this->signIn('admin');
        SiteSetting::set('portal_customer_background_image', '/images/custom.png');
        SiteSetting::set('portal_admin_background_image', '/images/admin.png');
        SiteSetting::set('portal_customer_image_description', 'Custom description');
        $this->putJson('/api/admin/site-settings', [
            'portal_customer_background_image' => null,
            'portal_customer_image_description' => null,
            'hero_bg_gradient' => 'maroon-ember',
            'footer_logo_primary_image' => '/images/footer.png',
        ])->assertOk();
        $this->assertNull(SiteSetting::get('portal_customer_background_image'));
        $this->assertNull(SiteSetting::get('portal_customer_image_description'));
        $this->assertSame('/images/admin.png', SiteSetting::get('portal_admin_background_image'));
        $this->assertSame('maroon-ember', SiteSetting::get('hero_bg_gradient'));
        $this->assertSame('/images/footer.png', SiteSetting::get('footer_logo_primary_image'));
    }

    public function test_image_references_support_safe_data_external_urls_and_bundled_asset_paths(): void
    {
        $this->signIn('admin');
        foreach ([
            'data:image/jpeg;base64,/9j/2Q==',
            'data:image/gif;base64,R0lGODlh',
            'data:image/webp;base64,UklGRg==',
            'https://images.example.test/portal?id=1',
            'http://127.0.0.1:5514/images/Portal Image.jpg',
            '../images/UCN Logo.png',
            '/images/FMRC Brand Logo.png',
            '',
        ] as $image) {
            $this->putJson('/api/admin/site-settings', ['portal_admin_background_image' => $image])->assertOk();
        }
    }

    public function test_customer_cannot_write_portal_settings(): void
    {
        $this->putJson('/api/admin/site-settings', ['portal_customer_brand_name' => 'Unauthorized'])
            ->assertUnauthorized();
        $this->signIn('customer');
        $this->putJson('/api/admin/site-settings', ['portal_admin_image_side' => 'right'])
            ->assertForbidden();
        $this->assertNull(SiteSetting::get('portal_customer_brand_name'));
        $this->assertNull(SiteSetting::get('portal_admin_image_side'));
    }

    public static function staffRestrictedPortalSettings(): array
    {
        return [
            ['portal_customer_brand_name', 'Unauthorized customer branding'],
            ['portal_admin_image_side', 'right'],
            ['portal_logo_primary_image', '/images/legacy.png'],
            ['portal_logo_secondary_image', null],
            ['portal_customer_login_button', 'Enter'],
        ];
    }

    #[DataProvider('staffRestrictedPortalSettings')]
    public function test_staff_cannot_write_portal_or_legacy_branding_and_mixed_requests_are_atomic(string $key, mixed $value): void
    {
        $this->signIn('staff');
        SiteSetting::set('hero_title', 'Original hero');
        $this->putJson('/api/admin/site-settings', [
            $key => $value,
            'hero_title' => 'Must not save',
        ])->assertForbidden();
        $this->assertDatabaseMissing('site_settings', ['key' => $key]);
        $this->assertSame('Original hero', SiteSetting::get('hero_title'));

        $this->putJson('/api/admin/site-settings', ['hero_title' => 'Staff can still edit content'])
            ->assertOk();
        $this->assertSame('Staff can still edit content', SiteSetting::get('hero_title'));
    }

    public function test_saved_portal_edits_invalidate_the_public_settings_etag(): void
    {
        $etag = $this->getJson('/api/site-settings')->assertOk()->headers->get('ETag');
        $this->withHeader('If-None-Match', $etag)->getJson('/api/site-settings')->assertStatus(304);
        $this->signIn('admin');
        $this->putJson('/api/admin/site-settings', ['portal_customer_image_side' => 'right'])->assertOk();
        $response = $this->withHeader('If-None-Match', $etag)->getJson('/api/site-settings')
            ->assertOk()->assertJsonPath('data.portal_customer_image_side', 'right');
        $this->assertNotSame($etag, $response->headers->get('ETag'));
    }
}
