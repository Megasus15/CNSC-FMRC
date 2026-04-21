<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
    ];

    public function orderItems(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }
}
