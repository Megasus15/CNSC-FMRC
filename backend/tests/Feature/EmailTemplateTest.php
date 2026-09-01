<?php

namespace Tests\Feature;

use App\Models\SiteSetting;
use App\Support\Branding;
use App\Support\EmailTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Contract for the admin/staff Gmail notification editor.
 *
 * Every one of the 27 notifications now renders through one shared shell, with the
 * six editable parts merged over compiled-in defaults. Two properties matter more
 * than anything else here:
 *
 *  1. An UNTOUCHED template must send exactly the wording it sent before the editor
 *     existed -- the defaults are the old copy byte-for-byte.
 *  2. A BAD override (blank heading, junk colour, corrupt JSON, unreachable table)
 *     must never stop an email or strip its code-owned content. Order mail is not
 *     allowed to fail because someone mistyped a colour.
 */
class EmailTemplateTest extends TestCase
{
    use RefreshDatabase;

    /** Save one template's override the same way the editor's PUT does. */
    private function override(string $slug, array $parts): void
    {
        SiteSetting::set(EmailTemplate::KEY_PREFIX . $slug, json_encode($parts));
    }

    public function test_every_gmail_notification_is_registered_exactly_once(): void
    {
        $slugs = EmailTemplate::slugs();

        $this->assertCount(27, $slugs, 'All 27 Gmail notifications must be editable.');
        $this->assertSame($slugs, array_unique($slugs));

        $counts = array_fill_keys(EmailTemplate::GROUPS, 0);

        foreach (EmailTemplate::TEMPLATES as $slug => $meta) {
            $this->assertArrayHasKey('label', $meta, $slug);
            $this->assertArrayHasKey('group', $meta, $slug);
            $this->assertArrayHasKey('tokens', $meta, $slug);
            $this->assertContains($meta['group'], EmailTemplate::GROUPS, $slug);
            $counts[$meta['group']]++;

            // Every editable part ships a default, so nothing renders blank
            // before an admin has ever opened the page.
            foreach (EmailTemplate::EDITABLE_PARTS as $part) {
                $this->assertArrayHasKey($part, $meta['defaults'], "{$slug}.{$part}");
            }
            $this->assertNotSame('', trim($meta['defaults']['body_heading']), $slug);
            $this->assertNotSame('', trim($meta['defaults']['body_text']), $slug);
            $this->assertSame(
                $meta['defaults']['header_color'],
                EmailTemplate::color($meta['defaults']['header_color']),
                "{$slug} ships an invalid header colour",
            );
        }

        $this->assertSame([
            'Orders' => 10,
            'Returns & Refunds' => 6,
            'Account & Access' => 3,
            'Appointments' => 2,
            'Admin Security' => 4,
            'Staff Requests' => 2,
        ], $counts);
    }

    public function test_every_slug_renders_a_complete_email_with_no_leftover_placeholder(): void
    {
        foreach (EmailTemplate::slugs() as $slug) {
            $html = EmailTemplate::preview($slug);

            $this->assertStringContainsString('<!DOCTYPE html>', $html, $slug);
            $this->assertStringContainsString('width="600"', $html, $slug);
            $this->assertStringContainsString(EmailTemplate::defaults($slug)['header_color'], $html, $slug);
            $this->assertStringContainsString('&copy; ' . date('Y'), $html, $slug);
            $this->assertStringContainsString(Branding::INSTITUTION, $html, $slug);
            $this->assertStringNotContainsString('CNSC-FMRC', $html, $slug);

            // Every declared token has a sample value, so the preview an admin
            // reads never shows a raw {placeholder}.
            $this->assertDoesNotMatchRegularExpression(
                '/\{[a-z0-9_]{3,40}\}/',
                strip_tags($html),
                "{$slug} preview leaked an unsubstituted token",
            );
        }
    }

    public function test_an_untouched_template_sends_its_original_wording(): void
    {
        $defaults = EmailTemplate::defaults('order_received');
        $parts = EmailTemplate::resolve('order_received', ['customer_name' => 'Maria Santos']);

        $this->assertSame($defaults['header_title'], $parts['header_title']);
        $this->assertSame($defaults['header_color'], $parts['header_color']);
        $this->assertSame($defaults['body_heading'], $parts['body_heading']);
        $this->assertSame($defaults['footer_note'], $parts['footer_note']);
        $this->assertStringContainsString('Hi Maria Santos,', $parts['body_text']);
        $this->assertStringNotContainsString('{customer_name}', $parts['body_text']);
    }

