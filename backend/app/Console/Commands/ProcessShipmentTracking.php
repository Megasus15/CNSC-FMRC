<?php

namespace App\Console\Commands;

use App\Services\SeventeenTrackTracking;
use App\Services\ShipmentTracking;
use App\Services\ShipmentTrackingEvents;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

final class ProcessShipmentTracking extends Command
{
    protected $signature = 'shipments:process';

    protected $description = 'Process saved courier updates, retry tracking registration, and publish delivery notifications';

    public function handle(ShipmentTrackingEvents $events, SeventeenTrackTracking $track17): int
    {
        if (! ShipmentTracking::installed()) {
            return self::SUCCESS;
        }
        $lock = Cache::lock('shipments:process', 120);
        if (! $lock->get()) {
            return self::SUCCESS;
        }
        try {
            if (ShipmentTracking::subscriptionsInstalled()) {
                $track17->process(microtime(true) + 15);
            }
            $events->notifications(microtime(true) + 10);
        } finally {
            $lock->release();
        }

        return self::SUCCESS;
    }
}
