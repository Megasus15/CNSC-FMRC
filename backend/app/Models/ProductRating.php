<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ProductRating extends Model
{
    protected $fillable = [
        'user_id',
        'order_id',
        'order_item_id',
        'product_id',
        'product_name',
        'stars',
        'feedback',
        'media',
        'is_anonymous',
        'likes_count',
        'admin_reply',
        'replied_at',
        'is_archived',
        'archived_at',
    ];

    protected $casts = [
        'stars'       => 'integer',
        'product_id'  => 'integer',
        'order_item_id' => 'integer',
        'media'       => 'array',
        'is_anonymous' => 'boolean',
        'likes_count' => 'integer',
        'replied_at'  => 'datetime',
        'is_archived' => 'boolean',
        'archived_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function likes(): HasMany
    {
        return $this->hasMany(ProductRatingLike::class);
    }

    /**
     * Reviews that actually carry a photo or a video.
     *
     * `media` is a JSON column, so a review without attachments is stored either as
     * NULL or as the `[]` array. MySQL can measure that directly with JSON_LENGTH;
     * other drivers (SQLite in tests) fall back to a plain string comparison.
     */
    public function scopeWithVisuals(Builder $query): Builder
    {
        if ($query->getConnection()->getDriverName() === 'mysql') {
            return $query->whereNotNull('media')
                ->whereRaw("JSON_LENGTH(COALESCE(`media`, '[]')) > 0");
        }

        return $query->whereNotNull('media')
            ->where('media', '!=', '[]')
            ->where('media', '!=', 'null')
            ->where('media', '!=', '');
    }
}
