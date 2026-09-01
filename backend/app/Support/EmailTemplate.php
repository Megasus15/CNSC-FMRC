<?php

namespace App\Support;

use App\Models\SiteSetting;
use Throwable;

/**
 * The single editable shell behind every Gmail notification this system sends.
 *
 * Each notification is registered here under a slug with its default copy taken
 * byte-for-byte from the builder it replaced, so an untouched template sends
 * exactly what it sent before. Admin and staff override the six editable parts
 * from Website Management -> Email Templates; the overrides live in
 * site_settings under "email_tpl_{slug}" as JSON, so the feature needs no
 * migration.
 *
 * Structured blocks (OTP digits, credential cards, the order summary chip, CTA
 * buttons, contact tables) are passed in as $extraHtml and stay code-owned: an
 * admin must not be able to delete the OTP out of an OTP email. The legal
 * footer line is code-owned for the same reason.
 */
final class EmailTemplate
{
    /** site_settings key prefix holding one template's JSON override. */
    public const KEY_PREFIX = 'email_tpl_';

    /** The only parts an admin or staff member may edit. */
    public const EDITABLE_PARTS = [
        'header_title',
        'header_subtitle',
        'header_color',
        'body_heading',
        'body_text',
        'footer_note',
    ];

    /** Parts an empty override deliberately blanks instead of restoring. */
    public const CLEARABLE_PARTS = ['header_subtitle', 'footer_note'];

    /** Display order of the notification groups in the editor. */
    public const GROUPS = [
        'Orders',
        'Returns & Refunds',
        'Account & Access',
        'Appointments',
        'Admin Security',
        'Staff Requests',
    ];

    private const MAROON = '#800000';

    private const SUB = 'Fabrication & Manufacturing Research Center';

    private const ORDER_NOTE = 'You can track your order status by logging into your account at any time.';

    /** Last-resort parts for a slug that is not registered. */
    private const FALLBACK_DEFAULTS = [
        'header_title' => Branding::NAME,
        'header_subtitle' => self::SUB,
        'header_color' => self::MAROON,
        'body_heading' => 'Notification',
        'body_text' => '',
        'footer_note' => '',
    ];

