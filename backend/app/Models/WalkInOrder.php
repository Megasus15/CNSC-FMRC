<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalkInOrder extends Model
{
    protected $fillable = [
        'order_no',
        'customer_name',
        'address',
        'contact_number',
        'client_type',
        'client_type_other',
        'agency_organization',
        'project_description',
        'project_description_other',
        'item_detail',
        'unit',
        'subtotal_cost',
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
        'subtotal_cost' => 'decimal:2',
        'total' => 'decimal:2',
    ];

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
