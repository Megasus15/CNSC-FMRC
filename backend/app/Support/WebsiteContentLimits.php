<?php

namespace App\Support;

final class WebsiteContentLimits
{
    /**
     * Public copy limits, shared by create/update validation. Artwork and media
     * settings deliberately have no prose limit: they may contain data URLs.
     */
    public const SETTINGS = [
        // JSON array of labels managed in the Services editor. The labels
        // themselves are checked client-side and are also bounded as a payload.
        'editorial_services_categories' => 3000,
        'hero_title' => 120,
        'home_sdg_heading' => 160,
        'about_heading' => 80,
        'about_text_1' => 1000,
        'about_text_2' => 1000,
        'mission_heading' => 80,
        'mission_text' => 700,
        'vision_heading' => 80,
        'vision_text' => 700,
        'editorial_home_hero_browse' => 28,
        'editorial_home_hero_appointment' => 28,
        'editorial_home_hero_scroll' => 20,
        'editorial_home_intro_kicker' => 64,
        'editorial_home_intro_title' => 80,
        'editorial_home_intro_copy' => 500,
        'editorial_home_intro_audience' => 120,
        'editorial_home_intro_link' => 32,
        'editorial_home_services_kicker' => 64,
        'editorial_home_services_title' => 100,
        'editorial_home_services_copy' => 500,
        'editorial_home_services_link' => 32,
        'editorial_home_services_empty' => 160,
        'editorial_home_services_error' => 180,
        'editorial_home_services_retry' => 28,
        'editorial_home_steps_kicker' => 64,
        'editorial_home_steps_title' => 100,
        'editorial_home_steps_copy' => 500,
        'editorial_home_step_1_title' => 70,
        'editorial_home_step_1_copy' => 280,
        'editorial_home_step_1_link' => 32,
        'editorial_home_step_2_title' => 70,
        'editorial_home_step_2_copy' => 280,
        'editorial_home_step_3_title' => 70,
        'editorial_home_step_3_copy' => 280,
        'editorial_home_cta_kicker' => 64,
        'editorial_home_cta_title' => 80,
        'editorial_home_cta_copy' => 500,
        'editorial_home_cta_button' => 32,
        'editorial_home_cta_contact' => 32,
        'editorial_about_page_kicker' => 64,
        'editorial_about_page_copy' => 500,
        'editorial_about_profile_kicker' => 64,
        'editorial_about_profile_title' => 100,
        'editorial_about_purpose_kicker' => 64,
        'editorial_about_purpose_title' => 100,
        'editorial_about_purpose_copy' => 500,
        'editorial_about_audiences_kicker' => 64,
        'editorial_about_audiences_title' => 100,
        'editorial_about_audiences_copy' => 500,
        'editorial_about_audience_1_title' => 70,
        'editorial_about_audience_1_copy' => 280,
        'editorial_about_audience_2_title' => 70,
        'editorial_about_audience_2_copy' => 280,
        'editorial_about_audience_3_title' => 70,
        'editorial_about_audience_3_copy' => 280,
        'editorial_about_cta_kicker' => 64,
        'editorial_about_cta_title' => 80,
        'editorial_about_cta_copy' => 500,
        'editorial_about_cta_button' => 32,
        'editorial_about_cta_contact' => 32,
        'editorial_services_kicker' => 48,
        'editorial_services_title' => 48,
        'editorial_services_subtitle' => 150,
        'editorial_services_learn_more' => 28,
        'editorial_services_image_placeholder' => 48,
        'editorial_services_details_kicker' => 40,
        'editorial_services_features_heading' => 48,
        'editorial_services_materials_heading' => 48,
        'editorial_services_best_for_heading' => 48,
        'editorial_services_empty_message' => 160,
        'editorial_services_error_message' => 180,
    ];

    public const SERVICE_TEXT = [
        'title' => 100,
        'category' => 60,
        'description' => 360,
        'modal_description' => 2500,
    ];

    public const SERVICE_LISTS = ['modal_features', 'modal_materials', 'modal_best_for'];
    public const SERVICE_LIST_COUNT = 12;
    public const SERVICE_LIST_TEXT = 120;

    public static function settingsRules(): array
    {
        $rules = [];
        foreach (self::SETTINGS as $key => $limit) {
            $rules[$key] = ['sometimes', 'nullable', 'string', 'max:'.$limit, self::browserLength($limit)];
        }

        return $rules;
    }

    public static function serviceRules(bool $partial = false): array
    {
        $rules = [];
        foreach (self::SERVICE_TEXT as $key => $limit) {
            $required = in_array($key, ['title', 'category'], true);
            $rules[$key] = $required
                ? ($partial ? ['sometimes', 'required'] : ['required'])
                : ['sometimes', 'nullable'];
            $rules[$key][] = 'string';
            $rules[$key][] = 'max:'.$limit;
            $rules[$key][] = self::browserLength($limit);
        }
        foreach (self::SERVICE_LISTS as $key) {
            $rules[$key] = ['sometimes', 'nullable', 'array', 'max:'.self::SERVICE_LIST_COUNT];
            $rules[$key.'.*'] = ['string', 'max:'.self::SERVICE_LIST_TEXT, self::browserLength(self::SERVICE_LIST_TEXT)];
        }
        $rules['image_data'] = ['sometimes', 'nullable', 'string'];
        $rules['sort_order'] = ['sometimes', 'integer', 'min:0'];

        return $rules;
    }

    /** Match HTML maxlength and JavaScript counters, including emoji. */
    private static function browserLength(int $limit): \Closure
    {
        return static function (string $attribute, mixed $value, \Closure $fail) use ($limit): void {
            if (is_string($value) && strlen(mb_convert_encoding($value, 'UTF-16LE', 'UTF-8')) / 2 > $limit) {
                $fail("The {$attribute} must not exceed {$limit} characters.");
            }
        };
    }

    public static function messages(): array
    {
        return [
            'max.string' => 'The :attribute must not exceed :max characters.',
            'max.array' => 'The :attribute must not contain more than :max items.',
        ];
    }
}
