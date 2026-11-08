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
            $this->components->warn('Shipment processing skipped: database setup is not installed.');
            return self::SUCCESS;
        }
        $lock = Cache::lock('shipments:process', 120);
        if (! $lock->get()) {
            $this->components->warn('Shipment processing skipped: another worker holds the lock (expires within 120 seconds).');
            return self::SUCCESS;
        }
        try {
            if (ShipmentTracking::subscriptionsInstalled()) {
                $track17->process(microtime(true) + 15);
            }
            $events->notifications(microtime(true) + 10);
            if ($this->output->isVerbose()) {
                $health = ShipmentTracking::health();
                $this->info('Shipment worker completed at '.now()->toIso8601String().'.');
                $this->line('Automatic mode: '.(($health['enabled'] ?? false) ? 'on' : 'off').'; waiting for registration: '.($health['pending'] ?? 0).'; updates awaiting processing: '.($health['pending_updates'] ?? 0).'.');
            }
        } finally {
            $lock->release();
        }

        return self::SUCCESS;
    }
}
