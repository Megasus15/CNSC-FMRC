<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppointmentProductQuote extends Model
{
    protected $guarded = ['id'];

    protected $casts = ['agreement' => 'array', 'version' => 'integer', 'total_centavos' => 'integer', 'sent_at' => 'datetime', 'expires_at' => 'datetime', 'accepted_at' => 'datetime'];

    public function job()
    {
        return $this->belongsTo(AppointmentProductJob::class, 'job_id');
    }

    public function order()
    {
        return $this->hasOne(Order::class, 'appointment_product_quote_id');
    }
}
