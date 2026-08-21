<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\AppointmentConfirmation;
use App\Models\AdminNotification;
use App\Models\Appointment;
use App\Models\AppointmentCalendarDay;
use App\Models\AppointmentTimeSlot;
use App\Support\OrderNotifier;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

class AppointmentController extends Controller
{
    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    private array $defaultTimeSlots = [
        ['label' => '9:00 - 10:00 AM', 'type' => 'AM', 'sort_order' => 1],
        ['label' => '10:00 - 11:00 AM', 'type' => 'AM', 'sort_order' => 2],
        ['label' => '11:00 - 12:00', 'type' => 'AM', 'sort_order' => 3],
        ['label' => '1:00 - 2:00 PM', 'type' => 'PM', 'sort_order' => 4],
        ['label' => '2:00 - 3:00 PM', 'type' => 'PM', 'sort_order' => 5],
        ['label' => '3:00 - 4:00 PM', 'type' => 'PM', 'sort_order' => 6],
    ];

    public function index(): JsonResponse
    {
        $appointments = Appointment::query()
            ->whereNotIn('status', ['Cancelled', 'Archived'])
            ->orderBy('created_at', 'asc')
            ->get()
            ->map(fn (Appointment $appointment) => $this->transformAppointment($appointment));

        return response()->json(['data' => $appointments]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'last_name' => ['required', 'string', 'max:20', 'regex:/^[A-Za-z]+(?:\s[A-Za-z]+)*$/'],
            'first_name' => ['required', 'string', 'max:25', 'regex:/^[A-Za-z]+(?:\s[A-Za-z]+)*$/'],
            'middle_initial' => ['nullable', 'string', 'max:1', 'regex:/^[A-Za-z]$/'],
            'contact_number' => ['required', 'regex:/^\d{11}$/'],
            'email' => ['required', 'email:rfc', 'max:120', 'regex:/^[A-Za-z0-9._%+-]+@gmail\.com$/i'],
            'country' => 'required|string|max:120',
            'region' => 'nullable|string|max:120',
            'province' => 'nullable|string|max:120',
            'municipality' => 'nullable|string|max:120',
            'barangay' => 'nullable|string|max:120',
            'intl_address' => 'nullable|string|max:500',
            'full_address' => 'required|string|max:800',
            'client_type' => 'required|string|max:120',
            'purpose' => 'required|string|max:200',
            'additional_notes' => 'nullable|string|max:2000',
            'appointment_date' => 'required|date_format:Y-m-d',
            'appointment_time' => 'required|string|max:60',
            'attachment' => 'nullable|file|mimes:jpg,jpeg,png,webp,gif,pdf,doc,docx|max:51200',
        ]);

        $appointmentDate = Carbon::createFromFormat('Y-m-d', $validated['appointment_date']);
        $today = Carbon::today();

        if ($appointmentDate->isWeekend()) {
            return response()->json([
                'message' => 'Weekend booking is not available. Please select a weekday.',
            ], 422);
        }

        if ($appointmentDate->lt($today)) {
            return response()->json([
                'message' => 'Past dates are not allowed. Please select a valid future date.',
            ], 422);
        }

        $calendarDay = AppointmentCalendarDay::query()
            ->whereDate('date', $validated['appointment_date'])
            ->first();

        if ($calendarDay?->is_blocked) {
            return response()->json([
                'message' => 'This date is currently blocked by the administrator.',
            ], 422);
        }

        $blockedSlots = array_values(array_filter($calendarDay?->blocked_slots ?? [], 'is_string'));
        if (in_array($validated['appointment_time'], $blockedSlots, true)) {
            return response()->json([
                'message' => 'This selected time slot is blocked by the administrator.',
            ], 422);
        }

        $customSlots = collect($calendarDay?->custom_slots ?? [])
            ->map(fn ($slot) => is_array($slot) ? trim((string) ($slot['label'] ?? '')) : '')
            ->filter()
            ->values()
            ->all();

        $this->ensureDefaultSlots();

        $isGlobalSlot = AppointmentTimeSlot::query()
            ->where('is_active', true)
            ->where('label', $validated['appointment_time'])
            ->exists();

        $isCustomDaySlot = in_array($validated['appointment_time'], $customSlots, true);

        if (!$isGlobalSlot && !$isCustomDaySlot) {
            return response()->json([
                'message' => 'The selected time slot is no longer available.',
            ], 422);
        }

