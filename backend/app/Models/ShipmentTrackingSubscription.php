<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShipmentTrackingSubscription extends Model
{
    protected $guarded = ['id'];

    protected $casts = [
        'registration_payload' => 'array', 'latest_result' => 'array', 'diagnostic' => 'boolean', 'stop_pending' => 'boolean',
        'registration_requested_at' => 'datetime', 'registered_at' => 'datetime', 'last_checked_at' => 'datetime',
        'last_webhook_at' => 'datetime', 'last_event_at' => 'datetime', 'next_attempt_at' => 'datetime', 'attempts' => 'integer',
    ];

    public function tracker(): BelongsTo
    {
        return $this->belongsTo(ShipmentTracker::class, 'tracker_id');
    }
}
