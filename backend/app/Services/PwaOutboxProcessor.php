<?php

namespace App\Services;

use App\Models\User;
use App\Support\Pwa;
use Illuminate\Support\Facades\DB;

class PwaOutboxProcessor
{
    public const REQUEST_EVENTS = 'fmrc.pwa.committed_events';

    public function __construct(private PwaPushTransport $transport) {}

    public function process(int $limit = 100, float $seconds = 45, ?array $eventKeys = null): void
    {
        if (! Pwa::ready() || $eventKeys === []) {
            return;
        }
        $query = DB::table('pwa_delivery_outbox')->whereNull('delivered_at')->whereNull('discarded_at')
            ->where('available_at', '<=', now())->where(function ($q) {
                $q->whereNull('claimed_at')->orWhere('claimed_at', '<', now()->subMinutes(5));
            });
        if ($eventKeys !== null) {
            $query->whereIn('event_key', $eventKeys);
        }
        $rows = $query->orderBy('id')->limit(max(1, min(500, $limit)))->get();
        $started = microtime(true);
        foreach ($rows as $row) {
            if (microtime(true) - $started >= $seconds) {
                break;
            }
            // The same atomic lease protects HTTP sends and the cron from duplicates.
            $claimed = DB::table('pwa_delivery_outbox')->where('id', $row->id)->whereNull('delivered_at')->whereNull('discarded_at')
                ->where('available_at', '<=', now())
                ->where(fn ($q) => $q->whereNull('claimed_at')->orWhere('claimed_at', '<', now()->subMinutes(5)))
                ->update(['claimed_at' => now()]);
            if (! $claimed) {
                continue;
            }
            $device = DB::table('pwa_subscriptions')->find($row->subscription_id);
            if (! $device || ! $this->eligible($device, $row) || $row->created_at < now()->subDay()->toDateTimeString()) {
                DB::table('pwa_delivery_outbox')->where('id', $row->id)->update(['discarded_at' => now(), 'last_error' => 'binding_changed_or_stale']);
                continue;
            }
            try {
                $result = $this->transport->send($device, json_decode($row->payload, true));
            } catch (\Throwable $error) {
                report($error);
                $result = ['success' => false, 'expired' => false, 'status' => 0];
            }
            if ($result['expired'] || in_array($result['status'], [404, 410], true)) {
                DB::table('pwa_subscriptions')->where('id', $device->id)->delete();
                continue;
            }
            $attempts = $row->attempts + 1;
            DB::table('pwa_delivery_outbox')->where('id', $row->id)->update([
                'attempts' => $attempts, 'claimed_at' => null,
                'delivered_at' => $result['success'] ? now() : null,
                'discarded_at' => ! $result['success'] && ($attempts >= 6 || in_array($result['status'], [400, 401, 403], true)) ? now() : null,
                'available_at' => now()->addSeconds(min(3600, 60 * 2 ** $attempts)),
                'last_error' => $result['success'] ? null : 'push_http_'.(int) $result['status'], 'updated_at' => now(),
            ]);
        }
    }

    private function eligible(object $device, object $row): bool
    {
        if ($row->audience === 'public') {
            return $device->app === 'customer' && $device->public_alerts;
        }
        $user = User::find($device->user_id);
        if (! $user || $user->isSpectator() || ! $device->account_alerts || (int) $row->audience_user_id !== (int) $user->id) {
            return false;
        }
        return $row->audience === 'account' ? $device->app === 'customer' && $user->role === 'customer'
            : $device->app === 'team' && $device->role === $user->role && in_array($user->role, $row->audience === 'admin' ? ['admin'] : ['admin', 'staff']);
    }
}
