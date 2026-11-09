<?php

namespace App\Services;

use App\Mail\AppointmentCompleted;
use App\Models\Appointment;
use App\Support\OrderNotifier;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

final class AppointmentConsultations
{
    /** Caller holds the scheduling lock and appointment row lock. */
    public static function completeLocked(Appointment $appointment, bool $allowCompleted = false): bool
    {
        if ($allowCompleted && $appointment->status === 'Completed') return false;
        abort_if(in_array(strtolower($appointment->status), ['completed', 'cancelled', 'archived'], true), 422,
            'This consultation cannot be marked as done.');
        $appointment->status = 'Completed';
        $appointment->save();

        return true;
    }

    public static function notifyCompleted(Appointment $appointment): void
    {
        $email = trim((string) $appointment->email);
        if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) return;
        OrderNotifier::afterResponse(function () use ($email, $appointment) {
            try {
                Mail::to($email)->send(new AppointmentCompleted($appointment));
                Log::info('[APPT EMAIL] Sent AppointmentCompleted | Ref: '.$appointment->reference_no);
            } catch (\Throwable $e) {
                Log::error('[APPT EMAIL] Thank-you SMTP send FAILED | Ref: '.$appointment->reference_no.': '.$e->getMessage());
            }
        });
    }
}
