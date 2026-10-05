<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Minishlink\WebPush\VAPID;

class GeneratePwaKeys extends Command
{
    protected $signature = 'pwa:keys';

    protected $description = 'Write persistent VAPID keys to protected storage without exposing the private key';

    public function handle(): int
    {
        $path = storage_path('app/private/pwa-vapid.json');
        if (File::exists($path)) {
            $this->info('Existing keys preserved: storage/app/private/pwa-vapid.json');

            return self::SUCCESS;
        }
        File::ensureDirectoryExists(dirname($path));
        File::put($path, json_encode(VAPID::createVapidKeys(), JSON_PRETTY_PRINT));
        @chmod($path, 0600);
        $this->info('Keys saved to protected storage/app/private/pwa-vapid.json. Set the corresponding PWA_VAPID_* environment values once.');

        return self::SUCCESS;
    }
}
