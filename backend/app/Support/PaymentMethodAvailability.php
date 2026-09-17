<?php

namespace App\Support;

use App\Models\SiteSetting;

final class PaymentMethodAvailability
{
    public const SETTING_KEYS = [
        'COP' => 'payment_cash_on_pickup_enabled',
        'COD' => 'payment_cash_on_delivery_enabled',
        'GCash' => 'payment_gcash_enabled',
    ];

    public static function rules(): array
    {
        return array_fill_keys(array_values(self::SETTING_KEYS), ['sometimes', 'required', 'boolean']);
    }

    /** Missing settings preserve checkout behavior on existing installations. */
    public static function publicSettings(array $settings): array
    {
        $values = [];
        foreach (self::SETTING_KEYS as $key) {
            $value = array_key_exists($key, $settings) ? $settings[$key] : '1';
            $values[$key] = self::canonicalValue($value);
        }

        return $values;
    }

    public static function canonicalValue(mixed $value): string
    {
        return in_array($value, [true, 1, '1'], true) ? '1' : '0';
    }

    public static function isEnabled(string $method): bool
    {
        $key = self::SETTING_KEYS[$method] ?? null;

        return $key !== null && self::canonicalValue(SiteSetting::get($key, '1')) === '1';
    }
}
