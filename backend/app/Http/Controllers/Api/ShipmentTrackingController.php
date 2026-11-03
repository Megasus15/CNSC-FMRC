<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\Ship24Client;
use App\Services\Ship24Tracking;
use App\Services\ShipmentTracking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

final class ShipmentTrackingController extends Controller
{
    private function authorize(Request $request, bool $adminOnly = false): void
    {
        abort_unless(in_array(strtolower($request->user()?->role ?? ''), $adminOnly ? ['admin'] : ['admin', 'staff'], true), 403);
    }

    private function input(Request $request, bool $correction = false): array
    {
        return $request->validate([
            'request_key' => ['required', 'uuid'],
            'tracking_number' => ['required', 'string', 'regex:~^[A-Za-z0-9_./-]{5,50}$~'],
            'handed_over_at' => ['required', 'date'], 'handover_confirmed' => ['required', 'accepted'],
            'actual_shipping_cost' => ['nullable', 'numeric', 'between:0,999999.99', 'decimal:0,2'],
            ...($correction ? ['expected_version' => ['required', 'integer', 'min:1'],
                'correction_reason' => ['required', 'string', 'min:5', 'max:500']] : []),
        ], ['tracking_number.regex' => 'Enter the complete J&T waybill number, using 5–50 letters, numbers, or waybill punctuation.',
            'handover_confirmed.accepted' => 'Confirm that this parcel was physically handed to J&T.']);
    }

    public function store(Request $request, Order $order, ShipmentTracking $tracking): JsonResponse
    {
        $this->authorize($request);
        $tracking->record($order, $this->input($request), (int) $request->user()->id);

        return app(OrderController::class)->adminShow($request, $order->fresh());
    }

    public function correct(Request $request, Order $order, ShipmentTracking $tracking): JsonResponse
    {
        $this->authorize($request, true);
        $tracking->record($order, $this->input($request, true), (int) $request->user()->id, true);

        return app(OrderController::class)->adminShow($request, $order->fresh());
    }

    public function refresh(Request $request, Order $order, ShipmentTracking $tracking): JsonResponse
    {
        $this->authorize($request);
        abort_unless(ShipmentTracking::installed(), 503);
        $tracking->refresh($order);

        return app(OrderController::class)->adminShow($request, $order->fresh());
    }

    public function settings(Request $request): JsonResponse
    {
        $this->authorize($request);

        return response()->json(['data' => ShipmentTracking::health() + ['can_edit' => strtolower($request->user()->role) === 'admin']]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        abort_unless(ShipmentTracking::installed(), 503);
        $input = $request->validate(['enabled' => ['required', 'boolean'], 'expected_revision' => ['required', 'integer', 'min:0']]);
        DB::transaction(function () use ($input) {
            $settings = DB::table('shipment_tracking_settings')->where('id', 1)->lockForUpdate()->first();
            abort_unless((int) $settings->revision === (int) $input['expected_revision'], 409, 'Tracking settings changed. Refresh before saving.');
            if ($input['enabled'] && (! ShipmentTracking::verified($settings) || ! config('ship24.enabled'))) {
                ShipmentTracking::fail('Complete the account, J&T waybill, and webhook checks before activating automatic tracking.');
            }
            DB::table('shipment_tracking_settings')->where('id', 1)->update(['enabled' => $input['enabled'], 'revision' => $settings->revision + 1, 'updated_at' => now()]);
        });

        return $this->settings($request);
    }

    public function head(): Response
    {
        return response('', 200);
    }

    public function webhook(Request $request, Ship24Tracking $tracking): JsonResponse
    {
        $secret = (string) config('ship24.webhook_secret');
        abort_unless($secret !== '' && hash_equals($secret, (string) $request->bearerToken()), 401);
        abort_unless(strlen($request->getContent()) <= 1048576, 413);
        abort_unless(ShipmentTracking::installed() && Ship24Client::configured(), 503);
        $input = $request->validate([
            'trackings' => ['required', 'array', 'min:1', 'max:100'],
            'trackings.*.tracker' => ['required', 'array'],
            'trackings.*.tracker.trackerId' => ['required', 'string', 'max:100'],
            'trackings.*.tracker.clientTrackerId' => ['nullable', 'string', 'max:100'],
            'trackings.*.tracker.trackingNumber' => ['required', 'string', 'max:100'],
            'trackings.*.tracker.shipmentReference' => ['nullable', 'string', 'max:100'],
            'trackings.*.metadata' => ['sometimes', 'array'], 'trackings.*.metadata.messageId' => ['sometimes', 'string', 'max:100'],
            'trackings.*.metadata.topic' => ['sometimes', 'in:tracking/events'],
            'trackings.*.shipment' => ['sometimes', 'array'],
            'trackings.*.events' => ['present', 'array', 'max:500'],
            'trackings.*.events.*.eventId' => ['required', 'string', 'max:100'],
            'trackings.*.events.*.status' => ['nullable', 'string', 'max:2000'],
            'trackings.*.events.*.statusMilestone' => ['nullable', 'string', 'max:80'],
            'trackings.*.events.*.occurrenceDatetime' => ['required', 'string', 'max:50'],
            'trackings.*.events.*.courierCode' => ['nullable', 'string', 'max:100'],
            'trackings.*.events.*.location' => ['nullable', 'string', 'max:1000'],
            'trackings.*.events.*.order' => ['nullable', 'integer'],
        ]);
        $tracking->receive($input['trackings']);

        return response()->json(['received' => true], 202);
    }
}
