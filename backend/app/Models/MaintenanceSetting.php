<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Maintenance Mode (STEP 11, Part B).
 *
 * One row per gate-able scope. The class owns the canonical scope list and the
 * default copy so the controller, the middleware and the customer-facing
 * snapshot can never disagree about which keys exist.
 */
class MaintenanceSetting extends Model
{
    protected $fillable = ['scope', 'is_active', 'message', 'updated_by'];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    /**
     * The 11 scopes, in the order the admin UI lists them: two account gates,
     * five customer pages, four home-page sections. Any key outside this map is
     * rejected by the API.
     */
    public const DEFAULTS = [
        'customer_register' => 'Account registration is temporarily closed for scheduled maintenance.',
        'customer_login'    => 'Customer sign-in is temporarily unavailable while we perform maintenance.',
        'page_home'         => 'Our home page is briefly offline for maintenance. Please check back soon.',
        'page_services'     => 'The Services page is under maintenance. It will be back shortly.',
        'page_products'     => 'The Products page is under maintenance. Orders will reopen shortly.',
        'page_contact'      => 'Our contact form is under maintenance. Please reach us again later.',
        'page_appointment'  => 'Appointment booking is paused for maintenance. Please try again later.',
        'home_about'        => 'The About Us section is being updated. Please check back shortly.',
        'home_mission'      => 'The Mission section is being updated. Please check back shortly.',
        'home_vision'       => 'The Vision section is being updated. Please check back shortly.',
        'home_offer'        => 'What We Offer is being updated. Please check back shortly.',
    ];

    /** The whole scope list, for validation. */
    public static function scopes(): array
    {
        return array_keys(self::DEFAULTS);
    }

    public static function isKnownScope(string $scope): bool
    {
        return array_key_exists($scope, self::DEFAULTS);
    }

    /**
     * Every scope, with rows that do not exist yet filled in from the defaults.
     * Shape: ['<scope>' => ['active' => bool, 'message' => string], ...].
     */
    public static function snapshot(): array
    {
        $rows = static::query()->get()->keyBy('scope');
        $out = [];

        foreach (self::DEFAULTS as $scope => $default) {
            $row = $rows->get($scope);
            $message = $row && trim((string) $row->message) !== ''
                ? (string) $row->message
                : $default;

            $out[$scope] = [
                'active'  => (bool) ($row->is_active ?? false),
                'message' => $message,
            ];
        }

        return $out;
    }

    /** Is this scope currently under maintenance? Unknown scopes are never active. */
    public static function isActive(string $scope): bool
    {
        if (!self::isKnownScope($scope)) {
            return false;
        }

        $row = static::where('scope', $scope)->first();

        return (bool) ($row->is_active ?? false);
    }

    /** The admin's message for a scope, falling back to the bundled default. */
    public static function messageFor(string $scope): string
    {
        $default = self::DEFAULTS[$scope] ?? 'This section is temporarily unavailable for maintenance.';
        $row = static::where('scope', $scope)->first();
        $message = trim((string) ($row->message ?? ''));

        return $message !== '' ? $message : $default;
    }
}
