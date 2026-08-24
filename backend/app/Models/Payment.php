<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'payment_no',
        'method',
        'reference',
        'amount',
        'status',
        'submitted_at',
        'proof_path',
        'paid_at',
        'refunded_at',
        'refund_reference',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'submitted_at' => 'datetime',
        'paid_at' => 'datetime',
        'refunded_at' => 'datetime',
    ];

    /**
     * Absolute URL of the receipt screenshot, or null when none was attached.
     *
     * Rebuilt from the stored path rather than saved as an absolute URL, so a proof
     * uploaded on one host does not hand the browser a dead link on another. It is
     * absolute rather than root-relative because the customer site is served from
     * its own origin: a root-relative `/storage/...` would resolve against the
     * static site and 404. This matches how return media is presented.
     */
    public function proofUrl(): ?string
    {
        return filled($this->proof_path)
            ? url('/storage/'.ltrim((string) $this->proof_path, '/'))
            : null;
    }

    /**
     * True once the customer has told us they sent the money.
     *
     * A claim, not a confirmation - `paid_at` is the confirmation, and only staff
     * can set it after matching the reference in the FMRC GCash account.
     *
     * `reference` is never empty (an unpaid order carries a "Awaiting GCash
     * reference" placeholder), so the digits are what distinguish a real claim.
     * Rows created before `submitted_at` existed are recognised the same way.
     */
    public function hasCustomerClaim(): bool
    {
        return $this->submitted_at !== null || ctype_digit((string) $this->reference);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
