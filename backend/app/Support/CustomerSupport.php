<?php

namespace App\Support;

use App\Models\SiteSetting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CustomerSupport
{
    public const SETTING = 'support_assistant_config';

    public const ACTIONS = ['products', 'appointments', 'orders', 'contact', 'terms', 'refunds', 'signin', 'account'];

    public static function installed(): bool
    {
        return Schema::hasTable('customer_message_entries') && Schema::hasTable('support_knowledge_entries')
            && Schema::hasTable('support_operator_presence') && Schema::hasColumn('customer_messages', 'customer_last_read_entry_id');
    }

    public static function defaults(): array
    {
        return json_decode(file_get_contents(resource_path('support-assistant.json')), true, flags: JSON_THROW_ON_ERROR);
    }

    public static function pack(bool $editor = false): array
    {
        $defaults = self::defaults();
        $stored = json_decode((string) SiteSetting::get(self::SETTING, ''), true);
        $config = is_array($stored) ? array_replace($defaults['config'], $stored) : $defaults['config'];
        $ready = self::installed();
        $faqs = $ready ? DB::table('support_knowledge_entries')->when(! $editor, fn ($q) => $q->where('is_enabled', true))
            ->orderBy('sort_order')->orderBy('id')->get()->map(function ($row) {
                return [...json_decode($row->payload, true), 'key' => $row->key, 'enabled' => (bool) $row->is_enabled];
            })->all() : $defaults['faqs'];

        return ['config' => $config, 'faqs' => $faqs, 'installed' => $ready,
            'revision' => $config['revision'] ?? 'initial', 'actions' => self::ACTIONS];
    }

    public static function available(): bool
    {
        if (! self::installed()) return false;
        // A disconnected, expired or deleted account cannot advertise availability.
        return DB::table('support_operator_presence as p')->join('personal_access_tokens as t', 't.id', '=', 'p.token_id')
            ->join('users as u', 'u.id', '=', 'p.user_id')->whereIn('u.role', ['admin', 'staff'])
            ->whereNull('u.deleted_at')->where('p.expires_at', '>', now())
            ->get(['t.*'])->contains(function ($row) {
                $token = (new \Laravel\Sanctum\PersonalAccessToken)->newFromBuilder((array) $row);
                return AdminSession::expirationCode($token) === null;
            });
    }

    public static function save(array $input): array
    {
        abort_unless(self::installed(), 503, 'Support setup is required before these settings can be saved.');
        $data = Validator::make($input, [
            'revision' => 'required|string|max:80', 'config' => 'required|array',
            'config.enabled' => 'required|boolean', 'config.name' => 'required|string|max:60',
            'config.icon' => ['required', Rule::in(['brand', 'chat', 'headset', 'help'])],
            'config.placement' => ['required', Rule::in(['left', 'right'])],
            'config.accent' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'config.header_color' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'config.surface' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'config.avatar' => 'present|nullable|string|max:200000',
            'config.welcome' => 'required|array', 'config.offline' => 'required|array', 'config.fallback' => 'required|array',
            'config.welcome.en' => 'required|string|max:300', 'config.welcome.fil' => 'required|string|max:300',
            'config.offline.en' => 'required|string|max:300', 'config.offline.fil' => 'required|string|max:300',
            'config.fallback.en' => 'required|string|max:300', 'config.fallback.fil' => 'required|string|max:300',
            'config.suggestions' => 'present|array|max:6', 'config.suggestions.*' => 'required|string|max:80|distinct',
            'faqs' => 'present|array|max:100', 'faqs.*.key' => ['required', 'distinct', 'regex:/^[a-z0-9][a-z0-9_-]{0,79}$/'],
            'faqs.*.enabled' => 'required|boolean',
            'faqs.*.aliases' => 'present|array|max:30', 'faqs.*.aliases.*' => 'required|string|max:120',
            'faqs.*.actions' => 'present|array|max:3', 'faqs.*.actions.*' => ['required', Rule::in(self::ACTIONS)],
            'faqs.*.en' => 'required|array', 'faqs.*.fil' => 'required|array',
            'faqs.*.en.question' => 'required|string|max:150', 'faqs.*.fil.question' => 'required|string|max:150',
            'faqs.*.en.answer' => 'required|string|max:2500', 'faqs.*.fil.answer' => 'required|string|max:2500',
            'faqs.*.en.steps' => 'present|array|max:12', 'faqs.*.fil.steps' => 'present|array|max:12',
            'faqs.*.en.steps.*' => 'required|string|max:500', 'faqs.*.fil.steps.*' => 'required|string|max:500',
        ])->validate();
        // Rebuild only approved keys; unknown fields cannot enter the public pack.
        $config = array_intersect_key($data['config'], self::defaults()['config']);
        unset($config['revision']);
        foreach (['accent', 'header_color'] as $field) {
            if (self::contrast($config[$field], '#ffffff') < 4.5) throw ValidationException::withMessages(["config.$field" => 'Choose a darker color so white text remains readable.']);
        }
        if (self::contrast($config['surface'], '#243247') < 4.5 || self::contrast($config['surface'], $config['accent']) < 4.5) {
            throw ValidationException::withMessages(['config.surface' => 'Choose a lighter surface with readable text and buttons.']);
        }
        if ($config['avatar']) {
            if (! preg_match('~^data:image/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$~', $config['avatar'], $parts)
                || ! ($bytes = base64_decode($parts[2], true)) || strlen($bytes) > 131072
                || ! ($image = @getimagesizefromstring($bytes)) || $image[0] > 512 || $image[1] > 512
                || $image['mime'] !== 'image/'.$parts[1]) {
                throw ValidationException::withMessages(['config.avatar' => 'Use a PNG, JPEG or WebP image up to 512 × 512 pixels and 128 KB.']);
            }
        }
        $faqs = array_map(function ($faq) {
            return ['key' => $faq['key'], 'enabled' => $faq['enabled'], 'aliases' => array_values($faq['aliases']),
                'actions' => array_values($faq['actions']),
                'en' => array_intersect_key($faq['en'], array_flip(['question', 'answer', 'steps'])),
                'fil' => array_intersect_key($faq['fil'], array_flip(['question', 'answer', 'steps']))];
        }, $data['faqs']);
        $config['suggestions'] = array_values(array_intersect($config['suggestions'], array_column(array_filter($faqs, fn ($f) => $f['enabled']), 'key')));
        DB::transaction(function () use ($data, $config, $faqs) {
            SiteSetting::firstOrCreate(['key' => self::SETTING], ['value' => json_encode(self::defaults()['config'])]);
            $row = SiteSetting::where('key', self::SETTING)->lockForUpdate()->firstOrFail();
            $previous = json_decode($row->value, true);
            abort_unless(($previous['revision'] ?? 'initial') === $data['revision'], 409, 'Support settings changed in another tab. Refresh before saving. Your draft has been kept.');
            $row->update(['value' => json_encode([...$config, 'revision' => (string) Str::uuid()], JSON_UNESCAPED_UNICODE)]);
            DB::table('support_knowledge_entries')->whereNotIn('key', array_column($faqs, 'key'))->delete();
            foreach ($faqs as $order => $faq) {
                DB::table('support_knowledge_entries')->updateOrInsert(['key' => $faq['key']], [
                    'payload' => json_encode($faq, JSON_UNESCAPED_UNICODE), 'is_enabled' => $faq['enabled'],
                    'sort_order' => $order, 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        });
        return self::pack(true);
    }

    private static function contrast(string $a, string $b): float
    {
        $luminance = function ($hex) {
            $rgb = array_map(function ($v) { $v = hexdec($v)/255; return $v <= .04045 ? $v/12.92 : (($v+.055)/1.055)**2.4; }, str_split(substr($hex, 1), 2));
            return .2126*$rgb[0]+.7152*$rgb[1]+.0722*$rgb[2];
        };
        $x = $luminance($a); $y = $luminance($b);
        return (max($x, $y)+.05)/(min($x, $y)+.05);
    }
}
