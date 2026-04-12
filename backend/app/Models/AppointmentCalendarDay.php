<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AppointmentCalendarDay extends Model
{
    use HasFactory;

    protected $fillable = [
        'date',
        'is_blocked',
        'blocked_slots',
        'events',
        'custom_slots',
    ];

    protected $casts = [
        'date' => 'date:Y-m-d',
        'is_blocked' => 'boolean',
        'blocked_slots' => 'array',
        'events' => 'array',
        'custom_slots' => 'array',
    ];
}