        $isAlreadyBooked = Appointment::query()
            ->whereDate('appointment_date', $validated['appointment_date'])
            ->where('appointment_time', $validated['appointment_time'])
            ->whereNotIn('status', ['Cancelled', 'Archived'])
            ->exists();

        if ($isAlreadyBooked) {
            return response()->json([
                'message' => 'This date and time is already booked. Please choose another schedule.',
            ], 422);
        }

        $storedPath = null;
        $storedName = null;

        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $storedPath = $file->store('appointment-attachments', 'public');
            $storedName = $file->getClientOriginalName();
        }

        $appointment = DB::transaction(function () use ($validated, $request, $storedPath, $storedName) {
            $appointment = Appointment::create([
                'reference_no' => null,
                'user_id' => $request->user()?->id,
                'first_name' => $validated['first_name'],
                'last_name' => $validated['last_name'],
                'middle_initial' => $validated['middle_initial'] ?? null,
                'contact_number' => $validated['contact_number'],
                'email' => $validated['email'],
                'country' => $validated['country'],
                'region' => $validated['region'] ?? null,
                'province' => $validated['province'] ?? null,
                'municipality' => $validated['municipality'] ?? null,
                'barangay' => $validated['barangay'] ?? null,
                'intl_address' => $validated['intl_address'] ?? null,
                'full_address' => $validated['full_address'],
                'client_type' => $validated['client_type'],
                'purpose' => $validated['purpose'],
                'additional_notes' => $validated['additional_notes'] ?? null,
                'appointment_date' => $validated['appointment_date'],
                'appointment_time' => $validated['appointment_time'],
                'attachment_name' => $storedName,
                'attachment_path' => $storedPath,
                'status' => 'Scheduled',
                'qr_payload' => null,
            ]);

            $appointment->reference_no = 'AP-' . str_pad((string) $appointment->id, 5, '0', STR_PAD_LEFT);
            $appointment->qr_payload = url('/appointments/verify/' . $appointment->reference_no);
            $appointment->save();

            return $appointment;
        });

        // --- Admin/Staff Notification: New Appointment ---
        try {
            $clientName = trim($validated['first_name'] . ' ' . $validated['last_name']);
            $apptDate   = $validated['appointment_date'];
            $apptTime   = $validated['appointment_time'];
            AdminNotification::create([
                'type'    => 'appointment',
                'title'   => "New Appointment: {$appointment->reference_no}",
                'message' => "{$clientName} scheduled an appointment on {$apptDate} at {$apptTime}. Purpose: {$validated['purpose']}",
                'is_read' => false,
                'metadata'=> [
                    'appointment_id' => $appointment->id,
                    'reference_no'   => $appointment->reference_no,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::warning('Could not create appointment admin notification: ' . $e->getMessage());
        }

        // --- Customer Email: Appointment Confirmation ---
        // Dispatched asynchronously after HTTP response so SMTP latency does not
        // block the HTTP 201 response from returning to the customer immediately.
        $emailAddress = $validated['email'] ?? null;
        if ($emailAddress && filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
            $appointmentForMail = $appointment;
            OrderNotifier::afterResponse(function () use ($emailAddress, $appointmentForMail) {
                try {
                    Mail::to($emailAddress)
                        ->send(new AppointmentConfirmation($appointmentForMail));

                    Log::info(
                        '[APPT EMAIL] Sent AppointmentConfirmation to '
                        . $emailAddress
                        . ' | Ref: ' . $appointmentForMail->reference_no
                    );
                } catch (\Throwable $e) {
                    Log::error(
                        '[APPT EMAIL] SMTP send FAILED for '
                        . $appointmentForMail->reference_no . ': ' . $e->getMessage()
                    );
                }
            });
        }

        // Return 201 immediately — email is processed in background.
        return response()->json([
            'message' => 'Appointment created successfully.',
            'data'    => $this->transformAppointment($appointment),
        ], 201);
    }

    public function destroy(Appointment $appointment): JsonResponse
    {
        if ($appointment->attachment_path) {
            Storage::disk('public')->delete($appointment->attachment_path);
        }

        $appointment->delete();

        return response()->json(['message' => 'Appointment deleted successfully.']);
    }

    public function archiveBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();

        $archivedIds = DB::transaction(function () use ($ids): array {
            $eligibleIds = Appointment::query()
                ->whereIn('id', $ids)
                ->where('status', 'Completed')
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($eligibleIds) {
                Appointment::query()->whereIn('id', $eligibleIds)->update([
                    'status' => 'Archived',
                    'updated_at' => now(),
                ]);
            }

            return $eligibleIds;
        });

        if (!$archivedIds) {
            return response()->json(['message' => 'No completed appointments were found to archive.'], 404);
        }

        return response()->json([
            'action' => 'archive',
            'scope' => 'appointments',
            'processed_ids' => $archivedIds,
            'processed_count' => count($archivedIds),
            'skipped_ids' => array_values(array_diff($ids, $archivedIds)),
            'message' => count($archivedIds) . ' appointment(s) archived successfully.',
        ]);
    }

    public function archive(Appointment $appointment): JsonResponse
    {
        if (strtolower((string) $appointment->status) !== 'completed') {
            return response()->json([
                'message' => 'Only appointments marked as completed can be archived.',
            ], 422);
        }

        $appointment->status = 'Archived';
        $appointment->save();

        return response()->json([
            'message' => 'Appointment archived successfully.',
            'data' => $this->transformAppointment($appointment),
        ]);
    }

    public function unarchive(Appointment $appointment): JsonResponse
    {
        $appointment->status = 'Pending';
        $appointment->save();

        return response()->json([
            'message' => 'Appointment restored successfully.',
            'data' => $this->transformAppointment($appointment),
        ]);
    }

    public function markCompleted(Request $request, Appointment $appointment): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $currentStatus = strtolower($appointment->status ?? '');
        if (in_array($currentStatus, ['completed', 'cancelled', 'archived'], true)) {
            return response()->json([
                'message' => 'This appointment cannot be marked as completed (current status: ' . $appointment->status . ').',
            ], 422);
        }

        $appointment->status = 'Completed';
        $appointment->save();

        return response()->json([
            'message' => 'Appointment marked as completed.',
            'data' => $this->transformAppointment($appointment),
        ]);
    }

    public function calendar(): JsonResponse
    {
        $this->ensureDefaultSlots();

        $slots = AppointmentTimeSlot::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'sort_order', 'is_active']);

        $days = AppointmentCalendarDay::query()
            ->orderBy('date')
            ->get()
            ->map(function (AppointmentCalendarDay $day) {
                return [
                    'id' => $day->id,
                    'date' => optional($day->date)->format('Y-m-d'),
                    'is_blocked' => (bool) $day->is_blocked,
                    'blocked_slots' => array_values(array_filter($day->blocked_slots ?? [], 'is_string')),
                    'events' => array_values(array_filter($day->events ?? [], 'is_string')),
                    'custom_slots' => collect($day->custom_slots ?? [])
                        ->map(function ($slot) {
                            if (!is_array($slot)) {
                                return null;
                            }

                            $label = trim((string) ($slot['label'] ?? ''));
                            if ($label === '') {
                                return null;
                            }

                            return [
                                'label' => $label,
                                'type' => strtoupper((string) ($slot['type'] ?? 'AM')) === 'PM' ? 'PM' : 'AM',
                            ];
                        })
                        ->filter()
                        ->values()
                        ->all(),
                ];
            });

        $bookedSlots = Appointment::query()
            ->whereNotIn('status', ['Cancelled', 'Archived'])
            ->select('appointment_date', 'appointment_time')
            ->get()
            ->groupBy(fn (Appointment $appointment) => optional($appointment->appointment_date)->format('Y-m-d'))
            ->map(function ($items) {
                return $items->pluck('appointment_time')->filter()->unique()->values()->all();
            });

        return response()->json([
            'today' => Carbon::today()->format('Y-m-d'),
            'time_slots' => $slots,
            'day_settings' => $days,
            'booked_slots' => $bookedSlots,
        ]);
    }

    public function updateCalendar(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'time_slots' => 'required|array|min:1',
            'time_slots.*.id' => 'nullable|integer',
            'time_slots.*.label' => 'required|string|max:60',
            'time_slots.*.type' => 'required|in:AM,PM',
            'time_slots.*.sort_order' => 'required|integer|min:1',
            'time_slots.*.is_active' => 'required|boolean',
            'day_settings' => 'nullable|array',
            'day_settings.*.date' => 'required|date_format:Y-m-d',
            'day_settings.*.is_blocked' => 'required|boolean',
            'day_settings.*.blocked_slots' => 'nullable|array',
            'day_settings.*.blocked_slots.*' => 'string|max:60',
            'day_settings.*.events' => 'nullable|array',
            'day_settings.*.events.*' => 'string|max:180',
            'day_settings.*.custom_slots' => 'nullable|array',
            'day_settings.*.custom_slots.*.label' => 'required|string|max:60',
            'day_settings.*.custom_slots.*.type' => 'required|in:AM,PM',
        ]);

        DB::transaction(function () use ($validated) {
            $incomingSlotIds = [];

            foreach ($validated['time_slots'] as $slotData) {
                $slot = AppointmentTimeSlot::query()->find($slotData['id'] ?? 0) ?? new AppointmentTimeSlot();
                $slot->label = $slotData['label'];
                $slot->type = $slotData['type'];
                $slot->sort_order = (int) $slotData['sort_order'];
                $slot->is_active = (bool) $slotData['is_active'];
                $slot->save();
                $incomingSlotIds[] = $slot->id;
            }

            AppointmentTimeSlot::query()
                ->whereNotIn('id', $incomingSlotIds)
                ->delete();

            $incomingDates = [];
            foreach ($validated['day_settings'] ?? [] as $dayData) {
                $day = AppointmentCalendarDay::query()->firstOrNew(['date' => $dayData['date']]);
                $day->is_blocked = (bool) $dayData['is_blocked'];
                $day->blocked_slots = array_values(array_filter($dayData['blocked_slots'] ?? [], 'is_string'));
                $day->events = array_values(array_filter($dayData['events'] ?? [], 'is_string'));
                $day->custom_slots = collect($dayData['custom_slots'] ?? [])
                    ->map(function ($slot) {
                        if (!is_array($slot)) {
                            return null;
                        }

                        $label = trim((string) ($slot['label'] ?? ''));
                        if ($label === '') {
                            return null;
                        }

                        return [
                            'label' => $label,
                            'type' => strtoupper((string) ($slot['type'] ?? 'AM')) === 'PM' ? 'PM' : 'AM',
                        ];
                    })
                    ->filter()
                    ->values()
                    ->all();
                $day->save();

                $incomingDates[] = $dayData['date'];
            }

            if ($incomingDates) {
                AppointmentCalendarDay::query()
                    ->whereNotIn('date', $incomingDates)
                    ->delete();
            } else {
                AppointmentCalendarDay::query()->delete();
            }
        });

        return response()->json(['message' => 'Calendar updated successfully.']);
    }

    public function verifyByReference(string $reference): JsonResponse
    {
        $appointment = Appointment::query()->where('reference_no', $reference)->first();

        if (!$appointment) {
            return response()->json(['message' => 'Appointment not found.'], 404);
        }

        return response()->json([
            'data' => $this->transformAppointment($appointment),
            'verified_at' => now()->toIso8601String(),
        ]);
    }

    public function verifyPage(string $reference)
    {
        $appointment = Appointment::query()->where('reference_no', $reference)->first();

        if (!$appointment) {
            return response('<h1>Appointment Not Found</h1><p>The reference number is invalid.</p>', 404)
                ->header('Content-Type', 'text/html');
        }

        $data = $this->transformAppointment($appointment);
        $verifiedAt = now()->format('F j, Y g:i A');

        $html = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>FMRC Official Appointment Receipt</title><style>*{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#f7f8fc,#eef1f6);font-family:Montserrat,Segoe UI,Tahoma,Arial,sans-serif;color:#1f2937;padding:24px}.receipt{max-width:980px;margin:0 auto;background:#fff;border-radius:18px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 24px 45px rgba(15,23,42,.12)}.header{background:#8b0000;color:#fff;padding:22px 24px;display:flex;justify-content:space-between;gap:16px;align-items:center}.kicker{display:block;font-size:11px;letter-spacing:.14em;opacity:.82}.ticket{margin-top:6px;font-size:30px;font-weight:800}.badge{background:#4caf50;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;letter-spacing:.04em}.body{display:flex;gap:0;align-items:stretch}.left{flex:1;padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.item{border:1px solid #eceef2;border-radius:10px;background:#fafafa;padding:10px 12px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700}.value{font-size:14px;font-weight:700;color:#202938;margin-top:6px;word-break:break-word}.highlight{color:#8b0000}.right{width:260px;border-left:1px dashed #d4d7de;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:22px 16px;background:#fcfcfc}.verify-chip{font-size:12px;color:#0f7b35;background:#e7f8ec;border:1px solid #9ad2a8;border-radius:999px;padding:7px 12px;font-weight:800;margin-bottom:12px}.qr-box{width:170px;height:170px;border:2px solid #d6dae3;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#fff;text-align:center;color:#8b0000;font-size:12px;font-weight:700;padding:10px}.verify-note{text-align:center;font-size:12px;color:#4b5563;line-height:1.5;margin-top:10px}.footer{background:#f8f9fc;border-top:1px dashed #d9dde5;padding:14px 18px;font-size:12px;color:#374151;line-height:1.65}.footer strong{color:#111827}@media (max-width:860px){body{padding:12px}.body{flex-direction:column}.right{width:100%;border-left:none;border-top:1px dashed #d4d7de}.left{grid-template-columns:1fr}}</style></head><body><div class="receipt"><div class="header"><div><span class="kicker">OFFICIAL RECEIPT VERIFICATION</span><div class="ticket">Ticket #' . e($data['reference_no']) . '</div></div><span class="badge">CONFIRMED</span></div><div class="body"><div class="left"><div class="item"><div class="label">Full Name</div><div class="value">' . e($data['client_name']) . '</div></div><div class="item"><div class="label">Purpose</div><div class="value">' . e($data['purpose']) . '</div></div><div class="item"><div class="label">Type of Client</div><div class="value">' . e($data['client_type']) . '</div></div><div class="item"><div class="label">Schedule</div><div class="value highlight">' . e($data['appointment_date']) . ' @ ' . e($data['appointment_time']) . '</div></div><div class="item"><div class="label">Contact Number</div><div class="value">' . e($data['contact_number']) . '</div></div><div class="item"><div class="label">Email Address</div><div class="value">' . e($data['email']) . '</div></div><div class="item"><div class="label">Address</div><div class="value">' . e($data['full_address']) . '</div></div><div class="item"><div class="label">Status</div><div class="value">' . e($data['status']) . '</div></div></div><div class="right"><span class="verify-chip">VALID APPOINTMENT RECEIPT</span><div class="qr-box">QR Verified</div><p class="verify-note">This receipt has been successfully verified by the FMRC system.</p><p class="verify-note">Verified at: ' . e($verifiedAt) . '</p></div></div><div class="footer"><strong>Important:</strong> Present this verified receipt or the original QR code at the FMRC office for appointment confirmation.</div></div></body></html>';

        return response($html)->header('Content-Type', 'text/html');
    }

    private function ensureDefaultSlots(): void
    {
        if (AppointmentTimeSlot::query()->exists()) {
            return;
        }

        foreach ($this->defaultTimeSlots as $slot) {
            AppointmentTimeSlot::query()->create($slot + ['is_active' => true]);
        }
    }

    private function transformAppointment(Appointment $appointment): array
    {
        $middleInitial = trim((string) ($appointment->middle_initial ?? ''));
        $middleInitial = $middleInitial ? rtrim($middleInitial, '.') . '.' : '';

        $clientNameParts = array_filter([
            trim((string) $appointment->first_name),
            $middleInitial,
            trim((string) $appointment->last_name),
        ]);

        $attachmentUrl = null;
        if ($appointment->attachment_path) {
            // Build the URL from the incoming request host (same helper used for
            // qr_payload) instead of config('app.url'). A stale production
            // APP_URL would otherwise hand the browser a localhost link and the
            // File Attach item would silently fail to open.
            $storagePath = ltrim($appointment->attachment_path, '/');
            $attachmentUrl = url('/storage/' . $storagePath);
        }


        return [
            'id' => $appointment->id,
            'reference_no' => $appointment->reference_no,
            'client_name' => implode(' ', $clientNameParts) ?: 'N/A',
            'first_name' => $appointment->first_name,
            'last_name' => $appointment->last_name,
            'middle_initial' => $appointment->middle_initial,
            'contact_number' => $appointment->contact_number,
            'email' => $appointment->email,
            'country' => $appointment->country,
            'region' => $appointment->region,
            'province' => $appointment->province,
            'municipality' => $appointment->municipality,
            'barangay' => $appointment->barangay,
            'intl_address' => $appointment->intl_address,
            'full_address' => $appointment->full_address,
            'client_type' => $appointment->client_type,
            'purpose' => $appointment->purpose,
            'additional_notes' => $appointment->additional_notes,
            'appointment_date' => optional($appointment->appointment_date)->format('Y-m-d'),
            'appointment_time' => $appointment->appointment_time,
            'attachment_name' => $appointment->attachment_name,
            'attachment_url' => $attachmentUrl,
            'status' => $appointment->status,
            'qr_payload' => $appointment->qr_payload,
            'created_at' => optional($appointment->created_at)->toIso8601String(),
        ];
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }

}
