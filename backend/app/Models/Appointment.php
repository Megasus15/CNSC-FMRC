<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Appointment extends Model
{
    use HasFactory;

    protected $fillable = [
        'reference_no',
        'user_id',
        'first_name',
        'last_name',
        'middle_initial',
        'contact_number',
        'email',
        'country',
        'region',
        'province',
        'municipality',
        'barangay',
        'intl_address',
        'full_address',
        'client_type',
        'purpose',
        'additional_notes',
        'appointment_date',
        'appointment_time',
        'attachment_name',
        'attachment_path',
        'status',
        'qr_payload',
    ];

    protected $casts = [
        'appointment_date' => 'date:Y-m-d',
    ];
}
