<?php

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Minishlink\WebPush\WebPush;

class Pwa
{
    public static function installed(): bool
    {
        // Safe during a staged release, before its migration has run.
        foreach (['pwa_runtime', 'pwa_subscriptions', 'customer_notifications', 'customer_notification_reads', 'pwa_delivery_outbox'] as $table) {
            if (! Schema::hasTable($table)) {
                return false;
            }
        }

        return true;
    }

    public static function configured(): bool
    {
        $public = base64_decode(strtr((string) config('pwa.vapid.public_key'), '-_', '+/'), true);
        $private = base64_decode(strtr((string) config('pwa.vapid.private_key'), '-_', '+/'), true);

        return (bool) config('pwa.push_enabled') && class_exists(WebPush::class)
            && $public && strlen($public) === 65 && $public[0] === "\x04" && $private && strlen($private) === 32
            && preg_match('~^(https://|mailto:)~', (string) config('pwa.vapid.subject'));
    }

    public static function ready(): bool
    {
        if (! self::installed() || ! self::configured()) {
            return false;
        }
        $heartbeat = DB::table('pwa_runtime')->where('key', 'processor')->value('value');

        return $heartbeat && Carbon::parse($heartbeat)->greaterThan(now()->subMinutes(3));
    }

    public static function validEndpoint(string $endpoint): bool
    {
        $url = parse_url($endpoint);
        if (! $url || ($url['scheme'] ?? '') !== 'https' || isset($url['user']) || isset($url['pass'])
            || isset($url['fragment']) || (isset($url['port']) && $url['port'] !== 443)) {
            return false;
        }
        $host = strtolower($url['host'] ?? '');
        foreach (config('pwa.push_hosts', []) as $allowed) {
            if ($host === $allowed || (str_starts_with($allowed, '.') && str_ends_with($host, $allowed))) {
                return true;
            }
        }

        return false;
    }

    public static function revokeUser(int $id): void
    {
        if (self::installed()) {
            DB::table('pwa_subscriptions')->where('user_id', $id)->delete();
        }
    }
}
