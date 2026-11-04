<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomProductRequest extends Model
{
    protected $guarded = [];
    protected $casts = ['specifications' => 'array', 'service_snapshot' => 'array', 'revision' => 'integer', 'submitted_at' => 'datetime', 'is_archived' => 'boolean', 'archived_at' => 'datetime'];
    public function customer() { return $this->belongsTo(User::class, 'customer_id'); }
    public function quotes() { return $this->hasMany(CustomProductQuote::class); }
    public function reference(): string { return 'CUS-'.str_pad((string) $this->id, 6, '0', STR_PAD_LEFT); }
}
