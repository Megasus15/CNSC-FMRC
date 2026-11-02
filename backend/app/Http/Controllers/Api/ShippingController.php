<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ShippingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ShippingController extends Controller
{
    private function authorize(Request $request, bool $write = false): void
    {
        abort_unless(in_array(strtolower($request->user()?->role ?? ''), $write ? ['admin'] : ['admin', 'staff'], true), 403);
    }

    public function show(Request $request): JsonResponse
    {
        $this->authorize($request);
        $record = ShippingService::settings();

        return response()->json(['data' => $this->snapshot($record, strtolower($request->user()->role) === 'admin')]);
    }

    private function snapshot(object $record, bool $admin): array
    {
        return ['revision' => $record->revision, 'published_version' => $record->published_version,
            'published_at' => $record->published_at, 'published' => ShippingService::decode($record->published),
            'can_edit' => $admin, ...($admin ? ['draft' => ShippingService::decode($record->draft) ?? ShippingService::decode($record->published) ?? ShippingService::defaults()] : [])];
    }

    public function saveDraft(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        $data = $request->validate([
            'expected_revision' => ['required', 'integer', 'min:0'], 'settings' => ['required', 'array'],
            'settings.enabled' => ['required', 'boolean'], 'settings.zones' => ['present', 'array', 'max:100'],
            'settings.nonworking_weekdays' => ['present', 'array', 'max:6'],
            'settings.nonworking_weekdays.*' => ['integer', 'between:1,7', 'distinct'],
            'settings.nonworking_dates' => ['present', 'array', 'max:3660'],
            'settings.nonworking_dates.*' => ['date_format:Y-m-d', 'distinct'],
            'settings.zones.*.id' => ['required', 'uuid', 'distinct'],
            'settings.zones.*.name' => ['required', 'string', 'max:100'],
            'settings.zones.*.province' => ['required', 'string', 'max:120'],
            'settings.zones.*.cities' => ['present', 'array', 'max:200'],
            'settings.zones.*.cities.*' => ['string', 'max:120', 'distinct'],
            'settings.zones.*.postal_codes' => ['present', 'array', 'max:500'],
            'settings.zones.*.postal_codes.*' => ['string', 'regex:/^\d{4}$/', 'distinct'],
            'settings.zones.*.fee' => ['required', 'numeric', 'decimal:0,2', 'between:0,999999.99'],
            'settings.zones.*.preparation_days' => ['required', 'integer', 'between:0,90'],
            'settings.zones.*.transit_min_days' => ['required', 'integer', 'between:1,90'],
            'settings.zones.*.transit_max_days' => ['required', 'integer', 'between:1,90'],
        ]);
        $data['settings']['enabled'] = (bool) $data['settings']['enabled'];
        $data['settings']['nonworking_weekdays'] = array_map('intval', $data['settings']['nonworking_weekdays']);
        sort($data['settings']['nonworking_weekdays']);
        sort($data['settings']['nonworking_dates']);
        foreach ($data['settings']['zones'] as $index => $zone) {
            if ($zone['transit_min_days'] > $zone['transit_max_days']) {
                throw ValidationException::withMessages([
                    "settings.zones.$index.transit_max_days" => 'The maximum transit days must be at least the minimum.']);
            }
        }
        $record = DB::transaction(function () use ($data) {
            $record = ShippingService::settings(true);
            abort_unless((int) $record->revision === (int) $data['expected_revision'], 409, 'Shipping settings changed. Refresh and review the latest draft before saving.');
            DB::table('shipping_settings')->where('id', 1)->update(['draft' => json_encode($data['settings']),
                'revision' => $record->revision + 1, 'updated_at' => now()]);

            return ShippingService::settings();
        });

        return response()->json(['data' => $this->snapshot($record, true)]);
    }

    public function publish(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        $data = $request->validate(['expected_revision' => ['required', 'integer', 'min:0'], 'approved' => ['required', 'accepted']]);
        $record = DB::transaction(function () use ($data, $request) {
            $record = ShippingService::settings(true);
            abort_unless((int) $record->revision === (int) $data['expected_revision'], 409, 'Shipping settings changed. Refresh and review the latest draft before publishing.');
            $draft = ShippingService::decode($record->draft);
            if (! $draft || ($draft['enabled'] && ! $draft['zones'])) {
                throw ValidationException::withMessages([
                    'settings' => 'Save a valid draft with approved destination zones before enabling delivery.']);
            }
            // Same-priority overlaps are ambiguous; a province-wide fallback and
            // a more specific city/postal zone may intentionally coexist.
            foreach ($draft['zones'] as $index => $zone) {
                foreach (array_slice($draft['zones'], $index + 1) as $other) {
                    $normalize = fn ($text) => Str::lower(preg_replace('/\s+/u', ' ', trim($text)));
                    $priority = fn ($value) => (int) (bool) $value['cities'] + 2 * (int) (bool) $value['postal_codes'];
                    $overlap = fn ($a, $b) => ! $a || ! $b || array_intersect(array_map($normalize, $a), array_map($normalize, $b));
                    if ($normalize($zone['province']) === $normalize($other['province']) && $priority($zone) === $priority($other)
                        && $overlap($zone['cities'], $other['cities']) && $overlap($zone['postal_codes'], $other['postal_codes'])) {
                        throw ValidationException::withMessages(['settings.zones' => 'Destination zones with the same specificity must not overlap. Review '.$zone['name'].' and '.$other['name'].'.']);
                    }
                }
            }
            DB::table('shipping_settings')->where('id', 1)->update(['published' => $record->draft,
                'published_version' => (string) Str::uuid(), 'published_at' => now(), 'published_by' => $request->user()->id,
                'revision' => $record->revision + 1, 'updated_at' => now()]);

            return ShippingService::settings();
        });

        return response()->json(['data' => $this->snapshot($record, true)]);
    }

    public function quote(Request $request): JsonResponse
    {
        abort_unless(strtolower($request->user()?->role ?? '') === 'customer', 403);
        $input = $request->validate(['fulfillment_type' => ['required', 'in:pickup,delivery'],
            'items' => ['required', 'array', 'min:1', 'max:100'], 'items.*.product_id' => ['required', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'between:1,999'],
            'delivery_province' => ['required_if:fulfillment_type,delivery', 'nullable', 'string', 'max:120'],
            'delivery_city' => ['required_if:fulfillment_type,delivery', 'nullable', 'string', 'max:120'],
            'delivery_postal_code' => ['required_if:fulfillment_type,delivery', 'nullable', 'digits:4']]);

        return response()->json(['data' => ShippingService::catalogQuote($input, (int) $request->user()->id)]);
    }
}
