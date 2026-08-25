<?php

namespace App\Models\Concerns;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Never let a write fail because the database is behind the code.
 *
 * Deploys here copy the PHP files up first and the migrations are run by hand
 * afterwards (see the Hostinger notes), so there is always a window where this
 * code knows about a column the live schema does not have yet. Inside that
 * window Eloquent happily builds
 *
 *     insert into `orders` (..., `payment_due_at`, `fulfillment_type`, ...)
 *
 * and MySQL answers "Unknown column 'payment_due_at' in 'INSERT INTO'", which
 * took down the entire checkout: a customer could not place any order at all,
 * not even a cash one that has nothing to do with the new columns.
 *
 * `existingColumns()` in OrderController already solved the read half of this
 * for select lists. This trait is the write half, and it lives on the model
 * rather than at each call site on purpose - there are a dozen places that
 * write these columns (checkout, payment submission, cancellation, staff
 * verification, tracking updates), and a guard that has to be remembered at
 * every one of them is a guard that will be missed.
 *
 * The trade-off is explicit: the one feature that needs the missing column
 * stops working until the migration runs, and says so loudly in the log, while
 * everything else keeps working. That is strictly better than a 500.
 *
 * Mass updates through the query builder (`Order::query()->update([...])`)
 * bypass model events and are therefore NOT covered - none of the new columns
 * are written that way today, and any future one should go through a model.
 */
trait SkipsMissingColumns
{
    /**
     * Column listings per table, cached for the request. Schema inspection is a
     * round trip to INFORMATION_SCHEMA, and checkout writes several models.
     *
     * @var array<string, array<int, string>>
     */
    protected static array $schemaColumnCache = [];

    /**
     * Columns already reported this request, so one missing migration does not
     * write the same warning once per saved row.
     *
     * @var array<string, true>
     */
    protected static array $reportedMissingColumns = [];

    public static function bootSkipsMissingColumns(): void
    {
        // `saving` fires after Eloquent has merged any cast objects back into
        // the raw attribute bag and before the INSERT/UPDATE is built, which is
        // the only point where the payload is both complete and still editable.
        static::saving(function ($model): void {
            $model->dropAttributesMissingFromSchema();
        });
    }

    /**
     * Strip any attribute whose column the table does not actually have.
     */
    public function dropAttributesMissingFromSchema(): void
    {
        $table = $this->getTable();
        $known = static::schemaColumns($table);

        // Inspection failed (no permission on INFORMATION_SCHEMA, driver
        // quirk, table genuinely gone): behave exactly as before rather than
        // silently dropping every attribute and writing an empty row.
        if ($known === []) {
            return;
        }

        $missing = array_values(array_diff(array_keys($this->getAttributes()), $known));

        if ($missing === []) {
            return;
        }

        foreach ($missing as $column) {
            // `original` has to go too: getDirty() diffs attributes against it,
            // so a leftover original for a dropped key would keep the column in
            // the UPDATE payload.
            unset($this->attributes[$column], $this->original[$column]);
        }

        $unreported = array_values(array_filter(
            $missing,
            fn (string $column) => ! isset(static::$reportedMissingColumns[$table.'.'.$column]),
        ));

        if ($unreported === []) {
            return;
        }

        foreach ($unreported as $column) {
            static::$reportedMissingColumns[$table.'.'.$column] = true;
        }

        Log::warning('[SCHEMA] Dropped columns missing from the database - run the pending migrations', [
            'table' => $table,
            'model' => static::class,
            'missing' => $unreported,
        ]);
    }

    /**
     * True when the live table really has every one of these columns. Call this
     * before promising a feature that cannot degrade - a cancellation cannot
     * half-happen, so it is better to refuse it with a clear message than to
     * write a cancelled order with no reason and no timestamps.
     *
     * @param  array<int, string>  $columns
     */
    public function hasSchemaColumns(array $columns): bool
    {
        $known = static::schemaColumns($this->getTable());

        if ($known === []) {
            return true;
        }

        return array_diff($columns, $known) === [];
    }

    /** @return array<int, string> */
    protected static function schemaColumns(string $table): array
    {
        if (! array_key_exists($table, static::$schemaColumnCache)) {
            try {
                static::$schemaColumnCache[$table] = Schema::getColumnListing($table);
            } catch (\Throwable $error) {
                Log::warning('[SCHEMA] Unable to inspect table columns', [
                    'table' => $table,
                    'message' => $error->getMessage(),
                ]);

                static::$schemaColumnCache[$table] = [];
            }
        }

        return static::$schemaColumnCache[$table];
    }

    /**
     * Drop the cache. Only needed by tests that migrate mid-run.
     */
    public static function forgetSchemaColumnCache(): void
    {
        static::$schemaColumnCache = [];
        static::$reportedMissingColumns = [];
    }
}
