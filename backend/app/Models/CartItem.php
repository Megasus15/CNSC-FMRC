<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CartItem extends Model
{
    protected $fillable = [
        'user_id',
        'title',
        'image',
        'unit_price',
        'quantity',
        'checked',
    ];

    protected $casts = [
        'unit_price' => 'decimal:2',
        'quantity' => 'integer',
        'checked' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
