<?php

namespace App\Support;

use Illuminate\Support\Facades\Schema;

final class CustomProductSchema
{
    public const MESSAGE = 'Custom requests are temporarily unavailable. Please try again shortly.';

    public static function hasOrderLink(): bool
    {
        return self::check(__FUNCTION__, fn () => Schema::hasColumn('orders', 'custom_product_quote_id'));
    }

    public static function hasQuoteDetails(): bool
    {
        return self::check(__FUNCTION__, fn () =>
            Schema::hasColumns('custom_product_quotes', ['id', 'custom_product_request_id', 'version', 'snapshot'])
            && Schema::hasColumns('custom_product_requests', ['id', 'service_snapshot', 'specifications'])
        );
    }

    public static function ready(): bool
    {
        return self::check(__FUNCTION__, fn () =>
            self::hasOrderLink()
            && Schema::hasColumns('orders', ['production_status', 'production_started_at', 'production_ready_at'])
            && Schema::hasColumn('services', 'accepts_custom_requests')
            && self::hasQuoteDetails()
            && Schema::hasColumns('custom_product_quotes', ['author_id', 'status', 'unit_price_centavos', 'subtotal_centavos', 'shipping_centavos', 'total_centavos', 'sent_at', 'expires_at', 'accepted_at', 'created_at', 'updated_at'])
            && Schema::hasColumns('custom_product_requests', ['customer_id', 'creation_key', 'service_id', 'status', 'revision', 'submitted_at', 'created_at', 'updated_at'])
            && Schema::hasColumns('custom_product_messages', ['id', 'custom_product_request_id', 'author_id', 'body', 'created_at', 'updated_at'])
            && Schema::hasColumns('custom_product_attachments', ['id', 'custom_product_request_id', 'message_id', 'author_id', 'name', 'path', 'mime', 'size', 'created_at', 'updated_at'])
            && Schema::hasColumns('custom_product_events', ['id', 'custom_product_request_id', 'actor_id', 'request_key', 'action', 'payload_hash', 'description', 'created_at', 'updated_at'])
        );
    }

    private static function check(string $key, callable $check): bool
    {
        // The result lives only for this HTTP request. A refresh sees a completed migration.
        $attributes = request()->attributes;
        $key = self::class.'.'.$key;
        if (!$attributes->has($key)) {
            $attributes->set($key, $check());
        }

        return $attributes->get($key);
    }
}
