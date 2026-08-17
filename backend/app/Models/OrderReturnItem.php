<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderReturnItem extends Model
{
    protected $fillable = [
        'order_return_id',
        'order_item_id',
        'product_id',
        'product_name',
        'quantity',
        'unit_price',
        'line_total',
    ];

    protected $casts = [
        'order_return_id' => 'integer',
        'order_item_id'   => 'integer',
        'product_id'      => 'integer',
        'quantity'        => 'integer',
        'unit_price'      => 'decimal:2',
        'line_total'      => 'decimal:2',
    ];

    public function orderReturn(): BelongsTo
    {
        return $this->belongsTo(OrderReturn::class);
    }

    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
