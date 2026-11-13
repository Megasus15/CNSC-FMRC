<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderCancellationArchive extends Model
{
    protected $guarded = [];

    protected $casts = ['snapshot' => 'array', 'archived_at' => 'datetime', 'restored_at' => 'datetime'];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function archiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'archived_by')->withTrashed();
    }
}
