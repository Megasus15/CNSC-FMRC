<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Schema;

/**
 * One staff-account application submitted from the Admin/Staff sign-in page.
 *
 * The applicant chooses their own username and password; an administrator then
 * approves the row (which creates the real `users` record) or rejects it. Both
 * outcomes email the applicant.
 *
 * Reads fail SOFT, exactly like MaintenanceSetting. A Hostinger deploy copies
 * files without running migrations, so there is always a window where this class
 * exists and its table does not -- in that window the queue has to report itself
 * as "not installed" rather than throw a 500 across the Accounts page.
 *
 * `password_hash` is in $hidden and is nulled the moment a decision is made, so
 * neither an API response nor a stale queue ever carries a usable credential.
 */
class StaffAccountRequest extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    /** Every value `status` is allowed to hold, in the order the filter lists them. */
    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_APPROVED,
        self::STATUS_REJECTED,
    ];

    protected $fillable = [
        'name',
        'username',
        'email',
        'password_hash',
        'status',
        'decision_note',
        'reviewed_by',
        'reviewed_at',
        'created_user_id',
        'request_ip',
    ];

    /** Never serialise the applicant's password hash into an API response. */
    protected $hidden = [
        'password_hash',
    ];

    protected $casts = [
        'reviewed_at' => 'datetime',
    ];

    /** Memoised per request: Schema::hasTable() is a real query. */
    private static ?bool $tableReady = null;

    /**
     * Has the table been installed on this server yet?
     *
     * The admin queue surfaces this so an empty list can be told apart from a
     * missing table, which are otherwise identical on screen.
     */
    public static function tableReady(): bool
    {
        if (self::$tableReady === null) {
            try {
                self::$tableReady = Schema::hasTable('staff_account_requests');
            } catch (\Throwable $e) {
                self::$tableReady = false;
            }
        }

        return self::$tableReady;
    }

    /** Test-only escape hatch: forget the memoised probe. */
    public static function forgetTableReady(): void
    {
        self::$tableReady = null;
    }

    public static function isKnownStatus(string $status): bool
    {
        return in_array($status, self::STATUSES, true);
    }

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    /** The administrator who approved or rejected this request. */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /** The staff account an approval created. */
    public function createdUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_user_id');
    }

    /** Applicant's display name, never blank. */
    public function displayName(): string
    {
        $name = trim((string) $this->name);

        return $name !== '' ? $name : 'Applicant';
    }

    /** First name only, for the greeting line of the decision emails. */
    public function firstName(): string
    {
        $parts = preg_split('/\s+/', $this->displayName()) ?: [];

        return (string) ($parts[0] ?? $this->displayName());
    }

    /**
     * The shape the Accounts page table renders. Deliberately excludes
     * `password_hash` and every internal id the UI has no use for.
     */
    public function toQueueArray(): array
    {
        return [
            'id' => $this->id,
            'name' => (string) $this->name,
            'username' => (string) $this->username,
            'email' => (string) $this->email,
            'status' => (string) $this->status,
            'decision_note' => $this->decision_note ? (string) $this->decision_note : null,
            'reviewed_by_name' => $this->relationLoaded('reviewer') && $this->reviewer
                ? (string) $this->reviewer->name
                : null,
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
