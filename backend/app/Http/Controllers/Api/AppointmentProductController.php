<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\AppointmentProductJob;
use App\Models\AppointmentProductQuote;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Service;
use App\Models\User;
use App\Services\AppointmentFiles;
use App\Services\AppointmentConsultations;
use App\Services\AppointmentProducts as Products;
use App\Services\AppointmentScheduling;
use App\Services\CommercePolicy;
use App\Services\GatewayPayments;
use App\Support\EmailTemplate;
use App\Support\OrderNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AppointmentProductController extends Controller
{
    private function customer(Request $r): User
    {
        abort_unless($r->user()?->role === 'customer', 403);

        return $r->user();
    }

    private function operator(Request $r): void
    {
        abort_unless(in_array($r->user()?->role, ['admin', 'staff'], true), 403);
    }

    private function authorizeJob(Request $r, AppointmentProductJob $job): void
    {
        abort_unless($r->user() && (in_array($r->user()->role, ['admin', 'staff'], true) || ($r->user()->role === 'customer' && $job->customer_id === $r->user()->id)), 404);
    }

    private function data(Request $r, string $key): array
    {
        $value = $r->input($key, []);

        return is_string($value) ? (json_decode($value, true) ?: []) : (is_array($value) ? $value : []);
    }

    private function key(Request $r): string
    {
        return $r->validate(['request_key' => 'required|string|max:80|regex:/^[A-Za-z0-9-]+$/'])['request_key'];
    }

    private function result(AppointmentProductJob $job, string $message = 'Custom-product details updated.')
    {
        return response()->json(['message' => $message, 'data' => Products::present($job->fresh())]);
    }

    public function availability()
    {
        return response()->json(['data' => ['enabled' => Products::enabled(), 'schema_ready' => Products::installed(),
            'services' => Products::enabled() ? Service::where('accepts_appointment_products', true)->orderBy('sort_order')->get(['id', 'title'])->all() : []]]);
    }

    public function drafts(Request $r)
    {
        $user = $this->customer($r);

        return response()->json(['data' => Products::installed() ? AppointmentProductJob::where('customer_id', $user->id)->where('state', 'draft')->latest()->get()->map(fn ($j) => Products::present($j))->all() : []]);
    }

    public function saveDraft(Request $r)
    {
        $user = $this->customer($r);
        Products::requireIntake();
        $key = $this->key($r);
        $input = $this->data($r, 'requirements');
        $brief = Products::brief($input, true);
        $service = Products::eligible($brief['service_id']);
        $r->validate(['booking' => ['nullable'], 'draft_id' => 'nullable|integer', 'expected_revision' => 'required_with:draft_id|integer|min:0']);
        $booking = $this->data($r, 'booking');
        \Illuminate\Support\Facades\Validator::make($booking, ['aptDesc' => 'nullable|string|max:2000'])->validate();
        $notes = Products::customerNotes($input, $booking['aptDesc'] ?? null);
        \Illuminate\Support\Facades\Validator::make(['additional_notes' => $notes], ['additional_notes' => 'nullable|string|max:2000'])->validate();
        $brief['instructions'] = $notes;
        $brief['customer_notes_version'] = 1;
        $booking['aptDesc'] = $notes;
        $stored = [];
        try {
            $job = DB::transaction(function () use ($r, $user, $key, $brief, $service, $booking, &$stored) {
                User::whereKey($user->id)->lockForUpdate()->firstOrFail();
                $job = $r->filled('draft_id') ? AppointmentProductJob::where('customer_id', $user->id)->whereKey($r->integer('draft_id'))->lockForUpdate()->firstOrFail()
                    : AppointmentProductJob::where('customer_id', $user->id)->where('request_key', $key)->first();
                $brief = Products::customerBrief($brief, true, $job?->requirements ?? []);
                if ($job && ! $r->filled('draft_id')) {
                    return $job;
                }
                if ($job) {
                    Products::version($job, $r->input('expected_revision'));
                    abort_unless($job->state === 'draft', 409, 'This draft is already booked. Open its appointment.');
                }
                $files = AppointmentFiles::validate($r);
                $count = $job ? DB::table('appointment_product_files')->where('job_id', $job->id)->count() : 0;
                $bytes = $job ? (int) DB::table('appointment_product_files')->where('job_id', $job->id)->sum('size') : 0;
                abort_if($count + count($files) > 5 || $bytes + array_sum(array_map(fn ($f) => $f->getSize(), $files)) > 50 * 1024 * 1024, 422, 'Your draft can hold up to five files, totaling 50 MB.');
                $stored = AppointmentFiles::store($files);
                $values = ['requirements' => $brief, 'booking' => $booking, 'service_id' => $service->id, 'service_name' => $service->title];
                if ($job) {
                    $job->fill($values);
                    Products::touch($job);
                } else {
                    $job = AppointmentProductJob::create($values + ['customer_id' => $user->id, 'request_key' => $key, 'revision' => 0, 'state' => 'draft']);
                }
                Products::files($job, $stored);

                return $job;
            });
        } catch (\Throwable $e) {
            AppointmentFiles::clean($stored);
            throw $e;
        }

        return $this->result($job, 'Draft saved. No appointment time has been reserved.');
    }

    public function show(Request $r, AppointmentProductJob $job)
    {
        $this->authorizeJob($r, $job);

        return $this->result($job, '');
    }

    public function optIn(Request $r, Appointment $appointment)
    {
        $user = $this->customer($r);
        Products::requireIntake();
        abort_unless($appointment->user_id === $user->id, 404);
        abort_if(in_array($appointment->status, ['Cancelled', 'Archived'], true), 422, 'Restore or reschedule this appointment before adding custom work.');
        $brief = Products::customerBrief($this->data($r, 'requirements'), false, [], $appointment->additional_notes);
        $service = Products::eligible($brief['service_id']);
        $key = $this->key($r);
        $job = DB::transaction(function () use ($appointment, $brief, $service, $user, $key) {
            $a = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if ($existing = Products::jobFor($a)) {
                return $existing;
            }
            $job = AppointmentProductJob::create(['appointment_id' => $a->id, 'customer_id' => $user->id, 'service_id' => $service->id, 'service_name' => $service->title,
                'requirements' => $brief, 'request_key' => $key, 'state' => 'awaiting_consultation', 'revision' => 0]);
            $a->forceFill(['product_job_id' => $job->id])->save();
            $a->update(['additional_notes' => $brief['instructions'] ?? null]);
            if (Schema::hasTable('appointment_attachments')) {
                $files = DB::table('appointment_attachments')->where('appointment_id', $a->id)->get(['name', 'path', 'mime', 'size', 'created_at'])->map(fn ($f) => (array) $f)->all();
                Products::files($job, $files);
            }
            Products::event($job, 'requested', 'Custom product added to the existing appointment.', $user->id);

            return $job;
        });

        return $this->result($job, 'Custom product added. Your appointment schedule is unchanged.');
    }

    public function updateBrief(Request $r, AppointmentProductJob $job)
    {
        $this->authorizeJob($r, $job);
        $brief = Products::customerBrief($this->data($r, 'requirements'), false, $job->requirements ?? [], $job->booking['aptDesc'] ?? null, $job->appointment?->additional_notes);
        Products::version($job, $r->input('expected_revision'));
        if ((int) $brief['service_id'] !== (int) $job->service_id) {
            Products::eligible($brief['service_id']);
        }
        abort_if(in_array($job->state, ['declined', 'cancelled'], true), 422, 'This custom request is closed.');
        if (Products::sameBrief($brief, Products::customerBriefView($job->requirements ?? [], $job->booking['aptDesc'] ?? null, $job->appointment?->additional_notes))) {
            return $this->result($job, 'Product details are already up to date.');
        }
        // Any published offer must be withdrawn before its requirements change.
        if ($job->quotes()->whereIn('state', ['sent', 'accepted', 'closing'])->exists()) {
            $this->closeOffers($job, 'superseded');
        }
        DB::transaction(function () use ($job, $r, $brief) {
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            Products::version($j, $r->input('expected_revision'));
            abort_if(in_array($j->state, ['declined', 'cancelled'], true), 422, 'This custom request is closed.');
            foreach ($j->orders()->lockForUpdate()->get() as $order) {
                abort_if(Products::moneyHeld($order) > 0 || ! in_array($order->lifecycle_status, ['cancelled', 'rejected'], true), 422,
                    'Resolve the linked order before changing the product requirements.');
            }
            $serviceChanged = (int) $brief['service_id'] !== (int) $j->service_id;
            if ($serviceChanged) {
                $service = Products::eligible($brief['service_id'], true);
                $j->fill(['service_id' => $service->id, 'service_name' => $service->title,
                    'discussed_at' => null, 'discussed_appointment_id' => null, 'discussed_by' => null, 'outcome_note' => null]);
            }
            $j->requirements = $brief;
            $j->booking = array_replace($j->booking ?? [], ['aptDesc' => $brief['instructions'] ?? '']);
            $j->appointment?->update(['additional_notes' => $brief['instructions'] ?? null]);
            $j->state = $j->discussed_at ? 'needs_information' : 'awaiting_consultation';
            Products::touch($j);
            Products::event($j, 'requirements', $serviceChanged ? 'Fabrication service changed; FMRC must confirm the new requirements were discussed or arrange a follow-up.' : 'Product requirements updated; FMRC must review the changes.', $r->user()->id);
        });

        return $this->result($job, 'Product details saved. FMRC must review the changes before quoting.');
    }

    public function message(Request $r, AppointmentProductJob $job)
    {
        $this->authorizeJob($r, $job);
        $key = $this->key($r);
        $body = $r->validate(['body' => 'required|string|max:5000'])['body'];
        $stored = [];
        try {
            DB::transaction(function () use ($r, $job, $key, $body, &$stored) {
                $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
                if (DB::table('appointment_product_messages')->where(['job_id' => $j->id, 'sender_id' => $r->user()->id, 'request_key' => $key])->exists()) {
                    return;
                }
                $stored = AppointmentFiles::store(AppointmentFiles::validate($r, true));
                $id = DB::table('appointment_product_messages')->insertGetId(['job_id' => $j->id, 'sender_id' => $r->user()->id, 'sender_role' => $r->user()->role,
                    'sender_name' => $r->user()->name, 'body' => $body, 'request_key' => $key, 'created_at' => now(), 'updated_at' => now()]);
                Products::files($j, $stored, $id);
                Products::event($j, 'message', 'A private message was added.', $r->user()->id);
            });
        } catch (\Throwable $e) {
            AppointmentFiles::clean($stored);
            throw $e;
        }

        return $this->result($job, 'Message sent.');
    }

    public function file(Request $r, AppointmentProductJob $job, int $file)
    {
        $this->authorizeJob($r, $job);
        $record = DB::table('appointment_product_files')->where('job_id', $job->id)->where('id', $file)->first();
        abort_unless($record && Storage::disk('local')->exists($record->path), 404, 'This private file is unavailable.');

        return Storage::disk('local')->download($record->path, $record->name, ['Content-Type' => 'application/octet-stream', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    private function outcomeReplay(AppointmentProductJob $job, ?string $key, string $fingerprint): ?int
    {
        if (! $key) return null;
        $event = DB::table('appointment_product_events')->where('job_id', $job->id)->where('action', 'outcome')
            ->where('metadata->completion_request_key', $key)->first();
        if (! $event) return null;
        $metadata = json_decode($event->metadata, true);
        abort_unless(hash_equals((string) ($metadata['fingerprint'] ?? ''), $fingerprint), 409,
            'This confirmation was already used for different details. Review the saved consultation.');

        return (int) $metadata['appointment_id'];
    }

    private function outcomeResult(Request $request, AppointmentProductJob $job, int $appointmentId)
    {
        $appointment = app(AppointmentController::class)->teamShow($request, Appointment::findOrFail($appointmentId))->getData(true)['data'];

        return response()->json(['message' => 'Consultation outcome saved.', 'data' => Products::present($job->fresh()), 'appointment' => $appointment])
            ->header('Cache-Control', 'private, no-store');
    }

    public function outcome(Request $r, AppointmentProductJob $job)
    {
        $this->operator($r);
        $v = $r->validate(['outcome' => 'required|in:ready_for_quote,needs_information,follow_up,declined',
            'note' => 'required|string|max:2000', 'discussed_appointment_id' => 'nullable|integer',
            'discussion_confirmed' => 'required_if:outcome,ready_for_quote|accepted_if:outcome,ready_for_quote',
            'complete_consultation' => 'sometimes|boolean', 'expected_schedule_version' => 'required_if:complete_consultation,true|integer|min:0']);
        $complete = $r->boolean('complete_consultation');
        $key = $complete ? $this->key($r) : null;
        if ($complete) abort_unless($r->boolean('discussion_confirmed'), 422, 'Confirm that the consultation took place before marking it done.');
        $meetingId = (int) ($v['discussed_appointment_id'] ?? $job->appointment_id);
        $fingerprint = hash('sha256', json_encode([$meetingId, $v['outcome'], trim($v['note']), $complete, $r->boolean('discussion_confirmed'), $v['expected_schedule_version'] ?? null]));
        if ($replay = $this->outcomeReplay($job, $key, $fingerprint)) return $this->outcomeResult($r, $job, $replay);
        Products::version($job, $r->input('expected_revision'));
        $meeting = Appointment::whereKey($meetingId)->where(fn ($query) => $query->where('product_job_id', $job->id)->orWhere('id', $job->appointment_id))->firstOrFail();
        abort_if(in_array($meeting->status, ['Cancelled', 'Archived'], true), 422, 'A cancelled or archived consultation cannot be confirmed.');
        if ($complete) abort_unless($meeting->schedule_version === (int) $v['expected_schedule_version'], 409, 'The consultation schedule changed. Refresh its details before confirming.');
        if ($v['outcome'] === 'ready_for_quote' && ! $complete) {
            abort_unless($meeting->status === 'Completed', 422, 'Confirm the attended consultation before preparing the quotation.');
        }
        if ($job->quotes()->whereIn('state', ['sent', 'accepted', 'closing'])->exists()) $this->closeOffers($job, 'superseded');
        DB::transaction(function () use ($job, $r, $v, $complete, $key, $fingerprint, $meetingId) {
            AppointmentScheduling::lock();
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            if ($this->outcomeReplay($j, $key, $fingerprint)) return;
            Products::version($j, $r->input('expected_revision'));
            $a = Appointment::whereKey($meetingId)->where(fn ($query) => $query->where('product_job_id', $j->id)->orWhere('id', $j->appointment_id))->lockForUpdate()->firstOrFail();
            abort_if(in_array($a->status, ['Cancelled', 'Archived'], true), 422, 'A cancelled or archived consultation cannot be confirmed.');
            if ($complete) {
                abort_unless($a->schedule_version === (int) $v['expected_schedule_version'], 409,
                    'The consultation schedule changed. Your entries are still here. Refresh its details before confirming.');
                if (AppointmentConsultations::completeLocked($a, true)) {
                    DB::afterCommit(fn () => AppointmentConsultations::notifyCompleted($a));
                }
            }
            if ($v['outcome'] === 'ready_for_quote') {
                abort_unless($a->status === 'Completed', 422, 'Confirm the attended consultation before preparing the quotation.');
                $j->fill(['discussed_appointment_id' => $a->id, 'discussed_at' => now(), 'discussed_by' => $r->user()->id]);
            }
            $j->fill(['state' => $v['outcome'], 'outcome_note' => $v['note']]);
            Products::touch($j);
            Products::event($j, 'outcome', $v['note'], $r->user()->id, $complete ? [
                'completion_request_key' => $key, 'fingerprint' => $fingerprint, 'appointment_id' => $a->id,
            ] : []);
        }, 3);

        return $this->outcomeResult($r, $job, $meetingId);
    }

    public function followUp(Request $r, AppointmentProductJob $job)
    {
        $this->customer($r);
        $this->authorizeJob($r, $job);
        $key = $this->key($r);
        $v = $r->validate(['appointment_date' => 'required|date_format:Y-m-d', 'appointment_time' => 'required|string|max:60', 'appointment_method' => 'required|in:online,face_to_face']);
        DB::transaction(function () use ($r, $job, $v, $key) {
            AppointmentScheduling::lock();
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            if (DB::table('appointment_product_events')->where('job_id', $j->id)->where('action', 'follow_up')->where('metadata', 'like', '%'.$key.'%')->exists()) {
                return;
            }
            Products::version($j, $r->input('expected_revision'));
            abort_unless($j->state === 'follow_up', 422, 'FMRC has not requested a follow-up appointment.');
            $start = AppointmentScheduling::available($v['appointment_date'], $v['appointment_time']);
            $original = $j->appointment;
            $copy = $original->replicate(['reference_no', 'qr_payload', 'meeting_platform', 'meeting_url', 'attachment_name', 'attachment_path', 'customer_deleted_at']);
            $copy->fill($v);
            $copy->forceFill(['status' => 'Scheduled', 'appointment_starts_at' => $start->utc(), 'product_job_id' => $j->id, 'schedule_version' => 0]);
            $copy->save();
            $copy->forceFill(['reference_no' => 'AP-'.str_pad((string) $copy->id, 5, '0', STR_PAD_LEFT), 'qr_payload' => url('/appointments/verify/AP-'.str_pad((string) $copy->id, 5, '0', STR_PAD_LEFT))])->save();
            $j->state = 'awaiting_consultation';
            Products::touch($j);
            Products::event($j, 'follow_up', 'Follow-up appointment booked.', $r->user()->id, ['request_key' => $key, 'appointment_id' => $copy->id]);
        });

        return $this->result($job, 'Follow-up booked. Your previous meeting stays in the history.');
    }

    private function closeOffers(AppointmentProductJob $job, string $state): void
    {
        foreach ($job->orders()->get() as $order) {
            abort_if(Products::moneyHeld($order) > 0 || $order->lifecycle_status === 'completed', 422, 'Complete reviewed cancellation and refund before changing a paid agreement.');
        }
        // Freeze acceptance and new checkout creation before contacting the provider.
        $ids = DB::transaction(function () use ($job) {
            $locked = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            Products::version($locked, $job->revision);
            $ids = $locked->quotes()->whereIn('state', ['sent', 'accepted', 'closing'])->pluck('id')->all();
            foreach ($locked->orders()->whereIn('appointment_product_quote_id', $ids)->lockForUpdate()->get() as $order) {
                abort_if(Products::moneyHeld($order) > 0, 422, 'A payment arrived. Resolve cancellation and refund before changing the agreement.');
                $order->forceFill(['collection_hold' => 'quotation'])->save();
            }
            $locked->quotes()->whereIn('id', $ids)->update(['state' => 'closing']);

            return $ids;
        });
        foreach ($job->orders()->whereIn('appointment_product_quote_id', $ids)->get() as $order) {
            abort_if(Products::moneyHeld($order) > 0, 422, 'This job has a received payment. Complete reviewed cancellation and refund before re-quoting.');
            Products::closeCheckout($order);
        }
        DB::transaction(function () use ($job, $state, $ids) {
            $locked = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            Products::version($locked, $job->revision);
            foreach ($job->orders()->whereIn('appointment_product_quote_id', $ids)->lockForUpdate()->get() as $order) {
                abort_if(Products::moneyHeld($order) > 0, 422, 'A payment arrived during reconciliation. Review the refund before continuing.');
                if (! in_array($order->lifecycle_status, ['cancelled', 'rejected', 'completed'], true)) {
                    $order->forceFill(['lifecycle_status' => 'cancelled', 'cancelled_at' => now(), 'cancel_state' => 'approved'])->save();
                }
                $order->forceFill(['collection_hold' => null])->save();
            }
            $job->quotes()->whereIn('id', $ids)->where('state', 'closing')->update(['state' => $state, 'updated_at' => now()]);
        });
    }

    public function quotation(Request $r, AppointmentProductJob $job)
    {
        $this->operator($r);
        $key = $this->key($r);
        if ($job->quotes()->where('request_key', $key)->exists()) {
            return $this->result($job, 'Quotation already sent.');
        }
        $spec = Products::customerBrief($this->data($r, 'specifications'));
        Validator::make($spec, ['dimensions' => 'required|string', 'material' => 'required|string', 'colors' => 'required|string'])->validate();
        abort_if($spec['needs_advice'] ?? false, 422, 'Resolve specifications needing advice before sending the final quotation.');
        $v = $r->validate(['unit_price' => 'required|numeric|decimal:0,2|min:0.01|max:100000', 'shipping_fee' => 'required|numeric|decimal:0,2|min:0|max:100000',
            'lead_time' => 'required|string|max:300', 'design_notes' => 'required|string|min:5|max:2000', 'fulfillment_type' => 'required|in:pickup,delivery',
            'delivery_eligible' => 'required_if:fulfillment_type,delivery|accepted_if:fulfillment_type,delivery', 'proof_file_ids' => 'sometimes|array|max:5', 'proof_file_ids.*' => 'integer']);
        $delivery = $this->data($r, 'delivery');
        if ($v['fulfillment_type'] === 'delivery') {
            $delivery = Validator::make($delivery, array_fill_keys(['delivery_recipient_name', 'delivery_contact_no', 'delivery_street', 'delivery_barangay', 'delivery_city', 'delivery_province', 'delivery_postal_code'], ['required', 'string', 'max:200']))->validate();
        } else {
            abort_unless(GatewayPayments::centavos($v['shipping_fee']) === 0, 422, 'Pickup has no shipping fee.');
            $delivery = [];
        }
        $unit = GatewayPayments::centavos($v['unit_price']);
        $subtotal = $unit * $spec['quantity'];
        $total = $subtotal + GatewayPayments::centavos($v['shipping_fee']);
        abort_unless($total >= 100 && $total <= 10000000, 422, 'The quoted total must be between ₱1 and ₱100,000.');
        Products::version($job, $r->input('expected_revision'));
        abort_unless($job->discussed_at && in_array($job->state, ['ready_for_quote', 'quoted'], true), 422, 'Confirm the completed product discussion and resolve outstanding questions before sending a quotation.');
        abort_unless((int) $spec['service_id'] === (int) $job->service_id, 422, 'The quotation must use the agreed fabrication service.');
        $proofs = $v['proof_file_ids'] ?? [];
        abort_unless(DB::table('appointment_product_files')->where('job_id', $job->id)->whereIn('id', $proofs)->count() === count(array_unique($proofs)), 422, 'Choose design proofs from this appointment only.');
        if ($job->quotes()->whereIn('state', ['sent', 'accepted', 'closing'])->exists()) {
            $this->closeOffers($job, 'superseded');
        }
        DB::transaction(function () use ($job, $r, $key, $spec, $v, $delivery, $unit, $subtotal, $total) {
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            if ($j->quotes()->where('request_key', $key)->exists()) {
                return;
            }
            Products::version($j, $r->input('expected_revision'));
            abort_unless($j->discussed_at && in_array($j->state, ['ready_for_quote', 'quoted'], true), 422, 'Confirm the completed product discussion and resolve outstanding questions before sending a quotation.');
            abort_unless((int) $spec['service_id'] === (int) $j->service_id, 422, 'The quotation must use the agreed fabrication service.');
            $ids = $v['proof_file_ids'] ?? [];
            abort_unless(DB::table('appointment_product_files')->where('job_id', $j->id)->whereIn('id', $ids)->count() === count(array_unique($ids)), 422, 'Choose design proofs from this appointment only.');
            $agreement = ['specifications' => $spec, 'service' => $j->service_name, 'design_notes' => $v['design_notes'], 'proof_file_ids' => $ids,
                'unit_price' => $unit / 100, 'product_subtotal' => $subtotal / 100, 'shipping_fee' => GatewayPayments::centavos($v['shipping_fee']) / 100, 'total' => $total / 100,
                'lead_time' => $v['lead_time'], 'fulfillment_type' => $v['fulfillment_type'], 'delivery' => $delivery];
            $q = $j->quotes()->create(['version' => ($j->quotes()->max('version') ?? 0) + 1, 'request_key' => $key, 'state' => 'sent', 'agreement' => $agreement,
                'total_centavos' => $total, 'sent_at' => now(), 'expires_at' => now()->addDays(7), 'created_by' => $r->user()->id]);
            $j->state = 'quoted';
            Products::touch($j);
            Products::event($j, 'quotation', 'Quotation version '.$q->version.' sent.', $r->user()->id);
        });

        return $this->result($job, 'Quotation sent. The customer has seven days to approve and pay.');
    }

    public function accept(Request $r, AppointmentProductJob $job, AppointmentProductQuote $quote)
    {
        $user = $this->customer($r);
        $this->authorizeJob($r, $job);
        abort_unless($quote->job_id === $job->id, 404);
        $r->validate(['specifications_accepted' => 'required|accepted', 'payment_method' => 'required|in:online,cash', 'policy_version' => 'required|uuid', 'policy_accepted' => 'required|accepted']);
        $order = DB::transaction(function () use ($r, $job, $quote, $user) {
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            $q = AppointmentProductQuote::whereKey($quote->id)->lockForUpdate()->firstOrFail();
            if ($q->accepted_at && $existing = $q->order) {
                return $existing;
            }
            Products::version($j, $r->input('expected_revision'));
            abort_unless($q->state === 'sent' && $q->expires_at->isFuture() && $j->state === 'quoted', 409, 'This quotation changed or expired. Review the latest version in your appointment.');
            foreach ($j->orders()->get() as $o) {
                abort_if(! in_array($o->lifecycle_status, ['cancelled', 'rejected'], true) || Products::moneyHeld($o) > 0, 422, 'Resolve the previous order and refund before accepting another quotation.');
            }
            $policy = CommercePolicy::accept($r->all());
            $g = $q->agreement;
            $pickup = $g['fulfillment_type'] === 'pickup';
            $online = $r->input('payment_method') === 'online';
            if ($online) {
                abort_unless(Products::onlinePaymentAvailable(), 422, 'Online checkout is unavailable. Choose cash at FMRC or try again later.');
            }
            $o = Order::create(['appointment_product_job_id' => $j->id, 'appointment_product_quote_id' => $q->id, 'appointment_production_status' => 'awaiting_payment', 'production_revision' => 0,
                'customer_id' => $user->id, 'customer_name' => $user->name, 'customer_contact' => $j->appointment?->contact_number ?? $user->email,
                'quantity' => $g['specifications']['quantity'], 'subtotal' => $g['product_subtotal'], 'shipping_fee' => $g['shipping_fee'], 'total' => $g['total'],
                'shipping_quote' => ['source' => 'appointment_quotation', 'version' => $q->version, 'agreed_fee' => $g['shipping_fee']],
                'payment_method' => $online ? 'GCash' : 'Cash at FMRC', 'payment_reference' => 'Awaiting payment', 'payment_due_at' => $q->expires_at,
                'lifecycle_status' => 'incoming', 'customer_stage' => 'to_pay', 'fulfillment_type' => $g['fulfillment_type'],
                'courier_name' => $pickup ? null : 'J&T Express', 'shipment_tracking_mode' => $pickup ? null : 'jnt_dropoff', 'pickup_code' => $pickup ? strtoupper(Str::random(8)) : null,
                'accepted_policy_version' => $policy['version'], 'accepted_policy_text' => $policy, 'policy_accepted_at' => now(), 'is_archived' => false] + $g['delivery']);
            $o->order_no = 'ORD-'.str_pad((string) $o->id, 6, '0', STR_PAD_LEFT);
            $o->save();
            OrderItem::create(['order_id' => $o->id, 'product_id' => null, 'product_name' => $g['specifications']['name'], 'quantity' => $o->quantity, 'unit_price' => $g['unit_price'], 'line_total' => $g['product_subtotal']]);
            Payment::create(['order_id' => $o->id, 'payment_no' => 'PAY-'.str_pad((string) $o->id, 6, '0', STR_PAD_LEFT), 'method' => $o->payment_method, 'gateway' => $online ? 'paymongo' : null,
                'amount' => $o->total, 'status' => 'pending', 'reference' => 'Awaiting payment']);
            $q->update(['state' => 'accepted', 'accepted_at' => now()]);
            Products::touch($j);
            Products::event($j, 'accepted', 'Quotation approved and linked order '.$o->order_no.' created.', $user->id);

            return $o;
        });

        return response()->json(['message' => 'Quotation approved. Complete full payment before production.', 'order_id' => $order->id, 'data' => Products::present($job->fresh())]);
    }

    public function cancel(Request $r, AppointmentProductJob $job)
    {
        $this->authorizeJob($r, $job);
        $note = $r->validate(['note' => 'required|string|max:1000'])['note'];
        Products::version($job, $r->input('expected_revision'));
        if ($job->quotes()->whereIn('state', ['sent', 'accepted', 'closing'])->exists()) {
            $this->closeOffers($job, 'withdrawn');
        }
        DB::transaction(function () use ($job, $r, $note) {
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            Products::version($j, $r->input('expected_revision'));
            $j->state = 'cancelled';
            $j->outcome_note = $note;
            Products::touch($j);
            Products::event($j, 'cancelled', $note, $r->user()->id);
        });

        return $this->result($job, 'Custom request cancelled. Your appointment is unchanged.');
    }

    public function removeDraftFile(Request $r, AppointmentProductJob $job, int $file)
    {
        $this->customer($r);
        $this->authorizeJob($r, $job);
        DB::transaction(function () use ($r, $job, $file) {
            $j = AppointmentProductJob::whereKey($job->id)->lockForUpdate()->firstOrFail();
            Products::version($j, $r->input('expected_revision'));
            abort_unless($j->state === 'draft', 422, 'Files referenced by a consultation or quotation remain in its history.');
            $f = DB::table('appointment_product_files')->where('job_id', $j->id)->where('id', $file)->first();
            abort_unless($f, 404);
            DB::table('appointment_product_files')->where('id', $file)->delete();
            Storage::disk('local')->delete($f->path);
            Products::touch($j);
        });

        return $this->result($job, 'Draft file removed.');
    }

    public function requestClaim(Request $r)
    {
        $v = $r->validate(['reference' => 'required|string|max:60', 'email' => 'required|email']);
        $a = Appointment::where('reference_no', $v['reference'])->whereNull('user_id')->where('email', $v['email'])->first();
        if ($a) {
            $token = Str::random(64);
            DB::table('appointment_product_claims')->insert(['appointment_id' => $a->id, 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addHour(), 'created_at' => now()]);
            $url = url('/home-page').'/?appointment_claim='.$token;
            OrderNotifier::afterResponse(function () use ($v, $url) {
                try {
                    Mail::html(EmailTemplate::render('appointment_connect', ['reference_no' => $v['reference']], '<p><a href="'.e($url).'">Connect appointment</a></p>'), fn ($m) => $m->to($v['email'])->subject('Connect your FMRC appointment'));
                } catch (\Throwable $e) {
                    Log::warning('Guest appointment ownership email unavailable');
                }
            });
        }

        return response()->json(['message' => 'If these details match a guest appointment, a private link has been sent to its email address.']);
    }

    public function claim(Request $r)
    {
        $u = $this->customer($r);
        $token = $r->validate(['token' => 'required|string|max:100'])['token'];
        $id = DB::transaction(function () use ($u, $token) {
            $claim = DB::table('appointment_product_claims')->where('token_hash', hash('sha256', $token))->lockForUpdate()->first();
            abort_unless($claim && ! $claim->used_at && now()->lt($claim->expires_at), 422, 'This private link has expired or was already used. Request a new link.');
            $a = Appointment::whereKey($claim->appointment_id)->lockForUpdate()->firstOrFail();
            abort_unless(! $a->user_id && strcasecmp($a->email, $u->email) === 0, 422, 'Sign in using the email address on this appointment.');
            $a->user_id = $u->id;
            $a->save();
            DB::table('appointment_product_claims')->where('id',$claim->id)->update(['used_at' => now()]);

            return $a->id;
        });

        return response()->json(['message' => 'Appointment connected to your account.', 'appointment_id' => $id]);
    }

    public function expire(): int
    {
        $count = 0;
        if (! Products::installed()) {
            return 0;
        }
        foreach (AppointmentProductQuote::whereIn('state',['sent', 'accepted', 'closing'])->where('expires_at','<=',now())->limit(100)->get() as $q) {
            if ($q->order && ($q->order->lifecycle_status === 'completed' || Products::moneyHeld($q->order) > 0)) {
                continue;
            }
            try {
                $this->closeOffers($q->job,'expired');
                $j = $q->job->fresh();
                $j->state = 'ready_for_quote';
                Products::touch($j);
                Products::event($j,'expired','Quotation expired without confirmed full payment.',null);
                $count++;
            } catch (\Throwable $e) {
                Log::warning('Quotation closure awaits payment reconciliation',['quote_id' => $q->id]);
            }
        }

return $count;
    }
}
