<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CourierShipment extends Model
{
    protected $guarded = [];

    protected $hidden = ['booking_payload'];

    protected $casts = ['parcel' => 'array', 'booking_payload' => 'array', 'actual_booking_cost' => 'decimal:2', 'booked_at' => 'datetime', 'last_event_at' => 'datetime'];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
