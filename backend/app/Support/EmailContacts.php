<?php

namespace App\Support;

use App\Models\SiteSetting;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Throwable;

final class EmailContacts
{
    // Shares the existing Admin-only/private email-settings namespace.
    public const KEY = 'email_tpl_official_contacts';

    public static function https(mixed $url): bool
    {
        return is_string($url) && strlen($url) <= 2048 && ! preg_match('/[\x00-\x20\x7f]/', $url)
            && filter_var($url, FILTER_VALIDATE_URL) && strtolower(parse_url($url, PHP_URL_SCHEME) ?? '') === 'https'
            && ! parse_url($url, PHP_URL_USER) && ! parse_url($url, PHP_URL_PASS);
    }

    public static function phone(mixed $phone): bool
    {
        return is_string($phone) && preg_match('/^\+?[0-9][0-9 ().-]{3,38}[0-9]$/', $phone)
            && strlen(preg_replace('/\D/', '', $phone)) >= 5;
    }

    public static function validate(array $values, bool $complete = true): array
    {
        $values = array_map(static fn ($value) => is_string($value) ? trim($value) : $value, $values);
        Validator::make($values, [
            'facebook_url' => [$complete ? 'required' : 'present', 'nullable', 'string', fn ($a, $v, $fail) => self::https($v) ?: $fail('Enter a valid HTTPS Facebook link.')],
            'website_url' => [$complete ? 'required' : 'present', 'nullable', 'string', fn ($a, $v, $fail) => self::https($v) ?: $fail('Enter a valid HTTPS website link.')],
            'phone' => [$complete ? 'required' : 'present', 'nullable', 'string', fn ($a, $v, $fail) => self::phone($v) ?: $fail('Enter a valid contact phone number.')],
        ])->validate();
        if (array_diff(array_keys($values), ['facebook_url', 'website_url', 'phone'])) {
            throw ValidationException::withMessages(['contact_footer' => 'Only Facebook, website and phone contacts may be changed.']);
        }

        return array_map(static fn ($value) => trim((string) $value), $values);
    }

    public static function setting(mixed $raw): string
    {
        if ($raw === '' || $raw === null) {
            return '';
        }
        $values = is_string($raw) ? json_decode($raw, true) : null;
        if (! is_array($values)) {
            throw ValidationException::withMessages([self::KEY => 'Enter valid email contact settings.']);
        }

        return json_encode(self::validate($values), JSON_THROW_ON_ERROR);
    }

    public static function configuration(): array
    {
        $settings = [];
        try {
            $settings = SiteSetting::whereIn('key', [self::KEY, 'contact_facebook_url', 'footer_contact_facebook_url', 'contact_phone', 'footer_contact_phone'])->pluck('value', 'key')->all();
        } catch (Throwable) { /* Essential emails must still render without settings storage. */
        }
        $pick = static function ($keys, $valid) use ($settings) {
            foreach ($keys as $key) {
                if ($valid($settings[$key] ?? null)) {
                    return trim($settings[$key]);
                }
            }

            return '';
        };
        $website = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');
        $defaults = [
            'facebook_url' => $pick(['contact_facebook_url', 'footer_contact_facebook_url'], self::https(...)),
            'website_url' => self::https($website) ? $website : 'https://ucn-fabmanlab.com',
            'phone' => $pick(['contact_phone', 'footer_contact_phone'], self::phone(...)),
        ];
        $saved = json_decode($settings[self::KEY] ?? 'null', true);
        $effective = $defaults;
        foreach (['facebook_url', 'website_url', 'phone'] as $key) {
            $valid = $key === 'phone' ? self::phone(...) : self::https(...);
            if (is_array($saved) && $valid($saved[$key] ?? null)) {
                $effective[$key] = trim($saved[$key]);
            }
        }

        return ['key' => self::KEY, 'defaults' => $defaults, 'saved' => is_array($saved) ? $saved : null, 'effective' => $effective];
    }

    public static function resolve(?array $draft = null): array
    {
        return $draft ?? self::configuration()['effective'];
    }

    public static function html(?array $draft = null): string
    {
        $contacts = self::resolve($draft);
        $links = [];
        foreach (['facebook_url' => 'Facebook', 'website_url' => 'Official website', 'phone' => ($contacts['phone'] ?? '')] as $key => $label) {
            $value = $contacts[$key] ?? '';
            if (! ($key === 'phone' ? self::phone($value) : self::https($value))) {
                continue;
            }
            $href = $key === 'phone' ? 'tel:'.preg_replace('/[^0-9+]/', '', $value) : $value;
            $links[] = '<a href="'.htmlspecialchars($href, ENT_QUOTES).'" style="display:inline-block;margin:5px 10px;color:#6b202b;font-size:13px;font-weight:600;text-decoration:underline;">'.htmlspecialchars($label, ENT_QUOTES).'</a>';
        }

        return $links ? '<p style="margin:0 0 8px;color:#6b202b;font-size:13px;font-weight:700;">Contact the FMRC</p><p style="margin:0 0 14px;line-height:1.8;">'.implode(' ', $links).'</p>' : '';
    }
}
