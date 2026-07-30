<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductRating extends Model
{
    protected $fillable = [
        'user_id',
        'order_id',
        'product_id',
        'product_name',
        'stars',
        'feedback',
        'admin_reply',
        'replied_at',
    ];

    protected $casts = [
        'stars'       => 'integer',
        'product_id'  => 'integer',
        'replied_at'  => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}
