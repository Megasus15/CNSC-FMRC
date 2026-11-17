<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CustomerMessage extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'sender_name',
        'sender_email',
        'message',
        'is_read',
        'read_at',
        'status',
        'resolved_at',
        'resolved_by_user_id',
        'source',
        'request_key',
        'customer_last_read_entry_id',
        'team_last_read_entry_id',
        'last_entry_at',
        'closed_by_role',
        'customer_hidden_at',
    ];

    protected $casts = [
        'is_read' => 'boolean',
        'read_at' => 'datetime',
        'resolved_at' => 'datetime',
        'last_entry_at' => 'datetime',
        'customer_hidden_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by_user_id')->withTrashed();
    }
}
