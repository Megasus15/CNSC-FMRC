<?php

namespace App\Console\Commands;

use App\Services\Ship24Tracking;
use App\Services\ShipmentTracking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

final class ProcessShipmentTracking extends Command
{
    protected $signature = 'shipments:process';

    protected $description = 'Process saved courier updates, retry tracking registration, and publish delivery notifications';

    public function handle(Ship24Tracking $tracking): int
    {
        if (! ShipmentTracking::installed()) {
            return self::SUCCESS;
        }
        $lock = Cache::lock('shipments:process', 120);
        if (! $lock->get()) {
            return self::SUCCESS;
        }
        try {
            $tracking->process(microtime(true) + 15);
        } finally {
            $lock->release();
        }

        return self::SUCCESS;
    }
}
