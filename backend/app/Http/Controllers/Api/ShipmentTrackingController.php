<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\OrderTrackingTest;
use App\Services\SeventeenTrackClient;
use App\Services\SeventeenTrackTracking;
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
        ], ['tracking_number.regex' => 'Enter the complete J&T tracking number number, using 5–50 letters, numbers, or tracking number punctuation.',
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

    public function trackingTest(Request $request, Order $order, OrderTrackingTest $test): JsonResponse
    {
        $this->authorize($request, true);
        $input = $request->isMethod('DELETE') ? [] : $request->validate([
            'tracking_number' => ['required', 'string', 'regex:/^[A-Za-z0-9-]{5,50}$/'],
            'test_confirmed' => ['required', 'accepted'],
        ]);
        $test->change($order, $input['tracking_number'] ?? null, (int) $request->user()->id);

        return app(OrderController::class)->adminShow($request, $order->fresh());
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        abort_unless(ShipmentTracking::subscriptionsInstalled(), 503);
        $input = $request->validate(['enabled' => ['required', 'boolean'], 'expected_revision' => ['required', 'integer', 'min:0']]);
        DB::transaction(function () use ($input) {
            $settings = DB::table('shipment_tracking_settings')->where('id', ShipmentTracking::settings()->id)->lockForUpdate()->first();
            abort_unless((int) $settings->revision === (int) $input['expected_revision'], 409, 'Tracking settings changed. Refresh before saving.');
            if ($input['enabled'] && ! ShipmentTracking::health()['ready']) {
                ShipmentTracking::fail('Complete the live account, FMRC shipment, signed webhook, worker, and credit-budget checks before activation.');
            }
            DB::table('shipment_tracking_settings')->where('id', $settings->id)->update(['enabled' => $input['enabled'], 'revision' => $settings->revision + 1, 'updated_at' => now()]);
        });

        return $this->settings($request);
    }

    public function head(): Response
    {
        return response('', 200);
    }

    public function webhook17(Request $request, SeventeenTrackTracking $tracking): JsonResponse
    {
        $raw = $request->getContent();
        abort_unless(strlen($raw) <= 1048576, 413);
        $key = (string) config('track17.api_key');
        $signature = (string) $request->header('sign');
        abort_unless($key !== '' && preg_match('/^[a-fA-F0-9]{64}$/', $signature)
            && hash_equals(hash('sha256', $raw.'/'.$key), strtolower($signature)), 401);
        abort_unless(ShipmentTracking::subscriptionsInstalled() && SeventeenTrackClient::configured(), 503);
        $input = $request->validate([
            'event' => ['required', 'in:TRACKING_UPDATED,TRACKING_STOPPED'], 'data' => ['required', 'array'],
            'data.number' => ['required', 'string', 'max:50'], 'data.carrier' => ['required', 'integer'],
            'data.tag' => ['nullable', 'string', 'max:100'], 'data.destination_country' => ['nullable', 'string', 'max:3'],
            'data.track_info' => ['nullable', 'array'], 'data.track_info.latest_status' => ['sometimes', 'nullable', 'array'],
            'data.track_info.latest_event' => ['sometimes', 'nullable', 'array'],
            'data.track_info.tracking.providers' => ['sometimes', 'nullable', 'array', 'max:20'],
            'data.track_info.tracking.providers.*.provider' => ['required', 'array'],
            'data.track_info.tracking.providers.*.events' => ['sometimes', 'nullable', 'array', 'max:2000'],
            'data.track_info.tracking.providers.*.events.*' => ['array'],
        ]);
        $tracking->receive($input);

        return response()->json(['received' => true], 200);
    }
}
