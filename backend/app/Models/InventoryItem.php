<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryItem extends Model
{
    protected $fillable = [
        'category',
        'item_name',
        'description',
        'unit',
        'last_invent',
        'on_hand',
        'status',
        'remarks',
        'variants',
        'created_by_user_id',
        'is_archived',
        'archived_at',
    ];

    protected $casts = [
        'last_invent' => 'integer',
        'on_hand'     => 'integer',
        'variants'    => 'array',
        'is_archived' => 'boolean',
        'archived_at' => 'datetime',
    ];

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
