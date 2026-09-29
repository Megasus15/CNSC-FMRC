<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

final class PortalAppearanceSettings
{
    public const PREFIXES = ['portal_customer_', 'portal_admin_'];

    public const TEXT_LIMITS = [
        'brand_name' => 80,
        'portal_name' => 80,
        'university_name' => 120,
        'image_kicker' => 80,
        'image_title' => 160,
        'image_description' => 320,
        'center_name' => 160,
    ];

    /** Only presentation settings belong to these reserved portal namespaces. */
    public static function rejectUnsupportedKeys(array $input): void
    {
        $supported = self::rules();
        $errors = [];

        foreach ($input as $key => $value) {
            if (! is_string($key)) {
                continue;
            }

            foreach (self::PREFIXES as $prefix) {
                if (str_starts_with($key, $prefix) && ! array_key_exists($key, $supported)) {
                    $errors[$key] = 'Only portal artwork, branding, and image layout can be customized.';
                    break;
                }
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    public static function rules(): array
    {
        $rules = [];

        foreach (self::PREFIXES as $prefix) {
            // Artwork follows the existing site-setting format: an image data
            // URL or asset path. Null restores the portal's bundled artwork.
            foreach (['background_image', 'logo_primary_image', 'logo_secondary_image'] as $suffix) {
                $rules[$prefix.$suffix] = [
                    'sometimes', 'nullable', 'string',
                    static function (string $attribute, mixed $value, \Closure $fail): void {
                        if (is_string($value) && ! self::isSafeImageReference($value)) {
                            $fail("The {$attribute} must be a PNG, JPEG, GIF, or WebP image, or a valid image URL or asset path.");
                        }
                    },
                ];
            }

            $rules[$prefix.'image_side'] = ['sometimes', 'required', 'string', 'in:left,right'];
            $rules[$prefix.'image_position'] = ['sometimes', 'required', 'string', 'in:center,top,bottom'];
            $rules[$prefix.'overlay_opacity'] = ['sometimes', 'required', 'numeric', 'between:0,1'];

            foreach (self::TEXT_LIMITS as $suffix => $limit) {
                $rules[$prefix.$suffix] = [
                    'sometimes',
                    'nullable',
                    'string',
                    'max:'.$limit,
                    static function (string $attribute, mixed $value, \Closure $fail) use ($limit): void {
                        // HTML maxlength counts UTF-16 code units, including
                        // two units for emoji, rather than Unicode code points.
                        if (is_string($value) && strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')) / 2 > $limit) {
                            $fail("The {$attribute} must not exceed {$limit} characters.");
                        }
                    },
                ];
            }
        }

        return $rules;
    }

    private static function isSafeImageReference(string $value): bool
    {
        if ($value === '') {
            return true;
        }

        if (str_starts_with($value, 'data:')) {
            return preg_match('/\Adata:image\/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+\/=]+)\z/i', $value, $matches) === 1
                && base64_decode($matches[1], true) !== false;
        }

        if (preg_match('/[\x00-\x1F\x7F<>"\'`\\\\]/', $value) === 1 || str_starts_with($value, '//') || str_starts_with($value, '#')) {
            return false;
        }

        if (preg_match('/\A[a-z][a-z0-9+.-]*:/i', $value) === 1) {
            $parts = parse_url($value);

            return is_array($parts)
                && in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
                && ($parts['host'] ?? '') !== '';
        }

        return true;
    }
}
