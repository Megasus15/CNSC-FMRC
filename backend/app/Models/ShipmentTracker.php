<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShipmentTracker extends Model
{
    protected $guarded = ['id'];

    protected $casts = [
        'registration_payload' => 'array', 'last_event_time' => 'array',
        'demo' => 'boolean', 'needs_review' => 'boolean', 'unsubscribe_pending' => 'boolean',
        'actual_shipping_cost' => 'decimal:2', 'version' => 'integer', 'attempts' => 'integer',
        'handed_over_at' => 'datetime', 'registered_at' => 'datetime', 'last_event_at' => 'datetime',
        'registration_requested_at' => 'datetime',
        'last_checked_at' => 'datetime', 'next_attempt_at' => 'datetime', 'last_refresh_requested_at' => 'datetime',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
