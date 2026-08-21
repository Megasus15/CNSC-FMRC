<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class OrderReturn extends Model
{
    /** Days after an order is completed that a return may still be filed. */
    public const WINDOW_DAYS = 7;

    /** Statuses that still need someone to act — only one may exist per order. */
    public const OPEN_STATUSES = [
        'requested',
        'approved',
        'item_in_transit',
        'item_received',
        'refund_processing',
    ];

    /** Statuses that close a return for good. */
    public const TERMINAL_STATUSES = ['refunded', 'rejected', 'cancelled'];

    /**
     * Statuses where the money is already committed back to the customer, so the
     * amount must be deducted from reported revenue. Shared by the dashboard
     * Total Revenue card and the Overall Sales report so the two cannot drift.
     */
    public const REVENUE_DEDUCTING_STATUSES = [
        'approved',
        'item_in_transit',
        'item_received',
        'refund_processing',
        'refunded',
    ];

    public const STATUSES = [
        'requested',
        'cancelled',
        'rejected',
        'approved',
        'item_in_transit',
        'item_received',
        'refund_processing',
        'refunded',
    ];

    public const STATUS_LABELS = [
        'requested'         => 'Return Requested',
        'cancelled'         => 'Request Cancelled',
        'rejected'          => 'Request Rejected',
        'approved'          => 'Return Approved',
        'item_in_transit'   => 'Item In Transit',
        'item_received'     => 'Item Received',
        'refund_processing' => 'Refund Processing',
        'refunded'          => 'Refunded',
    ];

    public const REASONS = [
        'damaged',
        'wrong_item',
        'incomplete',
        'not_as_described',
        'quality_issue',
        'other',
    ];

    public const REASON_LABELS = [
        'damaged'          => 'Item arrived damaged or defective',
        'wrong_item'       => 'Wrong item received',
        'incomplete'       => 'Missing items or parts',
        'not_as_described' => 'Does not match the description or specs',
        'quality_issue'    => 'Poor quality or workmanship',
        'other'            => 'Other reason',
    ];

    public const RESOLUTIONS = ['refund', 'replacement', 'repair'];

    public const RESOLUTION_LABELS = [
        'refund'      => 'Refund',
        'replacement' => 'Replacement',
        'repair'      => 'Repair / Rework',
    ];

    public const REFUND_METHODS = ['gcash', 'bank_transfer', 'cash', 'store_credit'];

    public const REFUND_METHOD_LABELS = [
        'gcash'         => 'GCash',
        'bank_transfer' => 'Bank Transfer',
        'cash'          => 'Cash on Pickup',
        'store_credit'  => 'Store Credit',
    ];

    protected $fillable = [
        'return_no',
        'order_id',
        'customer_id',
        'handled_by_user_id',
        'status',
        'reason',
        'reason_detail',
        'resolution',
        'customer_note',
        'media',
        'requested_amount',
        'approved_amount',
        'refunded_amount',
        'refund_method',
        'refund_reference',
        'decision_note',
        'return_courier_name',
        'return_tracking_no',
        'requested_at',
        'decided_at',
        'item_received_at',
        'refunded_at',
        'is_archived',
        'archived_at',
    ];

    protected $casts = [
        'order_id'           => 'integer',
        'customer_id'        => 'integer',
        'handled_by_user_id' => 'integer',
        'media'              => 'array',
        'requested_amount'   => 'decimal:2',
        'approved_amount'    => 'decimal:2',
        'refunded_amount'    => 'decimal:2',
        'requested_at'       => 'datetime',
        'decided_at'         => 'datetime',
        'item_received_at'   => 'datetime',
        'refunded_at'        => 'datetime',
        'is_archived'        => 'boolean',
        'archived_at'        => 'datetime',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function handler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by_user_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderReturnItem::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(OrderReturnEvent::class);
    }

    public function latestEvent(): HasOne
    {
        return $this->hasOne(OrderReturnEvent::class)->latestOfMany('occurred_at');
    }

    /** Returns still waiting on the customer, admin or staff. */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereIn('status', self::OPEN_STATUSES);
    }

    public function statusLabel(): string
    {
        return self::STATUS_LABELS[$this->status] ?? 'Return Update';
    }

    public function reasonLabel(): string
    {
        return self::REASON_LABELS[$this->reason] ?? 'Other reason';
    }

    public function resolutionLabel(): string
    {
        return self::RESOLUTION_LABELS[$this->resolution] ?? 'Refund';
    }

    public function refundMethodLabel(): ?string
    {
        return $this->refund_method
            ? (self::REFUND_METHOD_LABELS[$this->refund_method] ?? $this->refund_method)
            : null;
    }
}
