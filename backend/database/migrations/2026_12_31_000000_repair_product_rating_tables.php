<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Repairs the product review (ratings) schema.
 *
 * The application layer (App\Models\ProductRating, App\Models\ProductRatingLike and
 * App\Http\Controllers\Api\ProductRatingController) supports:
 *   - one review per ORDER ITEM instead of one review per ORDER,
 *   - photo/video attachments (`media`),
 *   - anonymous reviews (`is_anonymous`),
 *   - customer likes (`likes_count` + the `product_rating_likes` table).
 *
 * The matching database changes were never shipped, which produced these runtime errors:
 *   - Unknown column 'media' in 'where clause'
 *   - Unknown column 'order_item_id' in 'order clause'
 *   - Base table or view not found: 'product_rating_likes'
 *
 * Every step below is idempotent, so this migration is safe on a fresh install and on
 * an existing database that already holds live review data.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->ensureRatingsTable();
        $this->dropLegacyPerOrderUniqueIndexes();
        $this->backfillOrderItemColumns();
        $this->ensurePerOrderItemUniqueIndex();
        $this->ensureOrderItemForeignKey();
        $this->ensureLikesTable();
        $this->syncLikeCounts();
    }

    public function down(): void
    {
        // Intentionally a no-op. Rolling back would destroy live customer reviews,
        // media references and likes, matching the non-destructive convention used
        // by the existing commerce upgrade migrations.
    }

    /** Create the table when missing, otherwise add only the columns that are absent. */
    private function ensureRatingsTable(): void
    {
        if (!Schema::hasTable('product_ratings')) {
            Schema::create('product_ratings', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('order_id')->nullable()->constrained('orders')->cascadeOnDelete();
                $table->unsignedBigInteger('order_item_id')->nullable();
                $table->unsignedBigInteger('product_id')->nullable();
                $table->string('product_name', 180)->nullable();
                $table->unsignedTinyInteger('stars')->default(5);
                $table->text('feedback')->nullable();
                $table->json('media')->nullable();
                $table->boolean('is_anonymous')->default(false);
                $table->unsignedInteger('likes_count')->default(0);
                $table->text('admin_reply')->nullable();
                $table->timestamp('replied_at')->nullable();
                $table->timestamps();

                $table->index(['product_id', 'created_at']);
                $table->index('order_item_id');
            });

            return;
        }

        Schema::table('product_ratings', function (Blueprint $table) {
            // `after()` requires the anchor column to exist, so fall back to appending
            // at the end of the table when a legacy install is missing it.
            $after = static function ($column, string $anchor) {
                return Schema::hasColumn('product_ratings', $anchor) ? $column->after($anchor) : $column;
            };

            if (!Schema::hasColumn('product_ratings', 'order_item_id')) {
                $after($table->unsignedBigInteger('order_item_id')->nullable(), 'order_id');
            }
            if (!Schema::hasColumn('product_ratings', 'product_id')) {
                $after($table->unsignedBigInteger('product_id')->nullable(), 'order_item_id');
            }
            if (!Schema::hasColumn('product_ratings', 'product_name')) {
                $after($table->string('product_name', 180)->nullable(), 'product_id');
            }
            if (!Schema::hasColumn('product_ratings', 'stars')) {
                $after($table->unsignedTinyInteger('stars')->default(5), 'product_name');
            }
            if (!Schema::hasColumn('product_ratings', 'feedback')) {
                $after($table->text('feedback')->nullable(), 'stars');
            }
            if (!Schema::hasColumn('product_ratings', 'media')) {
                $after($table->json('media')->nullable(), 'feedback');
            }
            if (!Schema::hasColumn('product_ratings', 'is_anonymous')) {
                $after($table->boolean('is_anonymous')->default(false), 'media');
            }
            if (!Schema::hasColumn('product_ratings', 'likes_count')) {
                $after($table->unsignedInteger('likes_count')->default(0), 'is_anonymous');
            }
            if (!Schema::hasColumn('product_ratings', 'admin_reply')) {
                $after($table->text('admin_reply')->nullable(), 'likes_count');
            }
            if (!Schema::hasColumn('product_ratings', 'replied_at')) {
                $after($table->timestamp('replied_at')->nullable(), 'admin_reply');
            }
        });
    }

    /**
     * The legacy schema allowed a single review per order (`user_id` + `order_id`).
     * Reviews are now stored per order item, so that unique index must go or the
     * second product of an order can never be reviewed.
     */
    private function dropLegacyPerOrderUniqueIndexes(): void
    {
        $driver = DB::getDriverName();

        // MySQL refuses to drop the last index backing a foreign key, so make sure
        // plain replacement indexes exist first.
        if ($driver === 'mysql') {
            $this->runQuietly('ALTER TABLE `product_ratings` ADD INDEX `product_ratings_order_id_idx` (`order_id`)');
            $this->runQuietly('ALTER TABLE `product_ratings` ADD INDEX `product_ratings_order_item_id_idx` (`order_item_id`)');
        }

        foreach ($this->legacyUniqueIndexNames() as $indexName) {
            try {
                Schema::table('product_ratings', function (Blueprint $table) use ($indexName): void {
                    $table->dropUnique($indexName);
                });
            } catch (\Throwable) {
                // The legacy constraint is already absent.
            }
        }
    }

    /** @return array<int, string> */
    private function legacyUniqueIndexNames(): array
    {
        $names = [];

        foreach ($this->ratingIndexes() as $index) {
            $indexName = (string) ($index['name'] ?? '');
            if ($indexName === '' || !(bool) ($index['unique'] ?? false)) {
                continue;
            }

            $columns = array_values($index['columns'] ?? []);

            // Keep the new per-order-item constraint.
            if (in_array('order_item_id', $columns, true)) {
                continue;
            }

            // Drop "one review per order" / "one review per customer" constraints.
            if (in_array('order_id', $columns, true) || $columns === ['user_id'] || $columns === ['product_id']) {
                $names[] = $indexName;
            }
        }

        return $names;
    }

    /** Give pre-existing rows an order item, product and product name so history stays visible. */
    private function backfillOrderItemColumns(): void
    {
        if (!Schema::hasTable('order_items') || !Schema::hasColumn('product_ratings', 'order_id')) {
            return;
        }

        DB::table('product_ratings')
            ->whereNull('order_item_id')
            ->whereNotNull('order_id')
            ->orderBy('id')
            ->chunkById(200, function ($ratings): void {
                foreach ($ratings as $rating) {
                    $orderItem = DB::table('order_items')
                        ->where('order_id', $rating->order_id)
                        ->orderBy('id')
                        ->first();

                    if (!$orderItem) {
                        continue;
                    }

                    $updates = ['order_item_id' => $orderItem->id];

                    if (empty($rating->product_id) && !empty($orderItem->product_id)) {
                        $updates['product_id'] = $orderItem->product_id;
                    }

                    if (empty($rating->product_name)) {
                        $updates['product_name'] = $orderItem->product_name ?: 'Custom Order';
                    }

                    DB::table('product_ratings')->where('id', $rating->id)->update($updates);
                }
            });
    }

    /**
     * One review per customer per order item. Skipped silently when historical
     * duplicates exist — the controller already de-duplicates via updateOrCreate().
     */
    private function ensurePerOrderItemUniqueIndex(): void
    {
        foreach ($this->ratingIndexes() as $index) {
            if (!(bool) ($index['unique'] ?? false)) {
                continue;
            }

            if (array_values($index['columns'] ?? []) === ['user_id', 'order_item_id']) {
                return;
            }
        }

        try {
            Schema::table('product_ratings', function (Blueprint $table): void {
                $table->unique(['user_id', 'order_item_id'], 'product_ratings_user_item_unique');
            });
        } catch (\Throwable) {
            // Historical duplicates can be repaired separately without losing reviews.
        }
    }

    private function ensureOrderItemForeignKey(): void
    {
        if (DB::getDriverName() !== 'mysql' || !Schema::hasTable('order_items')) {
            return;
        }

        // Orphaned references would block the constraint, so clear them first.
        $this->runQuietly(
            'UPDATE `product_ratings` pr
                LEFT JOIN `order_items` oi ON oi.`id` = pr.`order_item_id`
                SET pr.`order_item_id` = NULL
              WHERE pr.`order_item_id` IS NOT NULL AND oi.`id` IS NULL',
        );

        $this->runQuietly(
            'ALTER TABLE `product_ratings`
                ADD CONSTRAINT `product_ratings_order_item_id_foreign`
                FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE CASCADE',
        );
    }

    private function ensureLikesTable(): void
    {
        if (Schema::hasTable('product_rating_likes')) {
            return;
        }

        Schema::create('product_rating_likes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_rating_id')->constrained('product_ratings')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['product_rating_id', 'user_id'], 'product_rating_likes_unique');
        });
    }

    /** Keep the denormalised counter aligned with the like rows. */
    private function syncLikeCounts(): void
    {
        if (!Schema::hasTable('product_rating_likes') || !Schema::hasColumn('product_ratings', 'likes_count')) {
            return;
        }

        DB::table('product_ratings')->update(['likes_count' => 0]);

        $counts = DB::table('product_rating_likes')
            ->select('product_rating_id', DB::raw('COUNT(*) as aggregate'))
            ->groupBy('product_rating_id')
            ->pluck('aggregate', 'product_rating_id');

        foreach ($counts as $ratingId => $aggregate) {
            DB::table('product_ratings')
                ->where('id', $ratingId)
                ->update(['likes_count' => (int) $aggregate]);
        }
    }

    /** Run DDL that may already be satisfied without aborting the migration. */
    private function runQuietly(string $statement): void
    {
        try {
            DB::statement($statement);
        } catch (\Throwable $exception) {
            // The index/constraint already exists, or historical data prevents it.
        }
    }

    /** @return array<int, array<string, mixed>> */
    private function ratingIndexes(): array
    {
        try {
            return Schema::getIndexes('product_ratings');
        } catch (\Throwable) {
            return [];
        }
    }
};
