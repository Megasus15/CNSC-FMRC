<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Models\Concerns\SkipsMissingColumns;
use App\Models\Scopes\AccountSoftDeletingScope;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Unique;

#[Fillable(['name', 'email', 'password', 'username', 'role', 'signed_with_google', 'has_custom_password', 'phone_number', 'address_line', 'address_details', 'department', 'customer_type', 'gcash_phone', 'gcash_linked_at'])]
#[Hidden(['password', 'remember_token', 'active_email', 'active_username'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable, SkipsMissingColumns, SoftDeletes;

    public static function bootSoftDeletes(): void
    {
        static::addGlobalScope(new AccountSoftDeletingScope);
    }

    protected static function booted(): void
    {
        static::deleting(function (User $user): void {
            \App\Support\AdminAccounts::ensureInstalled();
            abort_if((bool) $user->getAttribute('is_builtin_admin'), 422, 'The built-in Admin account is protected and cannot be deleted.');
        });
        static::updating(function (User $user): void {
            if (! $user->getRawOriginal('is_builtin_admin')) return;
            abort_if(! $user->isBuiltInAdmin() || $user->trashed(), 422, 'The built-in Admin account must remain active and protected.');
        });
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'signed_with_google' => 'boolean',
            'has_custom_password' => 'boolean',
            'gcash_linked_at' => 'datetime',
            'is_spectator' => 'boolean',
            'is_builtin_admin' => 'boolean',
            'spectator_expires_at' => 'datetime',
        ];
    }

    public function isSpectator(): bool
    {
        return (bool) $this->getAttribute('is_spectator');
    }

    public function isBuiltInAdmin(): bool
    {
        return $this->role === 'admin' && ! $this->isSpectator() && (bool) $this->getAttribute('is_builtin_admin');
    }

    /** Match the database's active-account constraint, including during file-first deployment. */
    public static function uniqueActiveIdentity(string $column): Unique
    {
        $active = 'active_'.$column;
        $target = in_array($active, static::schemaColumns('users'), true) ? $active : $column;

        return Rule::unique('users', $target);
    }

    public function spectatorHasExpired(): bool
    {
        // A spectator without an expiry is disabled, never an unlimited admin.
        return $this->isSpectator()
            && (! $this->spectator_expires_at || $this->spectator_expires_at->isPast());
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'customer_id');
    }

    public function trackingEvents(): HasMany
    {
        return $this->hasMany(OrderTrackingEvent::class, 'created_by_user_id');
    }
}
