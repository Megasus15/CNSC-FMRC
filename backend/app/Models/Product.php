<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Product extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'category',
        'code',
        'stock',
        'price',
        'stock_status',
        'is_blocked',
        'image_data',
        'summary',
        'details_chips',
        'availability',
        'recommended_for',
        // Legacy fields kept for order compatibility
        'sku',
        'description',
        'image_url',
        'unit_price',
        'is_active',
    ];

    protected $casts = [
        'price'          => 'decimal:2',
        'unit_price'     => 'decimal:2',
        'stock'          => 'integer',
        'is_blocked'     => 'boolean',
        'is_active'      => 'boolean',
        'details_chips'  => 'array',
        'availability'   => 'array',
        'recommended_for'=> 'array',
        'media_managed' => 'boolean',
        'media_revision' => 'integer',
    ];

    public function orderItems(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function mediaItems(): HasMany
    {
        return $this->hasMany(ProductMediaAsset::class)->whereNotNull('published_at')->orderBy('position')->orderBy('id');
    }

    public function coverMedia(): BelongsTo
    {
        return $this->belongsTo(ProductMediaAsset::class, 'cover_media_id');
    }

    public function ratings(): HasMany
    {
        return $this->hasMany(ProductRating::class);
    }

    public function activeRatings(): HasMany
    {
        return $this->ratings()->where('is_archived', false);
    }
}
