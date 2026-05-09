<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Order extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_no',
        'customer_id',
        'customer_name',
        'customer_contact',
        'quantity',
        'subtotal',
        'total',
        'payment_method',
        'payment_reference',
        'lifecycle_status',
        'customer_stage',
        'notes',
        'courier_name',
        'courier_tracking_no',
        'location_name',
        'last_known_lat',
        'last_known_lng',
        'approved_at',
        'rejected_at',
        'completed_at',
        'is_archived',
        'archived_at',
    ];

    protected $casts = [
        'subtotal'    => 'decimal:2',
        'total'       => 'decimal:2',
        'last_known_lat' => 'decimal:7',
        'last_known_lng' => 'decimal:7',
        'approved_at' => 'datetime',
        'rejected_at' => 'datetime',
        'completed_at' => 'datetime',
        'is_archived' => 'boolean',
        'archived_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function latestItem(): HasOne
    {
        return $this->hasOne(OrderItem::class)->latestOfMany();
    }

    public function payment(): HasOne
    {
        return $this->hasOne(Payment::class);
    }

    public function trackingEvents(): HasMany
    {
        return $this->hasMany(OrderTrackingEvent::class);
    }

    public function latestTrackingEvent(): HasOne
    {
        return $this->hasOne(OrderTrackingEvent::class)->latestOfMany('occurred_at');
    }
}
