<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Models\ShipmentTracker;
use App\Services\SeventeenTrackClient;
use App\Services\SeventeenTrackException;
use App\Services\SeventeenTrackTracking;
use App\Services\ShipmentTracking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

final class VerifySeventeenTrack extends Command
{
    protected $signature = '17track:verify {--carrier= : J&T Philippines carrier code}
        {--order= : FMRC order number or database ID with a recorded actual J&T handover}
        {--real-handover : Confirm the physical FMRC handover; registration uses the lifetime credit budget}
        {--tracking-number= : Owned parcel for isolated provider diagnostics, never attached to an order}
        {--postcode= : Actual destination postcode for the diagnostic parcel}
        {--ship-date= : Optional actual diagnostic shipment date (YYYY-MM-DD)}
        {--register-diagnostic : Authorize diagnostic registration using the lifetime credit budget}';

    protected $description = 'Verify 17TRACK carrier/API/webhook setup without exposing credentials or fabricating FMRC orders';

    public function handle(SeventeenTrackTracking $tracking, SeventeenTrackClient $client): int
    {
        if (! ShipmentTracking::subscriptionsInstalled() || ! $client::configured()) {
            $this->error('Deploy the 17TRACK migration and configure TRACK17_API_KEY first. Tracking remains inactive.');

            return self::FAILURE;
        }
        if ($this->option('order') && $this->option('tracking-number')) {
            $this->error('Choose either an FMRC order or an isolated diagnostic parcel.');

            return self::FAILURE;
        }
        $lock = Cache::lock('shipments:process', 120);
        if (! $lock->get()) {
            $this->warn('Shipment processing is running. Try again shortly.');

            return self::FAILURE;
        }
        try {
            $carrier = $tracking->verifyCarrier((int) ($this->option('carrier') ?: config('track17.carrier_code')));
            $this->info('Carrier verified: '.$carrier['_name'].' ('.$carrier['key'].')');
            if ($this->option('tracking-number')) {
                if (! $this->option('register-diagnostic') || ! $this->option('postcode')) {
                    $this->error('Use --postcode and --register-diagnostic only for a parcel you own. This can consume one tracking credit.');

                    return self::FAILURE;
                }
                $sub = $tracking->diagnostic($this->option('tracking-number'), $this->option('postcode'), $this->option('ship-date'));
                $this->info($sub->last_event_at ? 'Diagnostic API events received. No FMRC order or customer notification was created.' : 'Registration saved; no diagnostic events yet. Retry this same command later.');
                $this->line($sub->last_webhook_at ? 'Signed diagnostic webhook received.' : 'Waiting for a signed diagnostic webhook. Run shipments:process after it arrives.');

                return $sub->last_event_at ? self::SUCCESS : self::FAILURE;
            }
            if ($this->option('order')) {
                if (! $this->option('real-handover')) {
                    $this->error('Check the actual FMRC waybill and supply --real-handover. This can consume one tracking credit.');

                    return self::FAILURE;
                }
                $reference = ltrim(trim((string) $this->option('order')), '#');
                $order = Order::where('order_no', $reference)->first()
                    ?? (ctype_digit($reference) ? Order::find($reference) : null);
                if (! $order) {
                    $this->error('Order not found. Use the FMRC order number shown in Orders.');

                    return self::FAILURE;
                }
                $tracker = ShipmentTracker::where('active_order_id', $order->id)->firstOrFail();
                if (! $tracking->verifyWaybill($tracker)) {
                    $this->warn('No matching FMRC parcel events yet. Retry with the same order after a J&T scan.');

                    return self::FAILURE;
                }
                $this->info('FMRC waybill verified. A matching signed webhook, TRACK17_ENABLED=true, and Admin activation are still required.');
            }
            $health = ShipmentTracking::health();
            $this->line('Lifetime FMRC registration reservations: '.($health['budget_used'] ?? 0).' / '.config('track17.registration_limit'));

            return self::SUCCESS;
        } catch (ValidationException $error) {
            $this->error(collect($error->errors())->flatten()->first());
        } catch (SeventeenTrackException $error) {
            $this->error('17TRACK verification incomplete: '.$error->reason.'. Saved shipment data is preserved.');
        } catch (\Throwable) {
            $this->error('Verification could not finish. Check the configured account, recorded order, and application logs.');
        } finally {
            $lock->release();
        }

        return self::FAILURE;
    }
}
