<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class InventoryTransaction extends Model
{
    use HasFactory;

    protected $table = 'inventory_transactions';

    protected $fillable = [
        'inventory_item_id',
        'variant_id',
        'type',
        'amount',
        'name',
        'purpose',
        'remarks',
        'created_by_user_id',
    ];
}
