<?php

namespace App\Console\Commands;

use App\Services\PwaNotifications;
use App\Services\PwaOutboxProcessor;
use App\Support\Pwa;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ProcessPwaPush extends Command
{
    protected $signature = 'pwa:process {--limit=100 : Maximum deliveries per run}';

    protected $description = 'Publish newly live campaigns and process the FMRC push outbox';

    public function handle(PwaNotifications $notifications, PwaOutboxProcessor $outbox): int
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
            $outbox->process((int) $this->option('limit'));
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
}
