<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

/** The optional visual treatment for the customer-wide maintenance page. */
class MaintenancePageSetting extends Model
{
    protected $fillable = [
        'eyebrow', 'headline', 'headline_accent', 'supporting_line',
        'image_path', 'image_alt', 'theme', 'updated_by',
    ];

    public const DEFAULTS = [
        'eyebrow' => 'A little work in progress',
        'headline' => 'We’ll be back',
        'headline_accent' => 'soon.',
        'supporting_line' => 'Thank you for your patience.',
        'image_url' => '',
        'image_alt' => 'Technician maintaining a website server',
        'theme' => 'cream_maroon',
    ];

    public const THEMES = ['cream_maroon', 'warm_maroon', 'soft_gold'];

    /** Concise copy keeps the fixed screen readable on compact phones. */
    public const TEXT_LIMITS = [
        'eyebrow' => 48,
        'headline' => 60,
        'headline_accent' => 30,
        'supporting_line' => 100,
        'image_alt' => 120,
    ];

    /** Missing additive migration must never take the customer website down. */
    public static function available(): bool
    {
        try {
            return Schema::hasTable('maintenance_page_settings');
        } catch (\Throwable $e) {
            return false;
        }
    }

    public static function snapshot(): array
    {
        if (! self::available()) {
            return self::DEFAULTS;
        }

        try {
            $row = static::query()->first();
        } catch (\Throwable $e) {
            return self::DEFAULTS;
        }

        if (! $row) {
            return self::DEFAULTS;
        }

        $out = self::DEFAULTS;
        foreach (['eyebrow', 'headline', 'headline_accent', 'supporting_line', 'image_alt'] as $field) {
            if (is_string($row->{$field})) {
                $out[$field] = $row->{$field};
            }
        }
        if (in_array($row->theme, self::THEMES, true)) {
            $out['theme'] = $row->theme;
        }
        if (is_string($row->image_path) && preg_match('~^maintenance/site-page-[a-f0-9]{24}\.(?:png|jpg|webp)$~', $row->image_path)) {
            $out['image_url'] = '/storage/'.$row->image_path;
        }

        return $out;
    }
}
