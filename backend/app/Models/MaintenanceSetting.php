<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

/**
 * Maintenance Mode (STEP 11, Part B).
 *
 * One row per gate-able scope. The class owns the canonical scope list and the
 * default copy so the controller, the middleware and the customer-facing
 * snapshot can never disagree about which keys exist.
 *
 * Every read fails OPEN. A Hostinger deploy copies files without running
 * migrations, so there is always a window where this code exists and its table
 * does not; in that window the whole feature has to behave as if nothing is
 * under maintenance rather than throw. EnsureNotUnderMaintenance and
 * AuthController already guarded their own calls -- these three statics now
 * guard themselves, which is what GET /api/maintenance needs (it was the one
 * read path that could still 500 and it is the path both the admin panel and
 * the customer gate depend on).
 */
class MaintenanceSetting extends Model
{
    protected $fillable = ['scope', 'is_active', 'message', 'updated_by'];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    /** Memoised per request: Schema::hasTable() is a real query. */
    private static ?bool $tableReady = null;

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
     * Has `php artisan migrate` been run on this server yet?
     *
     * The admin panel surfaces this so a blank set of switches can be told apart
     * from "the table is not there", which are otherwise identical on screen.
     */
    public static function tableReady(): bool
    {
        if (self::$tableReady === null) {
            try {
                self::$tableReady = Schema::hasTable('maintenance_settings');
            } catch (\Throwable $e) {
                self::$tableReady = false;
            }
        }

        return self::$tableReady;
    }

    /**
     * Every scope, with rows that do not exist yet filled in from the defaults.
     * Shape: ['<scope>' => ['active' => bool, 'message' => string], ...].
     */
    public static function snapshot(): array
    {
        $rows = collect();

        if (self::tableReady()) {
            try {
                $rows = static::query()->get()->keyBy('scope');
            } catch (\Throwable $e) {
                // Nothing under maintenance is the safe reading of a broken
                // read: the customer site stays up and the admin panel says so.
                $rows = collect();
            }
        }

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
        if (!self::isKnownScope($scope) || !self::tableReady()) {
            return false;
        }

        try {
            $row = static::where('scope', $scope)->first();
        } catch (\Throwable $e) {
            return false;
        }

        return (bool) ($row->is_active ?? false);
    }

    /** The admin's message for a scope, falling back to the bundled default. */
    public static function messageFor(string $scope): string
    {
        $default = self::DEFAULTS[$scope] ?? 'This section is temporarily unavailable for maintenance.';

        if (!self::tableReady()) {
            return $default;
        }

        try {
            $row = static::where('scope', $scope)->first();
        } catch (\Throwable $e) {
            return $default;
        }

        $message = trim((string) ($row->message ?? ''));

        return $message !== '' ? $message : $default;
    }
}
