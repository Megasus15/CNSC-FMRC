<?php

use App\Models\OrderItem;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_ratings', function (Blueprint $table) {
            if (!Schema::hasColumn('product_ratings', 'order_item_id')) {
                $table->foreignId('order_item_id')
                    ->nullable()
                    ->after('order_id')
                    ->constrained('order_items')
                    ->cascadeOnDelete();
            }

            if (!Schema::hasColumn('product_ratings', 'media')) {
                $table->json('media')->nullable()->after('feedback');
            }

            if (!Schema::hasColumn('product_ratings', 'is_anonymous')) {
                $table->boolean('is_anonymous')->default(false)->after('media');
            }

            if (!Schema::hasColumn('product_ratings', 'likes_count')) {
                $table->unsignedInteger('likes_count')->default(0)->after('is_anonymous');
            }
        });

        // Existing ratings were saved against the first product in an order.
        // Preserve them as an item review before replacing the old order-level
        // uniqueness rule with one review per customer and order item.
        DB::table('product_ratings')
            ->whereNull('order_item_id')
            ->orderBy('id')
            ->get(['id', 'order_id'])
            ->each(function (object $rating): void {
                $itemId = OrderItem::query()
                    ->where('order_id', $rating->order_id)
                    ->orderBy('id')
                    ->value('id');

                if ($itemId) {
                    DB::table('product_ratings')
                        ->where('id', $rating->id)
                        ->update(['order_item_id' => $itemId]);
                }
            });

        $this->dropLegacyPerOrderUniqueIndexes();
        $this->ensurePerOrderItemUniqueIndex();

        try {
            Schema::table('product_ratings', function (Blueprint $table) {
                $table->index(['product_id', 'stars'], 'product_ratings_product_stars_index');
            });
        } catch (\Throwable) { /* already exists */ }

        Schema::table('product_ratings', function (Blueprint $table) {
            if (Schema::hasColumn('product_ratings', 'feedback')) {
                $table->text('feedback')->nullable()->change();
            }
        });
    }

    public function down(): void
    {
        // Review media and item-level submissions are part of the live review
        // history. Keep the migration non-destructive on rollback.
    }

    /** Remove the old one-review-per-order rule on every supported database. */
    private function dropLegacyPerOrderUniqueIndexes(): void
    {
        $driver = DB::getDriverName();

        // MySQL foreign keys require an ordinary index to remain on order_id.
        if ($driver === 'mysql') {
            try {
                Schema::table('product_ratings', function (Blueprint $table): void {
                    $table->index('order_id', 'product_ratings_order_id_idx');
                });
            } catch (\Throwable) {
                // The replacement index already exists.
            }
        }

        foreach ($this->indexes() as $index) {
            $columns = array_values($index['columns'] ?? []);
            $isUnique = (bool) ($index['unique'] ?? false);

            if (!$isUnique || in_array('order_item_id', $columns, true)) {
                continue;
            }

            if (!in_array('order_id', $columns, true)) {
                continue;
            }

            $name = (string) ($index['name'] ?? '');
            if ($name === '') {
                continue;
            }

            try {
                Schema::table('product_ratings', function (Blueprint $table) use ($name): void {
                    $table->dropUnique($name);
                });
            } catch (\Throwable) {
                // The legacy index was already removed by an earlier deployment.
            }
        }
    }

    /** Enforce one review per customer and order item without duplicating an index. */
    private function ensurePerOrderItemUniqueIndex(): void
    {
        foreach ($this->indexes() as $index) {
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

    /** @return array<int, array<string, mixed>> */
    private function indexes(): array
    {
        try {
            return Schema::getIndexes('product_ratings');
        } catch (\Throwable) {
            return [];
        }
    }
};
