<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\PwaNotifications;
use App\Services\PwaPushTransport;
use App\Support\Pwa;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ProcessPwaPush extends Command
{
    protected $signature = 'pwa:process {--limit=100 : Maximum deliveries per run}';

    protected $description = 'Publish newly live campaigns and process the FMRC push outbox';

    public function handle(PwaNotifications $notifications, PwaPushTransport $transport): int
    {
        if (! Pwa::installed()) {
            $this->warn('PWA migrations have not been installed.');

            return self::FAILURE;
        }
        $lock = Cache::lock('pwa-push-processor', 120);
        if (! $lock->get()) {
            return self::SUCCESS;
        }
        try {
            DB::table('pwa_runtime')->updateOrInsert(['key' => 'processor'], ['value' => now()]);
            $notifications->publishLiveCampaigns();
            if (! Pwa::configured()) {
                $this->info('Inbox publication complete; phone delivery is disabled.');

                return self::SUCCESS;
            }
            $rows = DB::table('pwa_delivery_outbox')->whereNull('delivered_at')->whereNull('discarded_at')
                ->where('available_at', '<=', now())->where(function ($q) {
                    $q->whereNull('claimed_at')->orWhere('claimed_at', '<', now()->subMinutes(5));
                })
                ->orderBy('id')->limit(max(1, min(500, (int) $this->option('limit'))))->get();
            $started = microtime(true);
            foreach ($rows as $row) {
                if (microtime(true) - $started > 45) {
                    break;
                }
                // A lease also protects against a second host using a different cache store.
                $claimed = DB::table('pwa_delivery_outbox')->where('id', $row->id)->whereNull('delivered_at')->whereNull('discarded_at')
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
                    $result = $transport->send($device, json_decode($row->payload, true));
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
            DB::table('pwa_delivery_outbox')->where('created_at', '<', now()->subDays(30))->delete();

            return self::SUCCESS;
        } catch (\Throwable $error) {
            // A failed processor must not advertise healthy background delivery.
            DB::table('pwa_runtime')->where('key', 'processor')->delete();
            report($error);
            $this->error('FMRC notification processing could not finish. Check the application log.');

            return self::FAILURE;
        } finally {
            $lock->release();
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
