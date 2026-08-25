<?php

namespace App\Models;

use App\Models\Concerns\SkipsMissingColumns;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Order extends Model
{
    use HasFactory;
    use SkipsMissingColumns;

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
        'payment_due_at',
        'fulfillment_type',
        'delivery_recipient_name',
        'delivery_contact_no',
        'delivery_street',
        'delivery_barangay',
        'delivery_city',
        'delivery_province',
        'delivery_postal_code',
        'delivery_landmark',
        'delivery_lat',
        'delivery_lng',
        'pickup_code',
        'pickup_ready_at',
        'picked_up_at',
        'lifecycle_status',
        'customer_stage',
        'cancel_state',
        'cancel_reason',
        'cancel_reason_detail',
        'cancel_requested_at',
        'cancelled_at',
        'cancel_decided_at',
        'cancel_decided_by_user_id',
        'cancel_decision_note',
        'cancel_refund_due',
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

    /** A pickup order is collected at FMRC; a delivery order is shipped out. */
    public const FULFILLMENT_PICKUP = 'pickup';

    public const FULFILLMENT_DELIVERY = 'delivery';

    /**
     * GCash is collected before fulfilment, so a verified GCash payment is money
     * already sitting in the FMRC wallet. These are the lifecycle states where
     * that money is held but is not yet counted by the completed-order sum:
     *
     *  - `incoming` — paid, still waiting for staff to accept the order
     *  - `pending`  — accepted, in production or in transit
     *
     * `completed` is deliberately absent because the completed-order sum already
     * covers it, and `rejected` because that money is owed back to the customer
     * rather than earned. `cancelled` is absent for exactly the same reason: a
     * cancelled order's payment is a refund waiting to be sent, so the amount
     * has to leave Total Revenue the moment the cancellation is accepted.
     */
    public const GCASH_ADVANCE_LIFECYCLE_STATUSES = ['incoming', 'pending'];

    /**
     * Customer stages from which a customer may still call the order off.
     *
     * To Pay only. The cut-off is FMRC accepting the order: from `to_ship`
     * onwards a staff member has already pulled stock, started engraving or
     * printing, or packed the parcel, and a cancellation at that point is work
     * thrown away plus a review the staff have to sit down and decide. Shopee
     * and Lazada do allow a To Ship request, but they are cancelling a sealed
     * box a warehouse can put back on the shelf - FMRC is cancelling a keychain
     * with somebody's name already cut into it. So the button disappears once
     * the order is accepted, and from there the customer messages FMRC or files
     * a return after delivery.
     */
    public const CANCELLABLE_STAGES = ['to_pay'];

    /** Lifecycle states that are already finished, so nothing can be cancelled. */
    public const UNCANCELLABLE_LIFECYCLE_STATUSES = ['rejected', 'completed', 'cancelled'];

    /**
     * The reasons the cancel sheet offers, in the order it lists them.
     *
     * Taken from the marketplace sheets the customer will recognise, minus the
     * seller-side entries that make no sense here ("seller requesting
     * cancellation" is FMRC's own reject button, not a customer's reason).
     */
    public const CANCEL_REASONS = [
        'no_longer_needed',
        'ordered_by_mistake',
        'change_delivery_details',
        'change_payment_method',
        'change_item',
        'need_sooner',
        'high_delivery_cost',
        'found_better_price',
        'unresponsive',
        'other',
    ];

    public const CANCEL_REASON_LABELS = [
        'no_longer_needed'        => 'No longer needed',
        'ordered_by_mistake'      => 'I ordered this by mistake',
        'change_delivery_details' => 'Need to change my delivery address or contact details',
        'change_payment_method'   => 'Need to change my payment method',
        'change_item'             => 'Need to change the item, quantity or specifications',
        'need_sooner'             => 'I need the item sooner',
        'high_delivery_cost'      => 'Delivery cost is too high',
        'found_better_price'      => 'Found a better price elsewhere',
        'unresponsive'            => 'FMRC has not answered my questions',
        'other'                   => 'Other reason',
    ];

    public const CANCEL_STATE_LABELS = [
        'none'      => 'Not requested',
        'requested' => 'Cancellation Requested',
        'approved'  => 'Cancelled',
        'declined'  => 'Cancellation Declined',
    ];

    protected $casts = [
        'subtotal'    => 'decimal:2',
        'total'       => 'decimal:2',
        'delivery_lat' => 'decimal:7',
        'delivery_lng' => 'decimal:7',
        'last_known_lat' => 'decimal:7',
        'last_known_lng' => 'decimal:7',
        'pickup_ready_at' => 'datetime',
        'picked_up_at' => 'datetime',
        'payment_due_at' => 'datetime',
        'approved_at' => 'datetime',
        'rejected_at' => 'datetime',
        'completed_at' => 'datetime',
        'cancel_requested_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'cancel_decided_at' => 'datetime',
        'cancel_refund_due' => 'boolean',
        'is_archived' => 'boolean',
        'archived_at' => 'datetime',
    ];

    public function cancelReasonLabel(): ?string
    {
        return self::CANCEL_REASON_LABELS[$this->cancel_reason] ?? null;
    }

    /** True once the cancellation went through, however it was reached. */
    public function isCancelled(): bool
    {
        return $this->lifecycle_status === 'cancelled';
    }

    /** True while staff still owe the customer a decision on a cancellation. */
    public function hasPendingCancellation(): bool
    {
        return $this->cancel_state === 'requested' && ! $this->isCancelled();
    }

    /**
     * Whether this order may be cancelled at all, and if so whether the customer
     * gets to do it outright or only gets to ask.
     *
     * Only a To Pay order can be called off, and there the one thing that stops
     * an outright cancel is money FMRC has already confirmed: a refund has to be
     * sent back by hand from the centre's own GCash, so a human decides. An
     * unpaid order costs nobody anything and closes on the spot.
     *
     * @return array{allowed: bool, immediate: bool, reason: ?string}
     */
    public function cancellationAvailability(): array
    {
        $deny = fn (string $why) => ['allowed' => false, 'immediate' => false, 'reason' => $why];

        if ($this->isCancelled()) {
            return $deny('This order has already been cancelled.');
        }

        if ($this->cancel_state === 'requested') {
            return $deny('Your cancellation request is already being reviewed.');
        }

        if ($this->lifecycle_status === 'rejected') {
            return $deny('This order was not accepted, so there is nothing to cancel.');
        }

        if ($this->lifecycle_status === 'completed' || $this->customer_stage === 'completed') {
            return $deny('This order is already completed. Use Return / Refund instead.');
        }

        if (! in_array($this->customer_stage, self::CANCELLABLE_STAGES, true)) {
            // Name the actual situation. "Already on its way" on an order still
            // sitting on the workbench reads as a lie, and a pickup order is
            // never on its way at all.
            return $deny(match (true) {
                $this->customer_stage === 'to_ship' => 'FMRC has accepted this order and is already preparing it, so it can no longer be cancelled here. Message FMRC if something needs to change.',
                $this->isPickup() => 'This order is already waiting for you at FMRC, so it can no longer be cancelled here. Message FMRC if you can no longer collect it.',
                default => 'This order is already on its way, so it can no longer be cancelled. You can refuse the delivery or file a return once it arrives.',
            });
        }

        $paymentConfirmed = $this->payment?->status === 'paid';

        return [
            'allowed' => true,
            'immediate' => ! $paymentConfirmed,
            'reason' => null,
        ];
    }

    public function cancelDecidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancel_decided_by_user_id');
    }

    /** True when this order is collected at the centre instead of shipped. */
    public function isPickup(): bool
    {
        if ($this->fulfillment_type === null) {
            // Rows created before the column existed: Cash-on-Pickup is the only
            // legacy method that never shipped.
            return $this->payment_method === 'COP';
        }

        return $this->fulfillment_type === self::FULFILLMENT_PICKUP;
    }

    /**
     * The destination as one human-readable line, ordered the way Philippine
     * addresses are written. Used for the courier's label, the admin table and
     * the legacy `location_name` mirror.
     */
    public function deliveryAddressLine(): string
    {
        return collect([
            $this->delivery_street,
            $this->delivery_barangay ? 'Brgy. ' . $this->delivery_barangay : null,
            $this->delivery_city,
            $this->delivery_province,
            $this->delivery_postal_code,
        ])
            ->filter(fn ($part) => filled($part))
            ->implode(', ');
    }

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

    public function rating(): HasOne
    {
        return $this->hasOne(ProductRating::class)->where('is_archived', false);
    }

    public function ratings(): HasMany
    {
        return $this->hasMany(ProductRating::class)->where('is_archived', false);
    }

    public function returns(): HasMany
    {
        return $this->hasMany(OrderReturn::class);
    }

    /** The single return still awaiting action, if any. */
    public function activeReturn(): HasOne
    {
        return $this->hasOne(OrderReturn::class)
            ->whereIn('status', OrderReturn::OPEN_STATUSES)
            ->latestOfMany();
    }

    public function latestReturn(): HasOne
    {
        return $this->hasOne(OrderReturn::class)->latestOfMany();
    }

    /**
     * GCash orders whose payment staff have verified, but whose lifecycle has not
     * reached `completed` yet — money in hand, work still owed.
     *
     * Revenue is recognised from `payments.status = 'paid'`, i.e. the moment staff
     * matched the reference against the FMRC GCash account. It is never recognised
     * from `approved_at`: accepting an order says nothing about whether the
     * customer actually sent any money, and on a manual rail a customer can pick
     * GCash and never pay.
     *
     * Both the dashboard Total Revenue card and the sales report call this, so the
     * two cannot drift apart.
     */
    public function scopeGcashAdvanceRevenue(Builder $query): Builder
    {
        return $query
            ->where('payment_method', 'GCash')
            ->whereIn('lifecycle_status', self::GCASH_ADVANCE_LIFECYCLE_STATUSES)
            ->whereHas('payment', fn (Builder $payment) => $payment->where('status', 'paid'));
    }
}
