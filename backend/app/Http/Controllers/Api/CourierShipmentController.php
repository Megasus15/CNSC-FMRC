<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\NinjaVanShipping;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

final class CourierShipmentController extends Controller
{
    private function authorize(Request $request): void
    {
        abort_unless(in_array(strtolower($request->user()?->role ?? ''), ['admin', 'staff'], true), 403);
    }

    public function book(Request $request, Order $order): JsonResponse
    {
        $this->authorize($request);
        abort(422, 'New deliveries use J&T drop-off. Record the J&T waybill after handing over the parcel.');
    }

    public function cancel(Request $request, Order $order, NinjaVanShipping $shipping): JsonResponse
    {
        $this->authorize($request);
        $input = $request->validate(['request_key' => ['required', 'uuid']]);
        $shipping->cancel($order, $input['request_key'], (int) $request->user()->id);

        return app(OrderController::class)->adminShow($request, $order->fresh());
    }

    public function link(Request $request, Order $order, NinjaVanShipping $shipping): JsonResponse
    {
        $this->authorize($request);
        $input = $request->validate(['tracking_number' => ['required', 'string', 'regex:/^[a-zA-Z0-9-]{9,100}$/']]);
        $shipping->link($order, $input['tracking_number'], (int) $request->user()->id);

        return app(OrderController::class)->adminShow($request, $order->fresh());
    }

    public function webhook(Request $request, NinjaVanShipping $shipping): JsonResponse
    {
        $secret = (string) config('ninjavan.client_secret');
        $raw = $request->getContent();
        abort_unless($secret !== '' && strlen($raw) <= 262144 && hash_equals(base64_encode(hash_hmac('sha256', $raw, $secret, true)), trim((string) $request->header('X-Ninjavan-Hmac-Sha256'))), 401);
        abort_unless(NinjaVanShipping::installed(), 503);
        $input = $request->validate(['tracking_id' => ['required', 'string', 'max:100'], 'shipper_order_ref_no' => ['nullable', 'string', 'max:100'],
            'timestamp' => ['required', 'date'], 'status' => ['required', 'string', 'max:160'], 'is_parcel_on_rts_leg' => ['sometimes', 'boolean']]);
        if (Carbon::parse($input['timestamp'])->gt(now()->addDay())) {
            abort(422);
        }
        // Include only the small, signed location objects. Proof/media URLs and
        // the rest of the courier payload are not needed for tracking history.
        foreach ($request->all() as $key => $value) {
            if (str_ends_with((string) $key, '_information') && is_array($value)) {
                $input[$key] = array_intersect_key($value, array_flip(['city', 'hub']));
            }
        }
        $shipping->webhook($input);

        return response()->json(['received' => true]);
    }
}