    public const TEMPLATES = [
        'order_received' => [
            'label' => 'Order received',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => self::MAROON,
                'body_heading' => 'Your Order Has Been Received',
                'body_text' => "Hi {customer_name},\n\nThank you for placing your order with UCN-FMRC. We have received your order and it is currently under review. You will be notified once it has been processed.\n\nPlease keep your order number for your reference.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_cancelled_immediately' => [
            'label' => 'Order cancelled right away',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'reason', 'refund_note', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#b45309',
                'body_heading' => 'Your Order Has Been Cancelled',
                'body_text' => "Hi {customer_name},\n\nOrder {order_number} has been cancelled as you requested.\n\nReason: {reason}\n\n{refund_note}\n\nYou can place a new order any time.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_cancellation_requested' => [
            'label' => 'Cancellation request received',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'reason', 'refund_note', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#0a5fd6',
                'body_heading' => 'We Received Your Cancellation Request',
                'body_text' => "Hi {customer_name},\n\nWe received your request to cancel order {order_number}.\n\nReason: {reason}\n\nFMRC has already confirmed your payment for this order, so staff review the request before closing it - that is also how the refund gets arranged. You will be notified as soon as they decide.{refund_note}",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_cancellation_approved' => [
            'label' => 'Cancellation approved',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'reason', 'refund_note', 'staff_note', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#b45309',
                'body_heading' => 'Your Order Has Been Cancelled',
                'body_text' => "Hi {customer_name},\n\nFMRC approved your cancellation request for order {order_number}.\n\nReason: {reason}\n\n{refund_note}\n\n{staff_note}You can place a new order any time.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_cancellation_declined' => [
            'label' => 'Cancellation declined',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'note', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#dc2626',
                'body_heading' => 'We Could Not Cancel Your Order',
                'body_text' => "Hi {customer_name},\n\nFMRC could not cancel order {order_number}.\n\nReason from FMRC: {note}\n\nYour order continues as normal. If you have questions, please reply to this email or message FMRC directly.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_approved' => [
            'label' => 'Order approved',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#059669',
                'body_heading' => 'Your Order Has Been Approved',
                'body_text' => "Hi {customer_name},\n\nGreat news! Your order {order_number} has been approved and is now being processed. We will update you again once your order is ready for shipping or pickup.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_rejected' => [
            'label' => 'Order rejected',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'reason', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#dc2626',
                'body_heading' => 'Your Order Could Not Be Processed',
                'body_text' => "Hi {customer_name},\n\nUnfortunately, your order {order_number} could not be processed at this time.\n\nReason: {reason}\n\nIf you have questions, please contact us directly or place a new order. We apologize for any inconvenience.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_completed' => [
            'label' => 'Order completed',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => self::MAROON,
                'body_heading' => 'Your Order Is Complete!',
                'body_text' => "Hi {customer_name},\n\nYour order {order_number} has been marked as completed. Thank you for choosing UCN-FMRC!\n\nWe hope to serve you again. If you have any feedback, feel free to reach out to us.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'order_tracking_update' => [
            'label' => 'Delivery tracking update',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'stage', 'update_title', 'details', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#1d4ed8',
                'body_heading' => 'Order Update: {stage}',
                'body_text' => "Hi {customer_name},\n\nYour order {order_number} has a new status update.\n\nUpdate: {update_title}\n{details}",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'payment_confirmed' => [
            'label' => 'Payment confirmed',
            'group' => 'Orders',
            'tokens' => ['customer_name', 'order_number', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#059669',
                'body_heading' => 'Payment Confirmed',
                'body_text' => "Hi {customer_name},\n\nYour payment for order {order_number} has been confirmed. Your order is now being prepared for shipping or pickup.\n\nThank you for your purchase!",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'return_request_received' => [
            'label' => 'Return request received',
            'group' => 'Returns & Refunds',
            'tokens' => ['return_no', 'order_number', 'reason', 'resolution', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#8f1111',
                'body_heading' => 'We received your return request',
                'body_text' => "Your return request {return_no} for order {order_number} has been submitted and is now under review.\n\nReason: {reason}\nPreferred resolution: {resolution}\n\nWe will notify you as soon as it has been reviewed.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'return_approved' => [
            'label' => 'Return approved',
            'group' => 'Returns & Refunds',
            'tokens' => ['return_no', 'order_number', 'amount', 'note', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#8f1111',
                'body_heading' => 'Your return request was approved',
                'body_text' => "Good news — return {return_no} has been approved for {amount}.\n\n{note}",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'return_declined' => [
            'label' => 'Return declined',
            'group' => 'Returns & Refunds',
            'tokens' => ['return_no', 'order_number', 'note', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#b71c1c',
                'body_heading' => 'Your return request was declined',
                'body_text' => "Return {return_no} was not approved.\n\nReason: {note}\n\nIf you believe this was a mistake you may file a new request while the return window is still open.",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'return_item_received' => [
            'label' => 'Returned item received',
            'group' => 'Returns & Refunds',
            'tokens' => ['return_no', 'order_number', 'note', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#8f1111',
                'body_heading' => 'We received your returned item',
                'body_text' => "The item for return {return_no} has arrived and passed inspection.\n\n{note}",
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'refund_released' => [
            'label' => 'Refund released',
            'group' => 'Returns & Refunds',
            'tokens' => ['return_no', 'order_number', 'method', 'reference_line', 'note_line', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#2e7d32',
                'body_heading' => 'Your refund has been released',
                'body_text' => 'Your refund for return {return_no} has been released via {method}.{reference_line}{note_line}',
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'refund_processing' => [
            'label' => 'Refund being processed',
            'group' => 'Returns & Refunds',
            'tokens' => ['return_no', 'order_number', 'method', 'note_line', 'amount', 'status'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB,
                'header_color' => '#8f1111',
                'body_heading' => 'Your refund is being processed',
                'body_text' => 'We are releasing your refund for return {return_no} via {method}.{note_line}',
                'footer_note' => self::ORDER_NOTE,
            ],
        ],
        'account_welcome' => [
            'label' => 'Customer account created (self sign-up)',
            'group' => 'Account & Access',
            'tokens' => ['customer_name', 'email'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Customer Portal · ' . self::SUB,
                'header_color' => self::MAROON,
                'body_heading' => 'Welcome to the UCN-FMRC Customer Portal, {customer_name}!',
                'body_text' => "We're pleased to have you on the platform. Your account has been created for the University of Camarines Norte — Fabrication and Manufacturing Research Center (UCN-FMRC), and you can now access appointments, orders, and updates.",
                'footer_note' => 'If you did not create this account, please disregard this email or contact us immediately.',
            ],
        ],
        'account_created_by_admin' => [
            'label' => 'Account created by an administrator',
            'group' => 'Account & Access',
            'tokens' => ['customer_name', 'username', 'email', 'password', 'role'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => self::SUB . ' — Account Notification',
                'header_color' => self::MAROON,
                'body_heading' => 'Your Account Has Been Created, {customer_name}!',
                'body_text' => 'An authorized administrator has created a new {role} account for you on the University of Camarines Norte — Fabrication and Manufacturing Research Center (UCN-FMRC) platform. You may use the credentials below to access the system.',
                'footer_note' => 'If you believe this account was created in error, or if you did not authorize this action, please contact the UCN-FMRC administration team immediately.',
            ],
        ],
        'password_reset_otp' => [
            'label' => 'Password reset OTP',
            'group' => 'Account & Access',
            'tokens' => ['customer_name', 'otp_code'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Fabrication and Manufacturing Research Center',
                'header_color' => self::MAROON,
                'body_heading' => 'Password Reset Verification Code',
                'body_text' => "Hello {customer_name},\nWe received a request to reset the password for your customer account. Use the 6-digit OTP code below to verify your request:",
                'footer_note' => '🔒 If you did not request a password reset, please ignore this email. Your password will remain unchanged. Never share your OTP with anyone.',
            ],
        ],
        'appointment_confirmed' => [
            'label' => 'Appointment confirmed',
            'group' => 'Appointments',
            'tokens' => ['client_name', 'reference_no', 'date', 'time', 'purpose'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Appointment Confirmation',
                'header_color' => self::MAROON,
                'body_heading' => 'Your Appointment Has Been Scheduled',
                'body_text' => "Hi {client_name},\n\nThank you for scheduling an appointment with UCN-FMRC. Below are the details of your booking. Please keep your reference number for your records.",
                'footer_note' => 'Please arrive at the UCN-FMRC office at least 10 minutes before your scheduled time. If you need to cancel or reschedule, please contact us directly.',
            ],
        ],
        'appointment_completed' => [
            'label' => 'Appointment completed / thank you',
            'group' => 'Appointments',
            'tokens' => ['client_name', 'first_name', 'reference_no', 'date', 'time', 'purpose'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Thank You for Your Visit',
                'header_color' => self::MAROON,
                'body_heading' => 'Thank You for Visiting Us, {first_name}!',
                'body_text' => "Hi {client_name},\n\nIt was a genuine pleasure to welcome you to the Fabrication and Manufacturing Research Center. Your appointment is now complete, and we hope our team, our facilities and our service made your visit worthwhile.\n\nMaraming salamat for trusting us with your project — clients like you are the very reason this laboratory exists.",
                'footer_note' => 'Your feedback helps us serve the next client better, so please tell us how we did through any of the channels above. Until your next visit — keep creating, and we will keep the machines ready for you.',
            ],
        ],
        'admin_email_change_otp' => [
            'label' => 'Admin Gmail change — verification code',
            'group' => 'Admin Security',
            'tokens' => ['admin_name', 'otp_code', 'minutes'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Confirm Your New Gmail',
                'header_color' => self::MAROON,
                'body_heading' => 'Verify this address to finish the change',
                'body_text' => "Hi {admin_name},\n\nThis address was entered as the new Gmail for your UCN-FMRC admin account. Enter the code below on the My Account page to confirm it. Your account keeps its current Gmail until you do.",
                'footer_note' => 'If you were not expecting this, you can ignore this email — nothing has changed yet, and the request expires on its own.',
            ],
        ],
        'admin_email_change_committed' => [
            'label' => 'Admin Gmail changed — security alert',
            'group' => 'Admin Security',
            'tokens' => ['admin_name', 'new_email', 'old_email', 'occurred_at'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Account Security Alert',
                'header_color' => self::MAROON,
                'body_heading' => 'The Gmail on your account was changed',
                'body_text' => "Hi {admin_name},\n\nPassword resets and notifications for your UCN-FMRC admin account will now go to the new address. This message is the last one sent to {old_email}.",
                'footer_note' => 'If you did not make this change, use one of your one-time recovery codes on the admin sign-in page to take the account back, then set a new password immediately.',
            ],
        ],
        'admin_recovery_code_used' => [
            'label' => 'Recovery code used to reset a password',
            'group' => 'Admin Security',
            'tokens' => ['admin_name', 'occurred_at', 'ip', 'remaining'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Account Security Alert',
                'header_color' => self::MAROON,
                'body_heading' => 'A recovery code was used to reset your password',
                'body_text' => "Hi {admin_name},\n\nSomeone signed in to the admin recovery page and used one of your one-time recovery codes to set a new password. That code has now been used up and cannot be used again.",
                'footer_note' => 'If this was not you, sign in immediately, change your password, and generate a new set of recovery codes from My Account. Generating a new set instantly cancels every remaining old code.',
            ],
        ],
        'admin_recovery_codes_replaced' => [
            'label' => 'Recovery codes replaced',
            'group' => 'Admin Security',
            'tokens' => ['admin_name', 'occurred_at'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Account Security Alert',
                'header_color' => self::MAROON,
                'body_heading' => 'Your recovery codes were replaced',
                'body_text' => "Hi {admin_name},\n\nA new set of 10 one-time recovery codes was generated for your admin account. Every code from the previous set has been cancelled and will no longer work.",
                'footer_note' => 'If you did not do this, your account password may be compromised. Change your password right away.',
            ],
        ],
        'staff_request_approved' => [
            'label' => 'Staff account request approved',
            'group' => 'Staff Requests',
            'tokens' => ['staff_name', 'first_name', 'username', 'email', 'role'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Staff Account Request Approved',
                'header_color' => self::MAROON,
                'body_heading' => 'Welcome to the Team, {first_name}!',
                'body_text' => "Hi {staff_name},\n\nYour request for a staff account at the Fabrication and Manufacturing Research Center has been reviewed and approved by an administrator. Your account is active as of now, and you may sign in to the staff workspace right away.",
                'footer_note' => 'Please keep your credentials private and sign out whenever you leave a shared computer. If you did not request this account, tell the FMRC office immediately using any of the channels above.',
            ],
        ],
        'staff_request_rejected' => [
            'label' => 'Staff account request not approved',
            'group' => 'Staff Requests',
            'tokens' => ['staff_name', 'first_name', 'username', 'email'],
            'defaults' => [
                'header_title' => Branding::NAME,
                'header_subtitle' => 'Staff Account Request Update',
                'header_color' => self::MAROON,
                'body_heading' => 'Thank You for Your Interest, {first_name}',
                'body_text' => "Hi {staff_name},\n\nThank you for requesting a staff account at the Fabrication and Manufacturing Research Center. After review, an administrator was not able to approve this request, so no account has been created and the details you submitted are no longer held as sign-in credentials.",
                'footer_note' => '',
            ],
        ],
    ];

    /** @return list<string> */
    public static function slugs(): array
    {
        return array_keys(self::TEMPLATES);
    }

    public static function has(string $slug): bool
    {
        return isset(self::TEMPLATES[$slug]);
    }

    /** @return array<string, string> */
    public static function defaults(string $slug): array
    {
        return self::TEMPLATES[$slug]['defaults'] ?? [];
    }

    /**
     * The whole registry plus whatever is saved, for the editor page. Sending the
     * defaults down means the browser never carries a second copy of the copy.
     *
     * @return list<array<string, mixed>>
     */
    public static function registry(): array
    {
        $out = [];

        foreach (self::TEMPLATES as $slug => $meta) {
            $out[] = [
                'slug' => $slug,
                'label' => $meta['label'],
                'group' => $meta['group'],
                'tokens' => $meta['tokens'],
                'defaults' => $meta['defaults'],
                'saved' => self::stored($slug),
            ];
        }

        return $out;
    }

    /**
     * Read one template's saved override. Never throws: a missing row, an
     * unreachable database or a malformed JSON blob all read as "no override",
     * because an order email must go out either way.
     *
     * @return array<string, string>
     */
    private static function stored(string $slug): array
    {
        try {
            $raw = SiteSetting::get(self::KEY_PREFIX . $slug);
        } catch (Throwable) {
            return [];
        }

        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        if (! is_array($decoded)) {
            return [];
        }

        $clean = [];

        foreach (self::EDITABLE_PARTS as $part) {
            // A null (or non-string) entry reads as "no override" -- that is what
            // Reset to default writes.
            if (isset($decoded[$part]) && is_string($decoded[$part])) {
                $clean[$part] = $decoded[$part];
            }
        }

        return $clean;
    }

    /**
     * The six parts of one notification, override merged over the default and
     * with every {token} substituted. Plain text -- shell() does the escaping.
     *
     * @param  array<string, mixed>  $tokens
     * @return array<string, string>
     */
    public static function resolve(string $slug, array $tokens = []): array
    {
        return self::merge($slug, self::stored($slug), $tokens);
    }

    /**
     * Merge one set of overrides over a slug's defaults and substitute tokens.
     * Shared by resolve() (overrides from site_settings) and previewDraft()
     * (overrides straight from the editor, before they are saved).
     *
     * @param  array<string, mixed>  $override
     * @param  array<string, mixed>  $tokens
     * @return array<string, string>
     */
    private static function merge(string $slug, array $override, array $tokens): array
    {
        $defaults = self::defaults($slug) ?: self::FALLBACK_DEFAULTS;
        $parts = [];

        foreach (self::EDITABLE_PARTS as $part) {
            $overridden = array_key_exists($part, $override) && is_string($override[$part]);
            $value = $overridden ? $override[$part] : '';

            // Blank only wins when the admin actually saved it blank, and only
            // for the two optional lines -- never let a cleared heading or body
            // ship an empty email.
            if (! $overridden || (trim($value) === '' && ! in_array($part, self::CLEARABLE_PARTS, true))) {
                $value = (string) ($defaults[$part] ?? '');
            }

            $parts[$part] = self::substitute((string) $value, $tokens);
        }

        $parts['header_color'] = self::color(
            $parts['header_color'],
            (string) ($defaults['header_color'] ?? self::MAROON),
        );

        return $parts;
    }

    /**
     * Replace every {token} in one pass so a substituted value can never itself
     * be re-substituted. An unknown placeholder is left visible rather than
     * silently dropped, so a typo shows up in the preview.
     *
     * @param  array<string, mixed>  $tokens
     */
    private static function substitute(string $text, array $tokens): string
    {
        if ($tokens === [] || ! str_contains($text, '{')) {
            return $text;
        }

        return (string) preg_replace_callback(
            '/\{([A-Za-z0-9_]{1,40})\}/',
            static function (array $m) use ($tokens): string {
                $key = strtolower($m[1]);

                if (! array_key_exists($key, $tokens)) {
                    return $m[0];
                }

                $value = $tokens[$key];

                return is_scalar($value) && ! is_bool($value) ? (string) $value : '';
            },
            $text,
        );
    }

    /** A #rrggbb colour, or the fallback when the override is not one. */
    public static function color(mixed $value, string $fallback = self::MAROON): string
    {
        $value = is_string($value) ? trim($value) : '';

        if (preg_match('/^#[0-9a-fA-F]{6}$/', $value) === 1) {
            return $value;
        }

        return preg_match('/^#[0-9a-fA-F]{6}$/', $fallback) === 1 ? $fallback : self::MAROON;
    }

    /**
     * Render one notification. Structured, code-owned markup (OTP digits, the
     * order summary chip, credential cards, CTA buttons, contact tables) is
     * passed in as $extraHtml and sits between the body and the footer note.
     *
     * @param  array<string, mixed>  $tokens
     */
    public static function render(string $slug, array $tokens = [], string $extraHtml = ''): string
    {
        try {
            return self::shell(self::resolve($slug, $tokens), $extraHtml);
        } catch (Throwable) {
            // Fail soft: the compiled-in copy still goes out.
            $defaults = self::defaults($slug) ?: self::FALLBACK_DEFAULTS;
            $parts = [];

            foreach (self::EDITABLE_PARTS as $part) {
                $parts[$part] = self::substitute((string) ($defaults[$part] ?? ''), $tokens);
            }

            return self::shell($parts, $extraHtml);
        }
    }

    private static function text(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES);
    }

    private static function prose(mixed $value): string
    {
        return nl2br(htmlspecialchars((string) $value, ENT_QUOTES));
    }

    /**
     * The one 600 px table shell all 27 notifications share, lifted from the
     * order builder because that was already the most complete of the three
     * near-identical shells this replaced.
     *
     * Order: header band -> body heading -> body text -> $extraHtml ->
     * footer note -> code-owned legal footer.
     *
     * @param  array<string, string>  $parts
     */
    public static function shell(array $parts, string $extraHtml = ''): string
    {
        $headerColor = self::color($parts['header_color'] ?? '');
        $title = self::text($parts['header_title'] ?? Branding::NAME);
        $subtitle = self::text($parts['header_subtitle'] ?? '');
        $heading = self::text($parts['body_heading'] ?? '');
        $body = self::prose($parts['body_text'] ?? '');
        $note = self::prose($parts['footer_note'] ?? '');

        $appName = Branding::NAME;
        $institution = Branding::INSTITUTION;
        $year = date('Y');
        $docTitle = $heading !== '' ? $heading : $title;

        $subtitleHtml = $subtitle === '' ? '' : "\n            "
            . "<p style=\"margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px;\">{$subtitle}</p>";
        $headingHtml = $heading === '' ? '' : "\n            "
            . "<h2 style=\"margin:0 0 12px;color:#1a202c;font-size:18px;\">{$heading}</h2>";
        $bodyHtml = $body === '' ? '' : "\n            "
            . "<p style=\"margin:0 0 20px;color:#4a5568;font-size:14px;line-height:1.7;\">{$body}</p>";
        $noteHtml = $note === '' ? '' : "\n            "
            . "<p style=\"margin:0;color:#718096;font-size:12px;\">{$note}</p>";
        $extra = trim($extraHtml) === '' ? '' : "\n            " . trim($extraHtml);

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{$docTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09);max-width:600px;">
        <!-- Header -->
        <tr>
          <td style="background:{$headerColor};padding:28px 36px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:.3px;">{$title}</h1>{$subtitleHtml}
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">{$headingHtml}{$bodyHtml}{$extra}{$noteHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fb;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;">
            <p style="margin:0;color:#a0aec0;font-size:11px;">
              &copy; {$year} {$appName} &middot; {$institution}. All rights reserved.<br>
              This is an automated notification &mdash; please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
HTML;
    }

    /**
     * Sample values for the editor preview, keyed by token name. Every token any
     * registry entry declares has an entry here, so a preview never shows a raw
     * {placeholder} and the admin sees the sentence as a customer will read it.
     */
    private const SAMPLE_TOKENS = [
        'customer_name' => 'Maria Santos',
        'client_name' => 'Maria Santos',
        'staff_name' => 'Juan Dela Cruz',
        'admin_name' => 'Administrator',
        'first_name' => 'Maria',
        'username' => 'msantos',
        'email' => 'maria.santos@gmail.com',
        'password' => 'Temp-Pass-2026',
        'role' => 'Customer',
        'order_number' => 'ORD-2026-0142',
        'amount' => '2,450.00',
        'status' => 'Pending',
        'return_no' => 'RET-2026-0031',
        'reference_no' => 'APT-2026-0091',
        'reason' => 'The item delivered was the wrong size.',
        'resolution' => 'Refund',
        'stage' => 'Out for Delivery',
        'update_title' => 'Out for Delivery',
        'details' => 'Your parcel left the FMRC office at 9:40 AM.',
        'method' => 'GCash',
        'note' => 'Please bring a valid ID when you collect the item.',
        'note_line' => 'Please bring a valid ID when you collect the item.',
        'staff_note' => 'Verified against the submitted receipt.',
        'refund_note' => 'The amount should reflect within 3 banking days.',
        'reference_line' => 'GCash reference 9F2K4L8M',
        'otp_code' => '4 8 2 9 1 3',
        'minutes' => '10',
        'ip' => '203.0.113.24',
        'occurred_at' => 'September 1, 2026 at 9:14 AM',
        'remaining' => '7',
        'new_email' => 'ma******@gmail.com',
        'old_email' => 'maria.santos@gmail.com',
        'date' => 'September 14, 2026',
        'time' => '9:00 AM',
        'purpose' => '3D Printing Consultation',
    ];

    /**
     * The sample tokens one slug declares. Anything unmapped falls back to the
     * token name in capitals so a newly added token is obvious in the preview.
     *
     * @return array<string, string>
     */
    public static function sampleTokens(string $slug): array
    {
        $out = [];

        foreach (self::TEMPLATES[$slug]['tokens'] ?? [] as $token) {
            $out[$token] = self::SAMPLE_TOKENS[$token]
                ?? strtoupper(str_replace('_', ' ', (string) $token));
        }

        return $out;
    }

    /**
     * A stand-in for the code-owned block that sits between the body and the
     * footer note. It is deliberately labelled: the preview has to show the
     * admin where the locked content lands without pretending the exact card
     * (OTP digits, credential table, order chip) is theirs to edit.
     */
    public static function previewExtra(string $slug, ?string $accent = null): string
    {
        $accent = self::color($accent ?? self::resolve($slug)['header_color']);
        $rows = '';

        foreach (self::sampleTokens($slug) as $token => $value) {
            $label = self::text(strtoupper(str_replace('_', ' ', $token)));
            $rows .= '
              <tr>
                <td style="padding:9px 20px;border-top:1px solid #f1f4f8;">
                  <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">' . $label . '</span><br>
                  <span style="color:#374151;font-size:14px;font-weight:600;">' . self::text($value) . '</span>
                </td>
              </tr>';
        }

        return '<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
              <tr>
                <td style="padding:14px 20px 10px;">
                  <span style="color:' . $accent . ';font-size:13px;font-weight:800;">Fixed content for this notification</span>
                  <p style="margin:5px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">Details, codes and buttons are filled in automatically when the email is sent. They cannot be edited here, and they follow the header colour you choose.</p>
                </td>
              </tr>' . $rows . '
            </table>';
    }

    /** One notification rendered with sample content, for the editor preview. */
    public static function preview(string $slug): string
    {
        return self::render($slug, self::sampleTokens($slug), self::previewExtra($slug));
    }

    /**
     * The same preview, but from parts the editor has not saved yet, so the
     * admin sees the effect of an edit before committing it. Anything the draft
     * omits falls back to that slug's default, exactly as a real send would.
     *
     * @param  array<string, mixed>  $draft
     */
    public static function previewDraft(string $slug, array $draft): string
    {
        $parts = self::merge($slug, $draft, self::sampleTokens($slug));

        return self::shell($parts, self::previewExtra($slug, $parts['header_color']));
    }
}
