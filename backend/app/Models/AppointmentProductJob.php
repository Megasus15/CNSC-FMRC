<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppointmentProductJob extends Model
{
    protected $guarded = ['id'];

    protected $attributes = ['revision' => 0, 'state' => 'draft'];

    protected $casts = ['requirements' => 'array', 'booking' => 'array', 'revision' => 'integer', 'discussed_at' => 'datetime'];

    public function appointment()
    {
        return $this->belongsTo(Appointment::class);
    }

    public function quotes()
    {
        return $this->hasMany(AppointmentProductQuote::class, 'job_id');
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'appointment_product_job_id');
    }
}
