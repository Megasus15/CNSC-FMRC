<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\AppointmentCalendarDay;
use App\Models\AppointmentTimeSlot;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

final class AppointmentScheduling
{
    public const ZONE = 'Asia/Manila';

    public static function lock(): void
    {
        abort_unless(Schema::hasTable('appointment_schedule_locks'), 503, 'Appointment scheduling is temporarily unavailable. Please try again later.');
        $locked = DB::table('appointment_schedule_locks')->where('id', 1)->lockForUpdate()->first();
        abort_unless($locked, 503, 'Appointment scheduling is temporarily unavailable. Please try again later.');
    }

    public static function start(string $date, string $label, ?string $period = null): ?CarbonImmutable
    {
        // Support both established labels: "9:00 - 10:00 AM" and "9:00 AM - 10:00 AM".
        if (! preg_match('/^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[-–—]/i', $label, $match)) {
            return null;
        }
        $hour = (int) $match[1];
        $minute = (int) $match[2];
        if ($hour < 1 || $hour > 12 || $minute > 59) {
            return null;
        }
        $suffix = strtoupper($match[3] ?? '');
        if (! $suffix && preg_match('/(AM|PM)\s*$/i', $label, $last)) {
            $suffix = strtoupper($last[1]);
        }
        $suffix = $suffix ?: strtoupper($period ?? 'AM');
        $hour = $hour % 12 + ($suffix === 'PM' ? 12 : 0);
        try {
            return CarbonImmutable::createFromFormat('!Y-m-d H:i', sprintf('%s %02d:%02d', $date, $hour, $minute), self::ZONE);
        } catch (\Throwable) {
            return null;
        }
    }

    public static function canReschedule(Appointment $appointment): bool
    {
        if (! in_array(strtolower((string) $appointment->status), ['scheduled', 'pending'], true)) {
            return false;
        }
        $date = $appointment->appointment_date?->format('Y-m-d');
        $period = AppointmentTimeSlot::where('label', $appointment->appointment_time)->value('type');
        if (! $period && $date) {
            $custom = collect(AppointmentCalendarDay::whereDate('date', $date)->first()?->custom_slots ?? [])->first(fn ($slot) => is_array($slot) && ($slot['label'] ?? '') === $appointment->appointment_time);
            $period = $custom['type'] ?? null;
        }
        $storedStart = $appointment->getRawOriginal('appointment_starts_at');
        $start = $storedStart ? CarbonImmutable::parse($storedStart, 'UTC') : ($date ? self::start($date, $appointment->appointment_time, $period) : null);

        return $start && $start->gt(Carbon::now(self::ZONE));
    }

    public static function meetingData(Appointment $appointment, bool $operator = false): array
    {
        $online = $appointment->appointment_method === 'online';
        $upcoming = self::canReschedule($appointment);

        return [
            'appointment_method' => $appointment->appointment_method,
            'meeting_platform' => $appointment->meeting_platform,
            'meeting_url' => $appointment->meeting_url,
            'meeting_status' => $online ? ($appointment->meeting_url ? 'Meeting link available' : ($upcoming ? 'Meeting link pending' : 'No active meeting link')) : null,
            'schedule_version' => (int) $appointment->schedule_version,
            'can_edit_meeting_link' => $operator && $online && $upcoming,
            'can_remove_meeting_link' => $operator && $online && filled($appointment->meeting_url),
        ];
    }

    public static function range(string $date, string $label, ?string $period = null): ?array
    {
        $start = self::start($date, $label, $period);
        if (! $start || ! preg_match('/[-–—]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i', $label, $match)) {
            return null;
        }
        $hour = (int) $match[1];
        $minute = (int) $match[2];
        if ($hour < 1 || $hour > 12 || $minute > 59) {
            return null;
        }
        $suffix = strtoupper($match[3] ?? '');
        if (! $suffix) {
            $suffix = $hour === 12 && $start->hour >= 1 && $start->hour < 12 ? 'PM' : strtoupper($period ?? ($start->hour >= 12 ? 'PM' : 'AM'));
        }
        $end = $start->startOfDay()->setTime($hour % 12 + ($suffix === 'PM' ? 12 : 0), $minute);

        return $end->gt($start) ? [$start, $end] : null;
    }

    public static function available(string $date, string $time, ?int $except = null): CarbonImmutable
    {
        $day = CarbonImmutable::createFromFormat('!Y-m-d', $date, self::ZONE);
        if ($day->isWeekend()) {
            self::reject('Weekend booking is not available. Please select a weekday.');
        }
        $setting = AppointmentCalendarDay::whereDate('date', $date)->first();
        if ($setting?->is_blocked || in_array($time, $setting?->blocked_slots ?? [], true)) {
            self::reject('The selected schedule is blocked. Please choose another date or time.');
        }
        $slot = AppointmentTimeSlot::where('is_active', true)->where('label', $time)->first();
        $custom = collect($setting?->custom_slots ?? [])->first(fn ($value) => is_array($value) && ($value['label'] ?? '') === $time);
        if (! $slot && ! $custom) {
            self::reject('The selected time slot is no longer available.');
        }
        $range = self::range($date, $time, $slot?->type ?? ($custom['type'] ?? null));
        if (! $range || $range[0]->lte(Carbon::now(self::ZONE))) {
            self::reject('Choose an appointment that has not started. All schedules use Philippine time.');
        }
        foreach ($setting?->blocked_slots ?? [] as $blocked) {
            $blockedRange = self::range($date, $blocked);
            if ($blockedRange && $range[0]->lt($blockedRange[1]) && $range[1]->gt($blockedRange[0])) {
                self::reject('The selected time overlaps a blocked schedule. Please choose another time.');
            }
        }
        $appointments = Appointment::whereDate('appointment_date', $date)->whereNotIn('status', ['Cancelled', 'Archived'])->when($except, fn ($query) => $query->whereKeyNot($except))->get();
        foreach ($appointments as $appointment) {
            $occupied = self::range($date, $appointment->appointment_time);
            if ($appointment->appointment_time === $time || ($occupied && $range[0]->lt($occupied[1]) && $range[1]->gt($occupied[0]))) {
                self::reject('This date and time is already booked. Please choose another schedule.');
            }
        }

        return $range[0];
    }

    private static function reject(string $message): never
    {
        throw ValidationException::withMessages(['appointment_time' => $message]);
    }
}
