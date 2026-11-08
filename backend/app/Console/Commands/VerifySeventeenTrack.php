<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Models\ShipmentTracker;
use App\Models\ShipmentTrackingSubscription;
use App\Services\SeventeenTrackClient;
use App\Services\SeventeenTrackException;
use App\Services\SeventeenTrackTracking;
use App\Services\ShipmentTracking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

final class VerifySeventeenTrack extends Command
{
    protected $signature = '17track:verify {--status : Show saved readiness/order status without contacting 17TRACK or registering a parcel}
        {--sync : Import saved provider results for the assigned order; never request a paid instant lookup}
        {--quota : Read provider credit balance and daily tracking allowance without registering a number}
        {--carrier= : J&T Philippines carrier code}
        {--order= : FMRC order number or database ID with a recorded actual J&T handover}
        {--real-handover : Confirm the physical FMRC handover; registration uses the lifetime credit budget}
        {--tracking-number= : Owned parcel for isolated provider diagnostics, never attached to an order}
        {--postcode= : Actual destination postcode for the diagnostic parcel}
        {--ship-date= : Optional actual diagnostic shipment date (YYYY-MM-DD)}
        {--register-diagnostic : Authorize diagnostic registration using the lifetime credit budget}';

    protected $description = 'Verify 17TRACK carrier/API/webhook setup without exposing credentials or fabricating FMRC orders';

    public function handle(SeventeenTrackTracking $tracking, SeventeenTrackClient $client): int
    {
        if (($this->option('status') && ($this->option('sync') || $this->option('quota')))
            || ($this->option('sync') && (! $this->option('order') || $this->option('quota') || $this->option('tracking-number')))) {
            $this->error('Use --status for a local read, --quota for the provider allowance, or --sync --order=ORDER for an assigned order.');
            return self::FAILURE;
        }
        if ($this->option('status')) {
            return $this->status();
        }
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
            if ($this->option('quota')) {
                $quota = $client->request('getquota', []);
                $this->table(['17TRACK account allowance', 'Provider result'], [
                    ['Remaining tracking credits', $quota['quota_remain'] ?? 'Not reported'],
                    ['Tracking registrations today', $quota['today_used'] ?? 'Not reported'],
                    ['Daily tracking limit', ($quota['max_track_daily'] ?? null) === 0 ? 'Unlimited (provider setting)' : ($quota['max_track_daily'] ?? 'Not reported')],
                ]);
                return self::SUCCESS;
            }
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
                if (! $this->option('real-handover') && ! $this->option('sync')) {
                    $this->error('Use --sync --order=ORDER to import saved results for its assigned tracking number. Registration can reserve one tracking credit.');

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
                    if ($this->option('sync')) {
                        $this->status(false);
                    }
                    $this->warn('No matching FMRC parcel events yet. Retry with the same order after a J&T scan.');

                    return self::FAILURE;
                }
                $this->info('Assigned parcel verified. Automatic registration does not require first-parcel or webhook approval. Keep TRACK17_ENABLED=true and the shipment worker running.');
                if ($this->option('sync')) {
                    return $this->status(false);
                }
            }
            $health = ShipmentTracking::health();
            $this->line('Lifetime FMRC registration reservations: '.($health['budget_used'] ?? 0).' / '.config('track17.registration_limit'));

            return self::SUCCESS;
        } catch (ValidationException $error) {
            $this->error(collect($error->errors())->flatten()->first());
        } catch (SeventeenTrackException $error) {
            $this->error('17TRACK verification incomplete: '.$error->reason.'. Saved shipment data is preserved.');
            $this->line('HTTP status: '.($error->httpStatus ?? 'No response').'; API code: '.($error->providerCode ?? 'Not reported').'; retry after: '.$error->retryAfter.' seconds.');
            if ($error->reason === 'daily_limit_reached') {
                $this->warn('This is the provider daily tracking allowance, not HTTP request frequency. Run 17track:verify --quota and check 17TRACK Settings.');
            }
        } catch (\Throwable) {
            $this->error('Verification could not finish. Check the configured account, recorded order, and application logs.');
        } finally {
            $lock->release();
        }

        return self::FAILURE;
    }

    private function status(bool $readOnly = true): int
    {
        $health = ShipmentTracking::health();
        if (! ($health['installed'] ?? false)) {
            $this->error('Tracking setup is not installed. Deploy the shipment migrations first.');
            return self::FAILURE;
        }
        $this->line('Automatic tracking: '.($health['enabled'] ? 'active' : 'inactive'));
        $this->line('Shipment worker: '.($health['processor_healthy'] ? 'running' : 'needs attention'));
        $this->line('Last completed worker run: '.($health['last_processed_at'] ?? 'Not recorded'));
        $this->line('Saved-result recovery interval: '.$health['saved_results_interval_minutes'].' minutes');
        foreach ($health['blocking_reasons'] as $reason) {
            $this->warn($reason);
        }
        if ($this->option('order')) {
            $reference = ltrim(trim((string) $this->option('order')), '#');
            $order = Order::where('order_no', $reference)->first()
                ?? (ctype_digit($reference) ? Order::find($reference) : null);
            if (! $order) {
                $this->error('Order not found. Use the FMRC order number shown in Orders.');
                return self::FAILURE;
            }
            $tracker = ShipmentTracker::where('active_order_id', $order->id)->first();
            $sub = $order->tracking_test_subscription_id ? ShipmentTrackingSubscription::find($order->tracking_test_subscription_id)
                : ($tracker ? ShipmentTracking::subscription($tracker) : null);
            $eligibility = $order->customer_stage === 'completed' ? 'Order already completed'
                : ($tracker && ShipmentTracking::duplicateAssignment($tracker) ? 'Duplicate tracking number assignment' : (ShipmentTracking::eligibility($order, (bool) $tracker) ?? 'Eligible'));
            $this->table(['Order sync check', 'Saved result'], [
                ['Order', $order->order_no], ['FMRC stage', $order->customer_stage],
                ['Tracking mode', $order->tracking_test_subscription_id ? 'External parcel test; cannot complete this FMRC order' : ($tracker ? 'Recorded physical FMRC handover' : 'No recorded physical handover')],
                ['Tracking number', $sub?->tracking_number ?? $tracker?->tracking_number ?? 'Not recorded'],
                ['Registration', $sub?->registration_state ?? 'Not registered with FMRC'],
                ['Order tracking eligibility', $eligibility],
                ['Provider registration accepted', $sub?->registered_at?->toIso8601String() ?? 'Not yet accepted'],
                ['Next automatic retry/check', $sub?->next_attempt_at?->toIso8601String() ?? 'Not scheduled'],
                ['Last saved-result check', $sub?->last_checked_at?->toIso8601String() ?? 'Not yet checked'],
                ['Signed update', $sub?->last_webhook_at?->toIso8601String() ?? 'Not yet received for this subscription'],
                ['Courier status', $sub?->diagnostic ? ($sub->latest_result['status_label'] ?? 'No saved results') : ($tracker?->status ?? 'No saved results')],
                ['Registration issue', $sub?->last_error_code ?? 'None recorded'],
            ]);
            $this->line('An assigned tracking number syncs automatically. An unassigned diagnostic/preview does not complete an order.');
        }
        $this->info($readOnly ? 'Status only: no provider request, registration, payment, or refund was performed.'
            : 'Saved provider results processed. No payment or refund was performed.');
        return self::SUCCESS;
    }
}
