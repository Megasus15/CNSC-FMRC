<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Folds per-product sales rows into per-category totals.
 *
 * The category cards used to do this inside one SQL statement:
 *
 *     GROUP BY COALESCE(NULLIF(products.category, ''), 'Deleted / Uncategorized')
 *
 * which stacks four fragile things into a single query — a grouped *expression*
 * (MySQL resolves a matching output alias, SQLite resolves the source column
 * first), two string literals whose collation comes from the client connection
 * rather than from the column, a join whose only purpose is to reach one column,
 * and an aggregate over the result. On the Hostinger server that statement threw
 * where an identically shaped query grouping on `order_items.product_name`
 * succeeded, which left the dashboard's Sales by Category card reading "Not
 * available right now" with the driver's own message swallowed by LOG_LEVEL=error.
 *
 * Doing the fold here removes every one of those moving parts. Callers group on
 * `order_items.product_id`, a plain integer column on a table they already read,
 * and the category is looked up separately with no join, no expression and no
 * literal. NULL, '' and a product row that no longer exists all land in one
 * bucket because PHP says so, not because a COALESCE happened to survive the
 * trip through two different SQL dialects.
 */
class CategorySalesBuckets
{
    /**
     * Shown when order_items points at a product that has since been deleted, or
     * at one whose category was cleared. The money is real — order_items keeps
     * its own product_name and line_total snapshot — only the category is gone.
     * Matches ProductAnalyticsController's label so every card reads the same.
     */
    public const FALLBACK_LABEL = 'Deleted / Uncategorized';

    /**
     * @param  iterable<int, object>  $rows  each with product_id, total_sold, total_revenue
     * @return Collection<int, array{category: string, total_sold: int, total_revenue: float}>
     *                                                                                         ordered by revenue, highest first
     */
    public static function fold(iterable $rows): Collection
    {
        $rows = collect($rows);

        if ($rows->isEmpty()) {
            return collect();
        }

        $labels = self::labels($rows->pluck('product_id')->all());
        $buckets = [];

        foreach ($rows as $row) {
            $label = self::labelFor($labels, $row->product_id ?? null);

            if (! isset($buckets[$label])) {
                $buckets[$label] = [
                    'category' => $label,
                    'total_sold' => 0,
                    'total_revenue' => 0.0,
                ];
            }

            $buckets[$label]['total_sold'] += (int) ($row->total_sold ?? 0);
            $buckets[$label]['total_revenue'] += (float) ($row->total_revenue ?? 0);
        }

        return collect($buckets)->sortByDesc('total_revenue')->values();
    }

    /**
     * Category text keyed by product id, for the ids that still resolve.
     *
     * @param  array<int, mixed>  $productIds
     * @return array<int|string, string|null>
     */
    public static function labels(array $productIds): array
    {
        return array_map(
            static fn ($row) => $row->category ?? null,
            self::meta($productIds)
        );
    }

    /**
     * `code` and `category` keyed by product id, for the ids that still resolve.
     *
     * A server that cannot read `products` at all still has real money sitting
     * in order_items, so the failure returns an empty map — every sale then
     * reports under FALLBACK_LABEL, which is exactly what "the category is
     * unknown" means — instead of blanking the card. It is logged either way so
     * the underlying cause stays findable.
     *
     * @param  array<int, mixed>  $productIds
     * @return array<int|string, object>
     */
    public static function meta(array $productIds): array
    {
        $ids = array_values(array_unique(array_filter(
            $productIds,
            static fn ($id) => $id !== null && $id !== '' && $id !== 0 && $id !== '0'
        )));

        if ($ids === []) {
            return [];
        }

        try {
            return DB::table('products')
                ->whereIn('id', $ids)
                ->get(['id', 'code', 'category'])
                ->keyBy('id')
                ->all();
        } catch (\Throwable $exception) {
            Log::warning(sprintf(
                'Product categories could not be read; sales report under "%s" instead: %s',
                self::FALLBACK_LABEL,
                $exception->getMessage()
            ));

            return [];
        }
    }

    /**
     * @param  array<int|string, string|null>  $labels
     */
    public static function labelFor(array $labels, mixed $productId): string
    {
        if ($productId === null || $productId === '') {
            return self::FALLBACK_LABEL;
        }

        $label = trim((string) ($labels[$productId] ?? ''));

        return $label !== '' ? $label : self::FALLBACK_LABEL;
    }
}
