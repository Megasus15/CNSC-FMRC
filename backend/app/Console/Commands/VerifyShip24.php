<?php

namespace App\Console\Commands;

use App\Models\ShipmentTracker;
use App\Services\Ship24Client;
use App\Services\Ship24Exception;
use App\Services\Ship24Tracking;
use App\Services\ShipmentTracking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

final class VerifyShip24 extends Command
{
    protected $signature = 'ship24:verify {--carrier= : Exact J&T Philippines carrier code from the provider list} {--order= : FMRC order with a recorded real J&T handover} {--real-handover : Confirm this is a real waybill; registration consumes the account allowance}';

    protected $description = 'List J&T carrier candidates or verify a real prepaid shipment before Admin activation';

    public function handle(Ship24Client $client, Ship24Tracking $tracking): int
    {
        if (! ShipmentTracking::installed() || ! Ship24Client::configured()) {
            $this->error(! ShipmentTracking::installed() ? 'Install the shipment migration first.' : 'Configure SHIP24_API_KEY and SHIP24_WEBHOOK_SECRET before verification. Automatic tracking remains inactive.');

            return self::FAILURE;
        }
        $lock = Cache::lock('shipments:process', 120);
        if (! $lock->get()) {
            $this->warn('Shipment processing is running. Try again shortly.');

            return self::FAILURE;
        }
        try {
            if (! $this->option('carrier')) {
                $rows = collect($client->couriers())->filter(fn ($c) => preg_match('/J\s*&\s*T|\bJT\b/i', $c['courierName'] ?? ''))
                    ->map(fn ($c) => [$c['courierCode'], $c['courierName'], $c['countryCode'] ?? '', implode(', ', $c['requiredFields'] ?? []), ($c['isDeprecated'] ?? false) ? 'Deprecated' : 'Active']);
                $this->table(['Code', 'Name', 'Country', 'Required fields', 'Availability'], $rows->all());

                return self::SUCCESS;
            }
            $carrier = $tracking->verifyCarrier((string) $this->option('carrier'));
            $this->info('Carrier verified: '.$carrier['courierName']);
            if ($this->option('order')) {
                if (! $this->option('real-handover')) {
                    $this->error('Use --real-handover only after checking the actual J&T receipt. This uses the Ship24 allowance.');

                    return self::FAILURE;
                }
                $tracker = ShipmentTracker::where('active_order_id', $this->option('order'))->firstOrFail();
                if (! $tracking->verifyWaybill($tracker)) {
                    $this->warn('No matching courier events yet. Automatic tracking remains disabled; retry after J&T publishes a scan.');

                    return self::FAILURE;
                }
                $this->info('Real waybill returned matching J&T Philippines events. Complete the webhook check, then activate in Shipping & Delivery.');
            }

            return self::SUCCESS;
        } catch (ValidationException $error) {
            $this->error(collect($error->errors())->flatten()->first());

            return self::FAILURE;
        } catch (Ship24Exception $error) {
            $this->error('Verification is incomplete: '.$error->reason.'. The saved shipment remains available; automatic activation was not performed.');

            return self::FAILURE;
        } catch (\Throwable) {
            $this->error('Verification could not finish. Check the account configuration and recorded order; automatic activation was not performed.');

            return self::FAILURE;
        } finally {
            $lock->release();
        }
    }
}
