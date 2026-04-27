<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalkInOrder extends Model
{
    protected $fillable = [
        'order_no',
        'order_item',
        'order_date',
        'customer',
        'payment_method',
        'total',
        'status',
        'created_by_user_id',
    ];

    protected $casts = [
        'order_date' => 'datetime',
        'total' => 'decimal:2',
    ];

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