    public function test_an_override_changes_only_the_six_editable_parts(): void
    {
        $this->override('order_received', [
            'header_title' => 'UCN-FMRC Orders',
            'header_subtitle' => 'Order desk',
            'header_color' => '#0a5fd6',
            'body_heading' => 'We got your order',
            'body_text' => "Hi {customer_name},\n\nOrder {order_number} is in the queue.",
            'footer_note' => 'Log in any time to check the status.',
        ]);

        $html = EmailTemplate::render('order_received', [
            'customer_name' => 'Maria Santos',
            'order_number' => 'ORD-2026-0142',
        ], '<p id="chip">Order total: PHP 2,450.00</p>');

        $this->assertStringContainsString('UCN-FMRC Orders', $html);
        $this->assertStringContainsString('Order desk', $html);
        $this->assertStringContainsString('background:#0a5fd6;', $html);
        $this->assertStringContainsString('We got your order', $html);
        $this->assertStringContainsString('Order ORD-2026-0142 is in the queue.', $html);
        $this->assertStringContainsString('Log in any time to check the status.', $html);

        // Replaced, not appended: the old wording is gone.
        $this->assertStringNotContainsString('Your Order Has Been Received', $html);
        $this->assertStringNotContainsString('background:#800000;', $html);

        // The code-owned block and the legal footer survive an override.
        $this->assertStringContainsString('<p id="chip">Order total: PHP 2,450.00</p>', $html);
        $this->assertStringContainsString('&copy; ' . date('Y') . ' ' . Branding::NAME, $html);
        $this->assertStringContainsString('please do not reply to this email', $html);
    }

