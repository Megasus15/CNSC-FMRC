<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Pwa;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PwaController extends Controller
{
    public function config()
    {
        return response()->json(['push_available' => Pwa::ready(), 'inbox_available' => Pwa::installed(),
            'public_key' => Pwa::ready() ? config('pwa.vapid.public_key') : null])->header('Cache-Control', 'no-store');
    }

    public function register(Request $request)
    {
        $this->requireSchema();
        abort_unless(Pwa::ready(), 503, 'Phone notifications are not available yet.');
        $data = $request->validate([
            'app' => 'required|in:customer,team', 'user_id' => 'prohibited', 'role' => 'prohibited',
            'subscription.endpoint' => 'required|string|max:2048', 'subscription.keys.p256dh' => 'required|string|max:128',
            'subscription.keys.auth' => 'required|string|max:64', 'public_alerts' => 'required|boolean', 'account_alerts' => 'required|boolean',
        ]);
        $sub = $data['subscription'];
        $decode = fn ($key) => base64_decode(strtr($key, '-_', '+/'), true);
        $publicKey = $decode($sub['keys']['p256dh']);
        $authKey = $decode($sub['keys']['auth']);
        if (! Pwa::validEndpoint($sub['endpoint']) || ! $publicKey || strlen($publicKey) !== 65 || $publicKey[0] !== "\x04" || ! $authKey || strlen($authKey) !== 16) {
            throw ValidationException::withMessages(['subscription' => 'This notification subscription is not supported.']);
        }
        $user = $request->user('sanctum');
        $this->checkUser($user, $data['app'], $data['account_alerts']);
        abort_if($data['app'] === 'team' && $data['public_alerts'], 422, 'Public alerts belong to the Customer app.');

        return DB::transaction(function () use ($data, $sub, $user, $request) {
            $hash = hash('sha256', $sub['endpoint']);
            $existing = DB::table('pwa_subscriptions')->where('endpoint_hash', $hash)->lockForUpdate()->first();
            if ($existing) {
                abort_unless($existing->app === $data['app'] && $this->owns($request, $existing), 409, 'Reset notifications on this device before enabling them again.');
            }
            $credential = $existing ? null : bin2hex(random_bytes(32));
            $values = ['app' => $data['app'], 'user_id' => $user?->id, 'role' => $user?->role,
                'endpoint_hash' => $hash, 'endpoint' => $sub['endpoint'], 'p256dh' => $sub['keys']['p256dh'], 'auth' => $sub['keys']['auth'],
                'public_alerts' => $data['app'] === 'customer' && $data['public_alerts'], 'account_alerts' => $data['account_alerts'] && $user,
                'last_seen_at' => now(), 'updated_at' => now()];
            if ($existing) {
                DB::table('pwa_subscriptions')->where('id', $existing->id)->update($values);
                $id = $existing->id;
            } else {
                $id = DB::table('pwa_subscriptions')->insertGetId($values + ['credential_hash' => hash('sha256', $credential), 'created_at' => now()]);
            }

            return response()->json(['id' => $id, 'credential' => $credential, 'user_id' => $user?->id,
                'public_alerts' => $values['public_alerts'], 'account_alerts' => $values['account_alerts']])->header('Cache-Control', 'no-store');
        });
    }

    public function preferences(Request $request, int $id)
    {
        $device = $this->device($request, $id);
        $data = $request->validate(['public_alerts' => 'sometimes|boolean', 'account_alerts' => 'sometimes|boolean',
            'detach' => 'sometimes|boolean', 'bind' => 'sometimes|boolean', 'user_id' => 'prohibited', 'app' => 'prohibited', 'role' => 'prohibited']);
        if ($data['detach'] ?? false) {
            if ($device->app === 'team') {
                DB::table('pwa_subscriptions')->where('id', $id)->delete();

                return response()->json(['removed' => true]);
            }
            $values = ['user_id' => null, 'role' => null, 'account_alerts' => false];
        } else {
            $values = array_intersect_key($data, array_flip(['public_alerts', 'account_alerts']));
            abort_if($device->app === 'team' && ($values['public_alerts'] ?? false), 422);
            if ($data['bind'] ?? false) {
                $user = $request->user('sanctum');
                $this->checkUser($user, $device->app, true);
                $values += ['user_id' => $user->id, 'role' => $user->role];
            } else {
                // Device credentials can manage an existing grant beyond website session expiry.
                // They cannot grant access to an unbound or revoked account.
                abort_if(($values['account_alerts'] ?? false) && ! $device->user_id, 401, 'Sign in to enable account alerts.');
            }
        }
        DB::table('pwa_subscriptions')->where('id', $id)->update($values + ['last_seen_at' => now(), 'updated_at' => now()]);
        $saved = DB::table('pwa_subscriptions')->find($id);

        return response()->json(['id' => $id, 'user_id' => $saved->user_id, 'public_alerts' => (bool) $saved->public_alerts,
            'account_alerts' => (bool) $saved->account_alerts])->header('Cache-Control', 'no-store');
    }

    public function remove(Request $request, int $id)
    {
        $this->device($request, $id);
        DB::table('pwa_subscriptions')->where('id', $id)->delete();

        return response()->json(['removed' => true]);
    }

    private function device(Request $request, int $id): object
    {
        $this->requireSchema();
        $device = DB::table('pwa_subscriptions')->find($id);
        abort_unless($device && $this->owns($request, $device), 404, 'This device is no longer registered.');

        return $device;
    }

    private function owns(Request $request, object $device): bool
    {
        $secret = (string) $request->header('X-FMRC-Device', '');

        return strlen($secret) === 64 && hash_equals($device->credential_hash, hash('sha256', $secret));
    }

    private function checkUser(?User $user, string $app, bool $private): void
    {
        abort_if($user?->isSpectator(), 403, 'Presentation accounts cannot enable phone notifications.');
        if ($app === 'team') {
            abort_unless($user && in_array($user->role, ['admin', 'staff']), 403, 'Sign in to the Admin/Staff app first.');
        } else {
            abort_if($user && $user->role !== 'customer', 403);
            abort_if($private && ! $user, 401, 'Sign in to enable account alerts.');
        }
    }

    private function requireSchema(): void
    {
        abort_unless(Pwa::installed(), 503, 'Notifications are not available yet.');
    }
}
