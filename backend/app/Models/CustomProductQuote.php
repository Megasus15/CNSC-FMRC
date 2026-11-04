<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CustomProductQuote extends Model
{
    protected $guarded = [];
    protected $casts = ['snapshot' => 'array', 'sent_at' => 'datetime', 'expires_at' => 'datetime', 'accepted_at' => 'datetime'];
    public function request() { return $this->belongsTo(CustomProductRequest::class, 'custom_product_request_id'); }
    public function order() { return $this->hasOne(Order::class); }
}
