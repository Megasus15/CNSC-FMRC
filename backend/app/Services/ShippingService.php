<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Models\Promotion;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ShippingService
{
    public const TIMEZONE = 'Asia/Manila';

    public static function defaults(): array
    {
        return ['enabled' => false, 'nonworking_weekdays' => [6, 7], 'nonworking_dates' => [], 'zones' => []];
    }

    public static function settings(bool $lock = false): object
    {
        abort_unless(Schema::hasTable('shipping_settings') && Schema::hasColumns('orders', ['shipping_fee', 'shipping_quote', 'estimated_delivery_from', 'estimated_delivery_to']), 503,
            'Shipping settings are temporarily unavailable. Please try again later.');
        $query = DB::table('shipping_settings')->where('id', 1);

        return ($lock ? $query->lockForUpdate() : $query)->firstOrFail();
    }

    public static function decode(?string $json): ?array
    {
        return $json === null ? null : json_decode($json, true, flags: JSON_THROW_ON_ERROR);
    }

    /** One catalog price calculation for quoting and the locked order write. */
    public static function priceItems(array $items, Collection $products, Collection $promotions): array
    {
        $quantities = [];
        foreach ($items as $item) {
            $id = (int) ($item['product_id'] ?? 0);
            $quantities[$id] = ($quantities[$id] ?? 0) + (int) $item['quantity'];
        }
        foreach ($quantities as $id => $quantity) {
            $product = $products->get($id);
            if (! $product || $product->is_blocked || (int) $product->stock < $quantity) {
                throw ValidationException::withMessages(['items' => 'One or more products are unavailable or exceed the available stock. Review your cart.']);
            }
        }

        return array_map(function (array $item) use ($products, $promotions): array {
            $product = $products->get((int) $item['product_id']);
            $promotion = $promotions->filter(fn (Promotion $candidate) => $candidate->appliesTo($product))->sortByDesc('discount_percent')->first();
            $unit = (int) round(GatewayPayments::centavos($product->price) * (100 - ($promotion ? (int) $promotion->discount_percent : 0)) / 100);

            return array_replace($item, ['product_name' => $product->name, 'unit_price' => $unit / 100,
                'line_total' => ($unit * (int) $item['quantity']) / 100]);
        }, $items);
    }

    public static function catalogQuote(array $input, int $owner): array
    {
        $items = $input['items'];
        $products = Product::whereIn('id', array_column($items, 'product_id'))->get()->keyBy('id');
        $priced = self::priceItems($items, $products, Promotion::where('is_enabled', true)->get());

        return self::quote($input, $priced, $owner, self::settings());
    }

    private static function normalize(mixed $value): string
    {
        return Str::lower(preg_replace('/\s+/u', ' ', trim((string) $value)));
    }

    private static function destination(array $input): array
    {
        if ($input['fulfillment_type'] === 'pickup') {
            return [];
        }

        return array_map(self::normalize(...), array_intersect_key($input, array_flip([
            'delivery_province', 'delivery_city', 'delivery_postal_code',
        ])));
    }

    private static function advance(Carbon $date, int $days, array $settings): Carbon
    {
        $working = fn (Carbon $day) => ! in_array($day->dayOfWeekIso, $settings['nonworking_weekdays'], true)
            && ! in_array($day->toDateString(), $settings['nonworking_dates'], true);
        if ($days > 0) {
            $date->addDay();
        }
        // A preparation day is a full working day after ordering. Orders on
        // nonworking days start counting at the next working day.
        for ($guard = 0; $guard < 10000; $guard++) {
            if ($working($date) && ($days === 0 || --$days === 0)) {
                return $date;
            }
            $date->addDay();
        }
        abort(503, 'Delivery estimates are temporarily unavailable. Please choose pickup or try again later.');
    }

    public static function quote(array $input, array $items, int $owner, object $record): array
    {
        $settings = self::decode($record->published) ?? self::defaults();
        $pickup = $input['fulfillment_type'] === 'pickup';
        $zone = null;
        $destination = self::destination($input);
        if (! $pickup && $settings['enabled']) {
            $matches = array_filter($settings['zones'], function ($candidate) use ($destination) {
                return self::normalize($candidate['province']) === ($destination['delivery_province'] ?? '')
                    && (! $candidate['cities'] || in_array($destination['delivery_city'] ?? '', array_map(self::normalize(...), $candidate['cities']), true))
                    && (! $candidate['postal_codes'] || in_array($destination['delivery_postal_code'] ?? '', $candidate['postal_codes'], true));
            });
            $priority = fn ($candidate) => ($candidate['cities'] ? 1 : 0) + ($candidate['postal_codes'] ? 2 : 0);
            usort($matches, fn ($a, $b) => $priority($b) <=> $priority($a));
            if ($matches && (count($matches) === 1 || $priority($matches[0]) !== $priority($matches[1]))) {
                $zone = $matches[0];
            }
        }
        $subtotal = array_sum(array_map(fn ($item) => GatewayPayments::centavos($item['line_total']), $items));
        if (! $pickup && ! $zone) {
            return ['available' => false, 'fulfillment_type' => 'delivery', 'item_subtotal' => $subtotal / 100,
                'shipping_fee' => null, 'payable_total' => null, 'message' => 'Delivery is unavailable for this destination. Choose pickup at FMRC or contact us for assistance.'];
        }

        $cart = [];
        foreach ($items as $item) {
            $key = $item['product_id'].':'.GatewayPayments::centavos($item['unit_price']);
            $cart[$key] = ($cart[$key] ?? 0) + (int) $item['quantity'];
        }
        ksort($cart);
        ksort($destination);
        $fee = $pickup ? 0 : GatewayPayments::centavos($zone['fee']);
        abort_if($subtotal + $fee > 999999999, 422, 'This order exceeds the maximum checkout total. Please reduce the quantities.');
        $ready = $pickup ? null : self::advance(Carbon::now(self::TIMEZONE)->startOfDay(), $zone['preparation_days'], $settings);
        $quote = ['available' => true, 'fulfillment_type' => $input['fulfillment_type'], 'currency' => 'PHP',
            'settings_version' => $record->published_version, 'zone_id' => $zone['id'] ?? null, 'zone_name' => $zone['name'] ?? null,
            'destination' => $destination, 'cart' => $cart, 'item_subtotal' => $subtotal / 100,
            'shipping_fee' => $fee / 100, 'payable_total' => ($subtotal + $fee) / 100,
            'preparation_days' => $zone['preparation_days'] ?? null,
            'transit_min_days' => $zone['transit_min_days'] ?? null, 'transit_max_days' => $zone['transit_max_days'] ?? null,
            'estimated_delivery_from' => $ready ? self::advance($ready->copy(), $zone['transit_min_days'], $settings)->toDateString() : null,
            'estimated_delivery_to' => $ready ? self::advance($ready->copy(), $zone['transit_max_days'], $settings)->toDateString() : null];
        $quote['fingerprint'] = hash('sha256', json_encode($quote));
        $quote['quoted_at'] = now()->toIso8601String();
        $quote['expires_at'] = now()->addMinutes(15)->toIso8601String();
        $quote['quote_token'] = Crypt::encryptString(json_encode(['owner' => $owner, 'fingerprint' => $quote['fingerprint'],
            'quoted_at' => $quote['quoted_at'], 'expires_at' => $quote['expires_at']]));

        return $quote;
    }

    public static function accept(array $input, array $pricedItems, int $owner): array
    {
        $fresh = self::quote($input, $pricedItems, $owner, self::settings(true));
        $accepted = null;
        try {
            $accepted = json_decode(Crypt::decryptString($input['shipping_quote_token'] ?? ''), true);
        } catch (DecryptException) { /* The response below also handles missing or modified tokens. */
        }
        if (! $fresh['available'] || ! is_array($accepted) || ($accepted['owner'] ?? null) !== $owner
            || ! hash_equals($fresh['fingerprint'] ?? '', (string) ($accepted['fingerprint'] ?? ''))
            || Carbon::parse($accepted['expires_at'] ?? '1970-01-01')->isPast()) {
            throw new HttpResponseException(response()->json(['message' => 'Your shipping quote has changed or expired. Review the updated total before placing your order.',
                'code' => 'shipping_quote_stale', 'quote' => $fresh], 409));
        }
        unset($fresh['quote_token']);
        $fresh['quoted_at'] = $accepted['quoted_at'];
        $fresh['expires_at'] = $accepted['expires_at'];
        $fresh['accepted_at'] = now()->toIso8601String();

        return $fresh;
    }

    public static function present(Order $order): array
    {
        $hasSnapshot = is_array($order->shipping_quote);
        $from = $order->estimated_delivery_from?->toDateString();
        $to = $order->estimated_delivery_to?->toDateString();
        $label = $from && $to ? Carbon::parse($from)->format('M j, Y').($from !== $to ? ' – '.Carbon::parse($to)->format('M j, Y') : '') : null;

        return ['has_shipping_snapshot' => $hasSnapshot, 'item_subtotal' => (float) $order->subtotal,
            'item_subtotal_label' => '₱'.number_format((float) $order->subtotal, 2),
            'shipping_fee' => $hasSnapshot ? (float) $order->shipping_fee : null,
            'shipping_fee_label' => $hasSnapshot ? '₱'.number_format((float) $order->shipping_fee, 2) : 'Not recorded',
            'payable_total' => (float) $order->total, 'payable_total_label' => '₱'.number_format((float) $order->total, 2),
            'estimated_delivery_from' => $from, 'estimated_delivery_to' => $to,
            'estimated_delivery_label' => $label ?? ($hasSnapshot && $order->isPickup() ? 'Not applicable (pickup)' : 'Not recorded'),
            'shipping_zone_name' => $hasSnapshot ? ($order->shipping_quote['zone_name'] ?? null) : null];
    }
}
