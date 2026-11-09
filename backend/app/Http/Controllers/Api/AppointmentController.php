<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\AppointmentConfirmation;
use App\Models\AdminNotification;
use App\Models\Appointment;
use App\Models\AppointmentCalendarDay;
use App\Models\AppointmentTimeSlot;
use App\Services\AppointmentFiles;
use App\Services\AppointmentConsultations;
use App\Services\AppointmentScheduling;
use App\Services\AppointmentProducts;
use App\Support\OrderNotifier;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

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

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }
        $hasJobs = Schema::hasTable('appointment_product_jobs');
        $hasJobColumn = Schema::hasColumn('appointments', 'product_job_id');
        $appointments = Appointment::query()
            ->where('status', '!=', 'Archived')
            ->where(function ($query) use ($hasJobs, $hasJobColumn) {
                $query->whereNotIn('status', ['Cancelled', 'Archived']);
                if ($hasJobColumn) $query->orWhereNotNull('product_job_id');
                if ($hasJobs) $query->orWhereExists(fn ($jobs) => $jobs->selectRaw('1')->from('appointment_product_jobs')->whereColumn('appointment_product_jobs.appointment_id', 'appointments.id'));
            })
            ->orderBy('created_at', 'asc')
            ->get()
            ->map(fn (Appointment $appointment) => $this->transformAppointment($appointment));

        return response()->json(['data' => $appointments])->header('Cache-Control', 'private, no-store');
    }

    public function teamShow(Request $request, Appointment $appointment): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) return $denied;

        return response()->json(['data' => $this->transformAppointment($appointment)])->header('Cache-Control', 'private, no-store');
    }

    public function store(Request $request): JsonResponse
    {
        $custom=$request->boolean('product_requested');
        if ($custom) {
            AppointmentProducts::requireIntake();
            abort_unless($request->user('sanctum')?->role === 'customer',401,'Sign in to request a custom product. Your appointment details can be kept while you sign in.');
            if (is_string($request->input('product_data'))) $request->merge(['product_data'=>json_decode($request->input('product_data'),true)]);
            $request->validate(['product_data'=>'required|array','request_key'=>'required|string|max:80|regex:/^[A-Za-z0-9-]+$/',
                'product_draft_id'=>'nullable|integer','product_revision'=>'required_with:product_draft_id|integer|min:0']);
            $input = $request->input('product_data');
            $brief = AppointmentProducts::brief($input);
            $prior=\App\Models\AppointmentProductJob::where('customer_id',$request->user('sanctum')->id)->where('request_key',$request->input('request_key'))->first();
            if ($prior?->appointment_id) return response()->json(['message'=>'Appointment already booked.','data'=>$this->transformAppointment($prior->appointment)],201);
            $service = AppointmentProducts::eligible((int) $brief['service_id']);
            $request->validate(['additional_notes' => 'nullable|string|max:2000']);
            $notes = AppointmentProducts::customerNotes($input, $request->input('additional_notes'));
            $request->merge(['purpose' => $service->title, 'additional_notes' => $notes,
                'product_data' => array_replace($brief, ['instructions' => $notes, 'customer_notes_version' => 1])]);
        }
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
            'attachment' => 'nullable|file|max:51200',
            'attachments' => 'nullable|array|max:5',
            'attachments.*' => 'required|file|max:51200',
            'appointment_method' => 'sometimes|required|in:online,face_to_face',
        ]);

        $files = AppointmentFiles::validate($request);
        $this->ensureDefaultSlots();
        $stored = AppointmentFiles::store($files);
        try {
            $replayed=false;
            $appointment = DB::transaction(function () use ($validated, $request, $stored, $custom, &$replayed) {
                AppointmentScheduling::lock();
                if ($custom) {
                    $prior=\App\Models\AppointmentProductJob::where('customer_id',$request->user('sanctum')->id)->where('request_key',$request->input('request_key'))->lockForUpdate()->first();
                    if ($prior?->appointment_id) { $replayed=true; return $prior->appointment; }
                }
                $starts = AppointmentScheduling::available($validated['appointment_date'], $validated['appointment_time']);
                $appointment = Appointment::create([
                    'reference_no' => null,
                    // This public route accepts guest bookings and optional Customer bearer authentication.
                    'user_id' => $request->user('sanctum')?->id,
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
                    'attachment_name' => null,
                    'attachment_path' => null,
                    'appointment_method' => $validated['appointment_method'] ?? 'face_to_face',
                    'appointment_starts_at' => $starts->utc(),
                    'status' => 'Scheduled',
                    'qr_payload' => null,
                ]);

                $appointment->reference_no = 'AP-'.str_pad((string) $appointment->id, 5, '0', STR_PAD_LEFT);
                $appointment->qr_payload = url('/appointments/verify/'.$appointment->reference_no);
                $appointment->save();

                foreach ($stored as $file) {
                    DB::table('appointment_attachments')->insert($file + ['appointment_id' => $appointment->id]);
                }

                if ($custom) AppointmentProducts::booked($appointment,$request->input('product_data'),$request->user('sanctum')->id,
                    $request->input('request_key'),$request->integer('product_draft_id')?:null,$request->input('product_revision'),$stored);

                return $appointment;
            });
        } catch (\Throwable $error) {
            AppointmentFiles::clean($stored);
            throw $error;
        }
        if ($replayed) { AppointmentFiles::clean($stored); return response()->json(['message'=>'Appointment already booked.','data'=>$this->transformAppointment($appointment)],201); }

        // --- Admin/Staff Notification: New Appointment ---
        try {
            $clientName = trim($validated['first_name'].' '.$validated['last_name']);
            $apptDate = $validated['appointment_date'];
            $apptTime = $validated['appointment_time'];
            AdminNotification::create([
                'type' => 'appointment',
                'title' => "New Appointment: {$appointment->reference_no}",
                'message' => "{$clientName} scheduled an appointment on {$apptDate} at {$apptTime}. Purpose: {$validated['purpose']}",
                'is_read' => false,
                'metadata' => [
                    'appointment_id' => $appointment->id,
                    'reference_no' => $appointment->reference_no,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::warning('Could not create appointment admin notification: '.$e->getMessage());
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
                        .$emailAddress
                        .' | Ref: '.$appointmentForMail->reference_no
                    );
                } catch (\Throwable $e) {
                    Log::error(
                        '[APPT EMAIL] SMTP send FAILED for '
                        .$appointmentForMail->reference_no.': '.$e->getMessage()
                    );
                }
            });
        }

        // Return 201 immediately — email is processed in background.
        return response()->json([
            'message' => 'Appointment created successfully.',
            'data' => $this->transformAppointment($appointment),
        ], 201);
    }

    public function destroy(Request $request, Appointment $appointment): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }
        AppointmentProducts::protectAppointment($appointment);
        if ($appointment->attachment_path) {
            Storage::disk('public')->delete($appointment->attachment_path);
        }

        AppointmentFiles::clean(DB::table('appointment_attachments')->where('appointment_id', $appointment->id)->get()->map(fn ($file) => (array) $file)->all());
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
            AppointmentScheduling::lock();
            $eligible = Appointment::query()
                ->whereIn('id', $ids)
                ->where('status', 'Completed')
                ->lockForUpdate()->get();
            foreach ($eligible as $item) AppointmentProducts::protectAppointment($item, true);
            $eligibleIds = $eligible->pluck('id')
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

        if (! $archivedIds) {
            return response()->json(['message' => 'No completed appointments were found to archive.'], 404);
        }

        return response()->json([
            'action' => 'archive',
            'scope' => 'appointments',
            'processed_ids' => $archivedIds,
            'processed_count' => count($archivedIds),
            'skipped_ids' => array_values(array_diff($ids, $archivedIds)),
            'message' => count($archivedIds).' appointment(s) archived successfully.',
        ]);
    }

    public function archive(Request $request, Appointment $appointment): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }
        $appointment = DB::transaction(function () use ($appointment) {
            AppointmentScheduling::lock();
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            // Repeated submissions are harmless; never act on a related consultation.
            if ($current->status === 'Archived') return $current;
            abort_unless(strtolower((string) $current->status) === 'completed', 422, 'Only appointments marked as completed can be archived.');
            AppointmentProducts::protectAppointment($current, true);
            $current->status = 'Archived';
            $current->save();
            return $current;
        });

        return response()->json([
            'message' => 'Appointment archived successfully.',
            'data' => $this->transformAppointment($appointment),
        ]);
    }

    public function unarchive(Request $request, Appointment $appointment): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }
        $appointment->status = AppointmentProducts::jobFor($appointment) ? 'Completed' : 'Pending';
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

        $appointment = DB::transaction(function () use ($appointment) {
            AppointmentScheduling::lock();
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            AppointmentConsultations::completeLocked($current);
            return $current;
        });

        AppointmentConsultations::notifyCompleted($appointment);

        return response()->json([
            'message' => 'Appointment marked as completed.',
            'data' => $this->transformAppointment($appointment),
        ]);
    }

    public function calendar(Request $request): JsonResponse
    {
        if (! $request->attributes->get('spectator_mode', false)) {
            $this->ensureDefaultSlots();
        }

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
                            if (! is_array($slot)) {
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
            'today' => Carbon::today(AppointmentScheduling::ZONE)->format('Y-m-d'),
            'timezone' => AppointmentScheduling::ZONE,
            'time_slots' => $slots,
            'day_settings' => $days,
            'booked_slots' => $bookedSlots,
        ]);
    }

    public function updateCalendar(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }
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

        foreach ($validated['time_slots'] as $slot) {
            if (! AppointmentScheduling::range('2026-01-05', $slot['label'], $slot['type'])) {
                throw ValidationException::withMessages(['time_slots' => 'Use a valid start and end time, for example 9:00 - 10:00 AM.']);
            }
        }
        foreach ($validated['day_settings'] ?? [] as $day) {
            foreach ($day['custom_slots'] ?? [] as $slot) {
                if (! AppointmentScheduling::range($day['date'], $slot['label'], $slot['type'])) {
                    throw ValidationException::withMessages(['day_settings' => 'Each custom slot needs a valid start and end time.']);
                }
            }
        }
        DB::transaction(function () use ($validated) {
            AppointmentScheduling::lock();
            $incomingSlotIds = [];

            foreach ($validated['time_slots'] as $slotData) {
                $slot = AppointmentTimeSlot::query()->find($slotData['id'] ?? 0) ?? new AppointmentTimeSlot;
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
                        if (! is_array($slot)) {
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

        if (! $appointment) {
            return response()->json(['message' => 'Appointment not found.'], 404);
        }

        return response()->json([
            'data' => $this->transformAppointment($appointment, false),
            'verified_at' => now()->toIso8601String(),
        ]);
    }

    public function verifyPage(string $reference)
    {
        $appointment = Appointment::query()->where('reference_no', $reference)->first();

        if (! $appointment) {
            return response('<h1>Appointment Not Found</h1><p>The reference number is invalid.</p>', 404)
                ->header('Content-Type', 'text/html');
        }

        $data = $this->transformAppointment($appointment, false);
        $verifiedAt = now()->format('F j, Y g:i A');

        $html = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>FMRC Official Appointment Receipt</title><style>*{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#f7f2ec,#efe6da);font-family:Montserrat,Segoe UI,Tahoma,Arial,sans-serif;color:#4b5563;padding:24px}.receipt{max-width:980px;margin:0 auto;background:#fdfaf6;border-radius:8px;border:1px solid #f0e8c8;overflow:hidden;box-shadow:0 22px 54px rgba(27,4,4,.18)}.header{background:linear-gradient(135deg,#3d0808 0%,#511721 52%,#6b202b 100%);color:#f7f2ec;padding:22px 24px;display:flex;justify-content:space-between;gap:16px;align-items:center}.kicker{display:block;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#f5ef8e}.ticket{margin-top:6px;font-size:30px;font-weight:800;color:#f7f2ec}.badge{background:#f1ed12;color:#6b202b;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;letter-spacing:.04em}.body{display:flex;gap:0;align-items:stretch}.left{flex:1;padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.item{border-bottom:1px solid #f0e8c8;padding:10px 4px}.label{font-size:10.5px;text-transform:uppercase;letter-spacing:.11em;color:#77610d;font-weight:800}.value{font-size:14.5px;font-weight:600;color:#4b5563;margin-top:6px;word-break:break-word}.highlight{color:#6b202b;font-weight:800}.right{width:260px;border-left:1px solid #f0e8c8;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:22px 16px;background:#fffdf4}.verify-chip{font-size:12px;color:#6b202b;background:#fff8d2;border:1px solid #f0e8c8;border-radius:999px;padding:7px 12px;font-weight:800;margin-bottom:12px}.qr-box{width:170px;height:170px;border:2px solid #f0e8c8;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fff;text-align:center;color:#6b202b;font-size:12px;font-weight:700;padding:10px}.verify-note{text-align:center;font-size:12px;color:#4b5563;line-height:1.5;margin-top:10px}.footer{background:#fffdf4;border-top:1px solid #f0e8c8;padding:14px 18px;font-size:12px;color:#4b5563;line-height:1.65}.footer strong{color:#6b202b}@media (max-width:860px){body{padding:12px}.body{flex-direction:column}.right{width:100%;border-left:none;border-top:1px solid #f0e8c8}.left{grid-template-columns:1fr}}</style></head><body><div class="receipt"><div class="header"><div><span class="kicker">OFFICIAL RECEIPT VERIFICATION</span><div class="ticket">Ticket #'.e($data['reference_no']).'</div></div><span class="badge">CONFIRMED</span></div><div class="body"><div class="left"><div class="item"><div class="label">Full Name</div><div class="value">'.e($data['client_name']).'</div></div><div class="item"><div class="label">Purpose</div><div class="value">'.e($data['purpose']).'</div></div><div class="item"><div class="label">Type of Client</div><div class="value">'.e($data['client_type']).'</div></div><div class="item"><div class="label">Schedule</div><div class="value highlight">'.e($data['appointment_date']).' @ '.e($data['appointment_time']).'</div></div><div class="item"><div class="label">Contact Number</div><div class="value">'.e($data['contact_number']).'</div></div><div class="item"><div class="label">Email Address</div><div class="value">'.e($data['email']).'</div></div><div class="item"><div class="label">Address</div><div class="value">'.e($data['full_address']).'</div></div><div class="item"><div class="label">Appointment method</div><div class="value">'.e($data['method_label']).'</div></div><div class="item"><div class="label">Status</div><div class="value">'.e($data['status']).'</div></div></div><div class="right"><span class="verify-chip">VALID APPOINTMENT RECEIPT</span><div class="qr-box">QR Verified</div><p class="verify-note">This receipt has been successfully verified by the FMRC system.</p><p class="verify-note">Verified at: '.e($verifiedAt).'</p></div></div><div class="footer"><strong>Important:</strong> Present this verified receipt or the original QR code at the FMRC office for appointment confirmation.</div></div></body></html>';

        return response($html)->header('Content-Type', 'text/html');
    }

    public function customerIndex(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === 'customer', 403);
        $deletionReady = Schema::hasColumn('appointments', 'customer_deleted_at');
        $items = Appointment::where('user_id', $request->user()->id)
            ->when($deletionReady, fn ($query) => $query->whereNull('customer_deleted_at'))
            ->orderByDesc('created_at')->orderByDesc('id')->get();

        return response()->json(['data' => $items->map(fn ($item) => $this->customerPresentation($item, $deletionReady))])->header('Cache-Control', 'private, no-store');
    }

    public function customerShow(Request $request, Appointment $appointment): JsonResponse
    {
        $this->authorizeOwner($request, $appointment);

        return response()->json(['data' => $this->customerPresentation($appointment)])->header('Cache-Control', 'private, no-store');
    }

    public function customerDestroy(Request $request, Appointment $appointment): JsonResponse
    {
        $this->authorizeOwner($request, $appointment);
        abort_unless($request->user()->role === 'customer', 403);
        abort_unless(Schema::hasColumn('appointments', 'customer_deleted_at'), 503, 'Appointment deletion is temporarily unavailable. Please try again shortly.');
        DB::transaction(function () use ($request, $appointment) {
            AppointmentScheduling::lock();
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            abort_unless($current->user_id === $request->user()->id, 404);
            // Archived records originate only from completed meetings. Keep that
            // internal lifecycle while removing this customer's list entry.
            abort_unless(in_array($current->status, ['Completed', 'Cancelled', 'Archived'], true), 422, 'Only completed or cancelled appointments can be deleted.');
            if (! $current->customer_deleted_at) {
                DB::table('appointments')->where('id', $current->id)->update(['customer_deleted_at' => now()]);
            }
        });

        return response()->json(['message' => 'Appointment deleted from My Appointments.'])->header('Cache-Control', 'private, no-store');
    }

    private function customerPresentation(Appointment $appointment, ?bool $deletionReady = null): array
    {
        $data = $this->transformAppointment($appointment);
        $data['status'] = $appointment->status === 'Archived' ? 'Completed' : $appointment->status;
        $data['can_delete'] = ($deletionReady ?? Schema::hasColumn('appointments', 'customer_deleted_at')) && in_array($data['status'], ['Completed', 'Cancelled'], true) && ! $appointment->getAttribute('customer_deleted_at');
        $data['deleted_from_list'] = (bool) $appointment->getAttribute('customer_deleted_at');

        return $data;
    }

    public function reschedule(Request $request, Appointment $appointment): JsonResponse
    {
        $this->authorizeOwner($request, $appointment);
        abort_unless($request->user()->role === 'customer', 403);
        $data = $request->validate(['appointment_date' => 'required|date_format:Y-m-d', 'appointment_time' => 'required|string|max:60',
            'expected_date' => 'required|date_format:Y-m-d', 'expected_time' => 'required|string|max:60', 'expected_version' => 'required|integer|min:0']);
        $appointment = DB::transaction(function () use ($request, $appointment, $data) {
            AppointmentScheduling::lock();
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            abort_unless($current->user_id === $request->user()->id, 404);
            abort_unless($current->appointment_date->format('Y-m-d') === $data['expected_date'] && $current->appointment_time === $data['expected_time'] && $current->schedule_version === (int) $data['expected_version'], 409, 'This appointment has changed. Refresh its details before rescheduling.');
            abort_unless(AppointmentScheduling::canReschedule($current), 422, 'This appointment can no longer be rescheduled. Changes must be made before its original start in Philippine time.');
            if ($data['appointment_date'] === $data['expected_date'] && $data['appointment_time'] === $data['expected_time']) {
                return $current;
            }
            $starts = AppointmentScheduling::available($data['appointment_date'], $data['appointment_time'], $current->id);
            DB::table('appointment_schedule_history')->insert(['appointment_id' => $current->id, 'actor_id' => $request->user()->id,
                'previous_date' => $data['expected_date'], 'previous_time' => $data['expected_time'], 'appointment_date' => $data['appointment_date'], 'appointment_time' => $data['appointment_time'], 'created_at' => now()]);
            $current->fill(['appointment_date' => $data['appointment_date'], 'appointment_time' => $data['appointment_time'],
                'appointment_starts_at' => $starts->utc(), 'meeting_platform' => null, 'meeting_url' => null, 'schedule_version' => $current->schedule_version + 1])->save();
            AdminNotification::create(['type' => 'appointment', 'title' => 'Appointment rescheduled: '.$current->reference_no,
                'message' => $current->first_name.' '.$current->last_name.' moved their appointment to '.$data['appointment_date'].' at '.$data['appointment_time'].' (Philippine time).',
                'is_read' => false, 'metadata' => ['appointment_id' => $current->id, 'reference_no' => $current->reference_no]]);

            return $current;
        });
        $this->sendUpdatedConfirmation($appointment);

        return response()->json(['message' => 'Appointment rescheduled. Please use the updated receipt.', 'data' => $this->transformAppointment($appointment)]);
    }

    public function updateMeeting(Request $request, Appointment $appointment): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }
        $data = $request->validate(['platform' => 'nullable|string|max:60', 'meeting_url' => 'nullable|url:https|max:2000', 'expected_version' => 'required|integer|min:0']);
        if (filled($data['meeting_url'] ?? null)) {
            $url = parse_url($data['meeting_url']);
            if (blank($data['platform'] ?? null) || isset($url['user']) || isset($url['pass'])) {
                throw ValidationException::withMessages(['meeting_url' => 'Enter a platform name and an HTTPS meeting link without embedded credentials.']);
            }
        }
        $clearing = array_key_exists('meeting_url', $data) && blank($data['meeting_url']) && blank($data['platform'] ?? null);
        $changed = false;
        $appointment = DB::transaction(function () use ($appointment, $data, $request, $clearing, &$changed) {
            AppointmentScheduling::lock();
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            abort_unless($current->appointment_method === 'online', 422, 'This appointment does not use an online meeting.');
            if ($clearing && blank($current->meeting_url) && blank($current->meeting_platform)) return $current;
            abort_unless($clearing || AppointmentScheduling::canReschedule($current), 422, 'Meeting details can be updated for an upcoming online appointment.');
            abort_unless($current->schedule_version === (int) $data['expected_version'], 409, 'This appointment has changed. Refresh its details before saving a meeting link.');
            $current->fill(['meeting_platform' => filled($data['meeting_url'] ?? null) ? trim($data['platform']) : null,
                'meeting_url' => $data['meeting_url'] ?? null, 'schedule_version' => $current->schedule_version + 1])->save();
            $changed = true;
            if ($clearing && ($job = AppointmentProducts::jobFor($current))) {
                AppointmentProducts::event($job, 'meeting_link_removed', 'Online meeting link removed for '.$current->reference_no.'.', $request->user()->id, ['appointment_id' => $current->id]);
            }

            return $current;
        });
        if ($changed && AppointmentScheduling::canReschedule($appointment)) $this->sendUpdatedConfirmation($appointment);

        return response()->json(['message' => $clearing ? 'Meeting link removed.' : 'Meeting information saved.', 'data' => $this->transformAppointment($appointment)]);
    }

    public function attachment(Request $request, Appointment $appointment, string $file)
    {
        $this->authorizeOwner($request, $appointment);
        if ($file === 'legacy') {
            abort_unless($appointment->attachment_path, 404);
            $disk = 'public';
            $path = $appointment->attachment_path;
            $name = $appointment->attachment_name;
        } else {
            $record = DB::table('appointment_attachments')->where('appointment_id', $appointment->id)->where('id', $file)->first();
            abort_unless($record, 404);
            $disk = 'local';
            $path = $record->path;
            $name = $record->name;
        }
        abort_unless(Storage::disk($disk)->exists($path), 404, 'This attachment is unavailable.');

        return Storage::disk($disk)->download($path, $name, ['Content-Type' => 'application/octet-stream', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    private function authorizeOwner(Request $request, Appointment $appointment): void
    {
        $user = $request->user();
        abort_unless($user && (in_array($user->role, self::ALLOWED_ADMIN_ROLES, true) || ($user->role === 'customer' && $appointment->user_id === $user->id)), 404);
    }

    private function sendUpdatedConfirmation(Appointment $appointment): void
    {
        if (! filter_var($appointment->email, FILTER_VALIDATE_EMAIL)) {
            return;
        }
        OrderNotifier::afterResponse(function () use ($appointment) {
            try {
                Mail::to($appointment->email)->send(new AppointmentConfirmation($appointment, true));
            } catch (\Throwable $error) {
                Log::warning('Appointment update email could not be sent.', ['appointment_id' => $appointment->id]);
            }
        });
    }

    private function ensureDefaultSlots(): void
    {
        DB::transaction(function () {
            AppointmentScheduling::lock();
            if (AppointmentTimeSlot::exists()) {
                return;
            }
            foreach ($this->defaultTimeSlots as $slot) {
                AppointmentTimeSlot::create($slot + ['is_active' => true]);
            }
        });
    }

    private function transformAppointment(Appointment $appointment, bool $private = true): array
    {
        $middleInitial = trim((string) ($appointment->middle_initial ?? ''));
        $middleInitial = $middleInitial ? rtrim($middleInitial, '.').'.' : '';

        $clientNameParts = array_filter([
            trim((string) $appointment->first_name),
            $middleInitial,
            trim((string) $appointment->last_name),
        ]);

        $attachmentUrl = $private && $appointment->attachment_path ? url('/api/customer/appointments/'.$appointment->id.'/attachments/legacy') : null;
        $extra = ['appointment_method' => $appointment->appointment_method, 'method_label' => match ($appointment->appointment_method) {
            'online' => 'Online','face_to_face' => 'Face-to-face at FMRC',default => 'Not recorded'
        }];
        if ($private) {
            $job=AppointmentProducts::jobFor($appointment);
            $extra['custom_product']=$job ? AppointmentProducts::present($job) : ($appointment->getAttribute('product_job_id') ? ['id'=>$appointment->product_job_id,'unavailable'=>true,'stage'=>'Custom-product details unavailable'] : null);
            $extra['custom_products_available']=AppointmentProducts::enabled();
            $files = AppointmentFiles::records($appointment->id);
            if ($appointment->attachment_path) {
                $files[] = ['id' => 'legacy', 'name' => $appointment->attachment_name, 'size' => null, 'download_url' => $attachmentUrl];
            }
            $extra += AppointmentScheduling::meetingData($appointment, in_array(auth()->user()?->role, self::ALLOWED_ADMIN_ROLES, true));
            $extra += ['attachments' => $files, 'can_reschedule' => AppointmentScheduling::canReschedule($appointment),
                'schedule_history' => DB::table('appointment_schedule_history')->where('appointment_id', $appointment->id)->orderBy('id')->get(['previous_date', 'previous_time', 'appointment_date', 'appointment_time', 'created_at'])->all()];
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
            'attachment_name' => $private ? $appointment->attachment_name : null,
            'attachment_url' => $attachmentUrl,
            'status' => $appointment->status,
            'qr_payload' => $appointment->qr_payload,
            'created_at' => optional($appointment->created_at)->toIso8601String(),
        ] + $extra;
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (! $user || ! in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }
}
