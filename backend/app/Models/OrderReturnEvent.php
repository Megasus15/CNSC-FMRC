<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderReturnEvent extends Model
{
    protected $fillable = [
        'order_return_id',
        'created_by_user_id',
        'status',
        'actor_role',
        'title',
        'description',
        'metadata',
        'occurred_at',
    ];

    protected $casts = [
        'order_return_id'    => 'integer',
        'created_by_user_id' => 'integer',
        'metadata'           => 'array',
        'occurred_at'        => 'datetime',
    ];

    public function orderReturn(): BelongsTo
    {
        return $this->belongsTo(OrderReturn::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
