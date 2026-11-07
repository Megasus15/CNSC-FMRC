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

        return $this->settingsResponse($record, strtolower($request->user()->role) === 'admin');
    }

    private function settingsResponse(object $record, bool $admin): JsonResponse
    {
        return response()->json(['data' => $this->snapshot($record, $admin)])
            ->header('Cache-Control', 'private, no-store, max-age=0')
            ->header('Vary', 'Authorization');
    }

    private function snapshot(object $record, bool $admin): array
    {
        return ['revision' => $record->revision, 'published_version' => $record->published_version,
            'published_at' => $record->published_at, 'published' => ShippingService::decode($record->published),
            'can_edit' => $admin, ...($admin ? ['draft' => ShippingService::decode($record->draft) ?? ShippingService::decode($record->published) ?? ShippingService::defaults(),
                'has_saved_draft' => $record->draft !== null] : [])];
    }

    public function saveDraft(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        $rules = [
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
            'settings.zones.*.postal_codes' => ['present', 'array', 'max:500'],
            'settings.zones.*.fee' => ['required', 'numeric', 'decimal:0,2', 'between:0,999999.99'],
            'settings.zones.*.preparation_days' => ['required', 'integer', 'between:0,90'],
            'settings.zones.*.transit_min_days' => ['required', 'integer', 'between:1,90'],
            'settings.zones.*.transit_max_days' => ['required', 'integer', 'between:1,90'],
        ];
        $messages = [
            'settings.nonworking_weekdays.max' => 'Leave at least one day unchecked so delivery dates can be calculated.',
            'settings.nonworking_weekdays.*.distinct' => 'Select each weekly day off only once.',
            'settings.nonworking_dates.*.date_format' => 'Enter closed dates as YYYY-MM-DD, one per line.',
            'settings.nonworking_dates.*.distinct' => 'A closed date is repeated. Enter each date only once.',
        ];
        $attributes = ['settings' => 'shipping settings', 'settings.enabled' => 'delivery option', 'settings.zones' => 'delivery areas',
            'settings.nonworking_weekdays' => 'weekly days off', 'settings.nonworking_weekdays.*' => 'weekly day off',
            'settings.nonworking_dates' => 'closed dates', 'settings.nonworking_dates.*' => 'closed date'];
        $zones = $request->input('settings.zones', []);
        if (is_array($zones)) {
            foreach (array_slice($zones, 0, 100, true) as $index => $zone) {
                // Scope distinct to this area; different areas may share a city
                // name or postal code when their other coverage differs.
                $rules["settings.zones.$index.cities.*"] = ['string', 'max:120', 'distinct:ignore_case'];
                $rules["settings.zones.$index.postal_codes.*"] = ['string', 'regex:/^\d{4}$/', 'distinct'];
                $number = is_numeric($index) ? (int) $index + 1 : 1;
                foreach (['name' => 'area name', 'province' => 'province', 'cities' => 'cities or municipalities',
                    'postal_codes' => 'postal codes', 'fee' => 'shipping fee', 'preparation_days' => 'preparation days',
                    'transit_min_days' => 'fastest delivery days', 'transit_max_days' => 'longest delivery days', 'id' => 'area reference'] as $key => $label) {
                    $attributes["settings.zones.$index.$key"] = "$label for delivery area $number";
                }
                $attributes["settings.zones.$index.cities.*"] = "city or municipality for delivery area $number";
                $attributes["settings.zones.$index.postal_codes.*"] = "postal code for delivery area $number";
                $messages["settings.zones.$index.cities.*.distinct"] = "Delivery area $number has a repeated city or municipality. Enter each name only once.";
                $messages["settings.zones.$index.postal_codes.*.distinct"] = "Delivery area $number has a repeated postal code. Enter each postal code only once.";
                $messages["settings.zones.$index.postal_codes.*.regex"] = "Enter four-digit postal codes for delivery area $number.";
            }
        }
        $data = $request->validate($rules, $messages, $attributes);
        $data['settings']['enabled'] = (bool) $data['settings']['enabled'];
        $data['settings']['nonworking_weekdays'] = array_map('intval', $data['settings']['nonworking_weekdays']);
        sort($data['settings']['nonworking_weekdays']);
        sort($data['settings']['nonworking_dates']);
        foreach ($data['settings']['zones'] as $index => $zone) {
            if ($zone['transit_min_days'] > $zone['transit_max_days']) {
                throw ValidationException::withMessages([
                    "settings.zones.$index.transit_max_days" => 'The longest delivery time must be at least the fastest delivery time for delivery area '.($index + 1).'.']);
            }
        }
        $record = DB::transaction(function () use ($data) {
            $record = ShippingService::settings(true);
            abort_unless((int) $record->revision === (int) $data['expected_revision'], 409, 'Shipping settings changed. Refresh and review the latest draft before saving.');
            DB::table('shipping_settings')->where('id', 1)->update(['draft' => json_encode($data['settings']),
                'revision' => $record->revision + 1, 'updated_at' => now()]);

            return ShippingService::settings();
        });

        return $this->settingsResponse($record, true);
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
                    'settings' => 'Add at least one approved delivery area and save the draft before publishing delivery settings.']);
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
                        throw ValidationException::withMessages(['settings.zones' => 'Delivery areas overlap. Review the coverage for '.$zone['name'].' and '.$other['name'].' so each address has one matching rate.']);
                    }
                }
            }
            DB::table('shipping_settings')->where('id', 1)->update(['published' => $record->draft,
                'published_version' => (string) Str::uuid(), 'published_at' => now(), 'published_by' => $request->user()->id,
                'revision' => $record->revision + 1, 'updated_at' => now()]);

            return ShippingService::settings();
        });

        return $this->settingsResponse($record, true);
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