    public function test_a_saved_override_survives_a_line_break_and_cannot_inject_markup(): void
    {
        $this->override('order_received', [
            'body_text' => "Line one\nLine two",
            'body_heading' => '<script>alert(1)</script>',
        ]);

        $html = EmailTemplate::render('order_received');

        $this->assertStringContainsString('Line one<br />' . "\n" . 'Line two', $html);
        // Editable prose is escaped: a staff-editable field must never become
        // stored XSS in a customer's inbox.
        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $html);
    }

    public function test_a_blank_override_restores_the_default_except_for_the_two_optional_lines(): void
    {
        $this->override('order_received', [
            'header_title' => '   ',
            'body_heading' => '',
            'body_text' => '',
            'header_subtitle' => '',
            'footer_note' => '',
        ]);

        $parts = EmailTemplate::resolve('order_received');
        $defaults = EmailTemplate::defaults('order_received');

        // Required parts refuse to ship empty.
        $this->assertSame($defaults['header_title'], $parts['header_title']);
        $this->assertSame($defaults['body_heading'], $parts['body_heading']);
        $this->assertSame($defaults['body_text'], $parts['body_text']);

        // The subtitle and the closing note are genuinely optional.
        $this->assertSame('', $parts['header_subtitle']);
        $this->assertSame('', $parts['footer_note']);

        $html = EmailTemplate::render('order_received');
        $this->assertStringNotContainsString('Fabrication &amp; Manufacturing Research Center', $html);
        $this->assertStringContainsString('Your Order Has Been Received', $html);
    }

    public function test_a_malformed_header_colour_falls_back_to_the_templates_own_colour(): void
    {
        $this->override('order_cancelled_immediately', [
            'header_color' => "red; background-image:url('x')",
        ]);

        $parts = EmailTemplate::resolve('order_cancelled_immediately');

        $this->assertSame('#b45309', $parts['header_color']);
        $this->assertStringContainsString(
            'background:#b45309;',
            EmailTemplate::render('order_cancelled_immediately'),
        );

        // The guard is exact-length hex only.
        $this->assertSame('#800000', EmailTemplate::color('#80000'));
        $this->assertSame('#800000', EmailTemplate::color('rgb(0,0,0)'));
        $this->assertSame('#800000', EmailTemplate::color(null));
        $this->assertSame('#0A5FD6', EmailTemplate::color('  #0A5FD6  '));
    }

    public function test_a_corrupt_or_wrongly_typed_override_row_falls_back_to_defaults(): void
    {
        $defaults = EmailTemplate::defaults('password_reset_otp');

        foreach ([
            'not json at all',
            '[1,2,3]',
            '"a string"',
            '{"body_heading": {"nested": true}, "body_text": 42}',
            '',
            '   ',
        ] as $raw) {
            SiteSetting::set(EmailTemplate::KEY_PREFIX . 'password_reset_otp', $raw);

            $parts = EmailTemplate::resolve('password_reset_otp');

            $this->assertSame($defaults['body_heading'], $parts['body_heading'], $raw);
            $this->assertSame($defaults['body_text'], $parts['body_text'], $raw);
            $this->assertSame($defaults['header_color'], $parts['header_color'], $raw);
        }
    }

    public function test_an_unreachable_settings_table_still_sends_the_email(): void
    {
        // Worst case on Hostinger: the table is missing or the connection is down
        // mid-checkout. The compiled-in copy has to go out anyway.
        DB::statement('DROP TABLE site_settings');

        $html = EmailTemplate::render(
            'order_received',
            ['customer_name' => 'Maria Santos'],
            '<p id="chip">Order total: PHP 2,450.00</p>',
        );

        $this->assertStringContainsString('Your Order Has Been Received', $html);
        $this->assertStringContainsString('Hi Maria Santos,', $html);
        $this->assertStringContainsString('<p id="chip">Order total: PHP 2,450.00</p>', $html);
    }

    public function test_an_unregistered_slug_still_renders_a_valid_shell(): void
    {
        $html = EmailTemplate::render('not_a_real_notification', [], '<p id="chip">Kept</p>');

        $this->assertStringContainsString('<!DOCTYPE html>', $html);
        $this->assertStringContainsString(Branding::NAME, $html);
        $this->assertStringContainsString('<p id="chip">Kept</p>', $html);
        $this->assertFalse(EmailTemplate::has('not_a_real_notification'));
    }

    public function test_an_order_email_still_carries_its_order_number_after_substitution(): void
    {
        // order_received's shipped wording asks the customer to keep the order
        // number rather than printing it (the summary chip does that), so the
        // override proves the token path end to end.
        $this->override('order_received', [
            'body_text' => 'Hi {customer_name}, order {order_number} for PHP {amount} is {status}.',
        ]);

        $html = EmailTemplate::render('order_received', [
            'customer_name' => 'Maria Santos',
            'order_number' => 'ORD-2026-0142',
            'amount' => '2,450.00',
            'status' => 'Pending',
        ]);

        $this->assertStringContainsString(
            'Hi Maria Santos, order ORD-2026-0142 for PHP 2,450.00 is Pending.',
            $html,
        );

        // Every registered order slug declares the order number, so no order
        // notification can lose it by design.
        foreach (EmailTemplate::TEMPLATES as $slug => $meta) {
            if ($meta['group'] === 'Orders') {
                $this->assertContains('order_number', $meta['tokens'], $slug);
            }
        }
    }

    public function test_an_unknown_placeholder_stays_visible_instead_of_vanishing(): void
    {
        $this->override('order_received', [
            'body_text' => 'Hi {customer_name}, your {not_a_token} is ready.',
        ]);

        $parts = EmailTemplate::resolve('order_received', ['customer_name' => 'Maria Santos']);

        $this->assertSame('Hi Maria Santos, your {not_a_token} is ready.', $parts['body_text']);
    }

    public function test_the_registry_endpoint_payload_carries_defaults_and_the_saved_override(): void
    {
        $this->override('account_welcome', ['body_heading' => 'Welcome aboard']);

        $rows = collect(EmailTemplate::registry());

        $this->assertCount(27, $rows);

        $welcome = $rows->firstWhere('slug', 'account_welcome');
        $this->assertSame(['body_heading' => 'Welcome aboard'], $welcome['saved']);
        $this->assertNotSame('', (string) $welcome['defaults']['body_text']);
        $this->assertNotSame('', (string) $welcome['label']);

        // Untouched templates report no override, which is what drives the
        // "Edited" dot and the Restore Default button in the editor.
        $this->assertSame([], $rows->firstWhere('slug', 'order_received')['saved']);
    }

    public function test_the_editor_preview_reflects_an_unsaved_draft_without_saving_it(): void
    {
        $draft = EmailTemplate::previewDraft('order_received', [
            'body_heading' => 'Draft heading only',
            'header_color' => '#2e7d32',
        ]);

        $this->assertStringContainsString('Draft heading only', $draft);
        $this->assertStringContainsString('background:#2e7d32;', $draft);
        // Omitted parts fall back to the default, exactly as a real send would.
        $this->assertStringContainsString('Hi Maria Santos,', $draft);
        // Nothing was written.
        $this->assertNull(SiteSetting::get(EmailTemplate::KEY_PREFIX . 'order_received'));
        $this->assertStringContainsString('Your Order Has Been Received', EmailTemplate::preview('order_received'));
    }
}
