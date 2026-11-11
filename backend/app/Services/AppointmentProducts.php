<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\AppointmentProductJob;
use App\Models\AppointmentProductQuote;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Service;
use App\Models\User;
use App\Support\EmailTemplate;
use App\Support\OrderNotifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;

/** The optional product job never changes the lifecycle of its meeting. */
final class AppointmentProducts
{
    public const LABELS = ['draft' => 'Draft', 'awaiting_consultation' => 'Awaiting consultation', 'needs_information' => 'More information needed',
        'follow_up' => 'Follow-up needed', 'ready_for_quote' => 'Preparing quotation', 'quoted' => 'Quotation ready',
        'declined' => 'Unable to fulfill', 'cancelled' => 'Custom request cancelled'];

    public static function installed(): bool
    {
        $request = app()->bound('request') ? request() : null;
        if ($request?->attributes->has('appointment_products_schema')) {
            return $request->attributes->get('appointment_products_schema');
        }
        $required = [
            'appointment_product_jobs' => ['customer_id', 'appointment_id', 'service_id', 'service_name', 'request_key', 'state', 'revision', 'requirements', 'booking', 'discussed_appointment_id', 'discussed_at', 'discussed_by', 'outcome_note'],
            'appointment_product_quotes' => ['job_id', 'version', 'state', 'request_key', 'agreement', 'total_centavos', 'sent_at', 'expires_at', 'accepted_at', 'created_by'],
            'appointment_product_messages' => ['job_id', 'sender_id', 'sender_name', 'sender_role', 'body', 'request_key'],
            'appointment_product_files' => ['job_id', 'message_id', 'name', 'path', 'mime', 'size'],
            'appointment_product_events' => ['job_id', 'actor_id', 'action', 'description', 'metadata', 'created_at'],
            'appointment_product_claims' => ['appointment_id', 'token_hash', 'expires_at', 'used_at'],
            'appointment_cash_entries' => ['payment_id', 'kind', 'amount_centavos', 'receipt_reference', 'request_key', 'actor_id', 'confirmed_at'],
            'orders' => ['appointment_product_job_id', 'appointment_product_quote_id', 'appointment_production_status', 'production_revision', 'collection_hold'],
            'appointments' => ['product_job_id'], 'services' => ['accepts_appointment_products'],
        ];
        $ready = true;
        foreach ($required as $table => $columns) {
            if (! Schema::hasTable($table) || ! Schema::hasColumns($table, $columns)) {
                $ready = false;
                break;
            }
        }
        $request?->attributes->set('appointment_products_schema', $ready);

        return $ready;
    }

    public static function enabled(): bool
    {
        return (bool) config('appointment_products.enabled') && self::installed();
    }

    public static function requireIntake(): void
    {
        abort_unless(self::enabled(), 503, 'Custom-product consultations are temporarily unavailable. Your ordinary appointment is still available.');
    }

    public static function custom(Order $order): bool
    {
        return (bool) $order->getAttribute('appointment_product_job_id');
    }

    public static function jobFor(Appointment $appointment): ?AppointmentProductJob
    {
        if (! self::installed()) {
            return null;
        }

        return $appointment->product_job_id ? AppointmentProductJob::find($appointment->product_job_id)
            : AppointmentProductJob::where('appointment_id', $appointment->id)->first();
    }

    public static function brief(array $data, bool $draft = false): array
    {
        return Validator::make($data, [
            'service_id' => ['required', 'integer', 'exists:services,id'], 'name' => [$draft ? 'nullable' : 'required', 'string', 'max:160'],
            'description' => [$draft ? 'nullable' : 'required', 'string', 'max:2000'], 'quantity' => ['required', 'integer', 'min:1', 'max:100000'],
            'dimensions' => ['nullable', 'string', 'max:400'], 'material' => ['nullable', 'string', 'max:300'], 'colors' => ['nullable', 'string', 'max:300'],
            'finish' => ['nullable', 'string', 'max:300'], 'personalization' => ['nullable', 'string', 'max:1000'], 'intended_use' => ['nullable', 'string', 'max:600'],
            'instructions' => ['nullable', 'string', 'max:2000'], 'needs_advice' => ['sometimes', 'boolean'], 'budget' => ['nullable', 'numeric', 'min:0', 'max:10000000'],
            'preferred_date' => ['nullable', 'date_format:Y-m-d'],
        ])->validate();
    }

    /** Keep distinct legacy booking/instruction blocks without repeating a merged block. */
    public static function mergeBookingNotes(?string ...$values): string
    {
        $parts = [];
        foreach ($values as $value) {
            $note = trim($value ?? '');
            if ($note === '' || collect($parts)->contains(fn ($part) => str_contains("\n\n".$part."\n\n", "\n\n".$note."\n\n"))) {
                continue;
            }
            $parts = array_values(array_filter($parts, fn ($part) => ! str_contains("\n\n".$note."\n\n", "\n\n".$part."\n\n")));
            $parts[] = $note;
        }

        return implode("\n\n", $parts);
    }

    /** New customer briefs have one authoritative notes field; legacy reads are lossless. */
    public static function customerNotes(array $data, ?string ...$legacyNotes): string
    {
        if ((int) ($data['customer_notes_version'] ?? 0) >= 1) {
            return trim((string) ($data['instructions'] ?? ''));
        }

        return self::mergeBookingNotes(...[...$legacyNotes, $data['instructions'] ?? null, $data['personalization'] ?? null]);
    }

    public static function customerBrief(array $data, bool $draft = false, array $previous = [], ?string ...$legacyNotes): array
    {
        $data['instructions'] = self::customerNotes($data, ...$legacyNotes);
        foreach (['finish', 'personalization', 'intended_use'] as $key) {
            if (! array_key_exists($key, $data) && array_key_exists($key, $previous)) {
                $data[$key] = $previous[$key];
            }
        }

        return self::brief($data, $draft) + ['customer_notes_version' => 1];
    }

    public static function customerBriefView(array $data, ?string ...$legacyNotes): array
    {
        return array_replace($data, ['instructions' => self::customerNotes($data, ...$legacyNotes), 'customer_notes_version' => 1]);
    }

    public static function eligible(int $id, bool $lock = false): Service
    {
        self::requireIntake();
        $service = Service::whereKey($id)->when($lock, fn ($query) => $query->lockForUpdate())->firstOrFail();
        abort_unless($service->accepts_appointment_products, 422, 'Choose a service that accepts custom-product consultations.');

        return $service;
    }

    public static function sameBrief(array $first, array $second): bool
    {
        $first = self::customerBriefView($first);
        $second = self::customerBriefView($second);
        // Browser forms send empty optional fields that older saved briefs omit.
        foreach (array_unique([...array_keys($first), ...array_keys($second)]) as $key) {
            $a = $first[$key] ?? null;
            $b = $second[$key] ?? null;
            if ($key === 'needs_advice' ? (bool) $a !== (bool) $b : trim((string) $a) !== trim((string) $b)) {
                return false;
            }
        }

        return true;
    }

    public static function version(AppointmentProductJob $job, mixed $revision): void
    {
        abort_unless((is_int($revision) || (is_string($revision) && preg_match('/^\d+$/', $revision))) && (int) $revision >= 0 && (int) $revision === $job->revision, 409,
            'This custom request changed in another session. Your entries are still here. Review the latest details before saving.');
    }

    public static function event(AppointmentProductJob $job, string $action, string $description, ?int $actor, array $metadata = []): void
    {
        $event = DB::table('appointment_product_events')->insertGetId(['job_id' => $job->id, 'actor_id' => $actor, 'action' => $action,
            'description' => $description, 'metadata' => $metadata ? json_encode($metadata) : null, 'created_at' => now()]);
        if ($job->appointment_id && $action !== 'booked') {
            OrderNotifier::notifyAdmins('appointment', 'Custom product update: '.$job->appointment?->reference_no, $description,
                ['appointment_id' => $job->appointment_id, 'reference_no' => $job->appointment?->reference_no]);
            if (Schema::hasTable('customer_notifications') && Schema::hasTable('pwa_delivery_outbox')) {
                app(PwaNotifications::class)->publish($job->customer_id, 'appointment', 'Custom product update',
                    'Open your appointment to review the latest custom-product update.',
                    '/home-page/?my_appointments=1&appointment_id='.$job->appointment_id, 'appointment-product:'.$event);
            }
            if (in_array($action, ['quotation', 'outcome', 'expired', 'follow_up'], true)) {
                $email = User::find($job->customer_id)?->email;
                if ($email) {
                    OrderNotifier::afterResponse(function () use ($email, $job, $description) {
                        try {
                            Mail::html(EmailTemplate::render('appointment_product_update', ['client_name' => $job->appointment?->first_name ?? 'Customer', 'reference_no' => $job->appointment?->reference_no, 'update' => $description], '<p><a href="'.e(url('/home-page').'/?my_appointments=1&appointment_id='.$job->appointment_id).'">View your appointment</a></p>'), fn ($m) => $m->to($email)->subject('FMRC appointment update'));
                        } catch (\Throwable $e) {
                            Log::warning('Appointment product email unavailable', ['job_id' => $job->id]);
                        }
                    });
                }
            }
        }
    }

    public static function touch(AppointmentProductJob $job): void
    {
        $job->revision++;
        $job->save();
    }

    public static function files(AppointmentProductJob $job, array $stored, ?int $message = null): void
    {
        foreach ($stored as $file) {
            DB::table('appointment_product_files')->insert($file + ['job_id' => $job->id, 'message_id' => $message]);
        }
    }

    /** Called inside the existing booking transaction and schedule lock. */
    public static function booked(Appointment $appointment, array $input, int $customer, string $key, ?int $draftId, mixed $revision, array $stored): AppointmentProductJob
    {
        $job = $draftId ? AppointmentProductJob::where('customer_id', $customer)->whereKey($draftId)->lockForUpdate()->firstOrFail() : null;
        $brief = self::customerBrief($input, false, $job?->requirements ?? [], $appointment->additional_notes);
        $service = self::eligible($brief['service_id']);
        if ($job) {
            self::version($job, $revision);
            abort_unless($job->state === 'draft' && ! $job->appointment_id, 409, 'This draft has already been booked. Open its appointment.');
            $existing = DB::table('appointment_product_files')->where('job_id', $job->id);
            abort_if((clone $existing)->count() + count($stored) > 5 || (clone $existing)->sum('size') + array_sum(array_column($stored, 'size')) > 50 * 1024 * 1024,
                422, 'Keep up to five design files, 50 MB combined. Remove a saved file before adding another.');
            $job->fill(['requirements' => $brief, 'service_id' => $service->id, 'service_name' => $service->title, 'appointment_id' => $appointment->id, 'state' => 'awaiting_consultation']);
            self::touch($job);
        } else {
            $job = AppointmentProductJob::create(['customer_id' => $customer, 'appointment_id' => $appointment->id, 'service_id' => $service->id,
                'service_name' => $service->title, 'request_key' => $key, 'requirements' => $brief, 'state' => 'awaiting_consultation', 'revision' => 0]);
        }
        $appointment->forceFill(['product_job_id' => $job->id])->save();
        self::files($job, $stored);
        self::event($job, 'booked', 'Custom-product consultation booked.', $customer);

        return $job;
    }

    public static function protectAppointment(Appointment $appointment, bool $archive = false): void
    {
        abort_if($appointment->getAttribute('product_job_id') && !self::installed(),503,'Custom-product history is temporarily unavailable. Retain this appointment until the installation is ready.');
        $job = self::jobFor($appointment);
        if (! $job) {
            return;
        }
        if (! $archive) {
            abort(422, 'This appointment retains custom-product history. Archive it when the work is closed.');
        }
        $state = AppointmentWorkState::for($appointment, $job);
        abort_unless($state['can_archive'], 422, $state['archive_blocked_reason']);
    }

    public static function protectAccount(User $user): void
    {
        foreach (['appointment_product_jobs' => 'customer_id', 'appointment_product_quotes' => 'created_by', 'appointment_product_messages' => 'sender_id', 'appointment_cash_entries' => 'actor_id'] as $table => $key) {
            if (Schema::hasTable($table)) {
                abort_if(DB::table($table)->where($key, $user->id)->exists(), 422, 'This account retains a custom-product agreement or receipt and cannot be permanently deleted.');
            }
        }
    }

    public static function protectOrderArchive(Order $order): void
    {
        if (! self::custom($order)) {
            return;
        }
        abort_unless(in_array($order->lifecycle_status, ['completed', 'cancelled', 'rejected'], true), 422, 'Complete or close this custom order before archiving.');
        abort_if($order->hasPendingCancellation() || ($order->lifecycle_status !== 'completed' && self::moneyHeld($order) > 0), 422, 'Resolve the cancellation and refund before archiving this order.');
        if (GatewayPayments::managed($order->payment)) {
            abort_if(DB::table('payment_refunds')->where('payment_id', $order->payment->id)->whereIn('status', ['requested', 'submitting', 'pending', 'unknown'])->exists(), 422, 'Wait for the refund to finish before archiving.');
        }
    }

    public static function cashHeld(Payment $payment): int
    {
        if (! Schema::hasTable('appointment_cash_entries')) {
            return 0;
        }

        return (int) DB::table('appointment_cash_entries')->where('payment_id', $payment->id)
            ->selectRaw("COALESCE(SUM(CASE WHEN kind = 'receipt' THEN amount_centavos ELSE -amount_centavos END),0) as balance")->value('balance');
    }

    public static function moneyHeld(Order $order): int
    {
        $p = $order->payment;
        if (! $p) {
            return 0;
        }
        if ($p->method === 'Cash at FMRC') {
            return self::cashHeld($p);
        }

        return (int) DB::table('payment_receipts')->where('payment_id', $p->id)->sum('amount_centavos')
            - (int) DB::table('payment_refunds')->where('payment_id', $p->id)->where('status', 'succeeded')->sum('amount_centavos');
    }

    public static function paid(Order $order): bool
    {
        $p = $order->payment;
        if (! $p || $p->status !== 'paid' || self::moneyHeld($order) !== GatewayPayments::centavos($order->total)) {
            return false;
        }
        if (GatewayPayments::managed($p)) {
            if (DB::table('payment_refunds')->where('payment_id', $p->id)->whereNotIn('status', ['failed', 'rejected'])->exists()) {
                return false;
            }
            if (app()->environment('production') && ! DB::table('payment_receipts')->where('payment_id', $p->id)->where('livemode', true)->exists()) {
                return false;
            }
        }

        return $order->appointment_production_status !== 'payment_review' && ! $order->collection_hold;
    }

    public static function assertPayable(Order $order): void
    {
        if (! self::custom($order)) {
            return;
        }
        abort_unless(self::installed(), 503, 'Custom-order payment is temporarily unavailable. Please contact FMRC.');
        abort_if($order->collection_hold, 422, 'The previous payment is being reconciled. Finish that action before opening or recording another payment.');
        $q = AppointmentProductQuote::findOrFail($order->appointment_product_quote_id);
        abort_unless($q->state === 'accepted' && $q->expires_at->isFuture() && ! in_array($order->lifecycle_status, ['cancelled', 'rejected', 'completed'], true), 422,
            'This quotation is no longer payable. Open your appointment for the latest quotation.');
    }

    public static function assertProduction(Order $order, bool $ready = false): void
    {
        if (! self::custom($order)) {
            return;
        }
        abort_unless(self::installed(), 503, 'Custom-order production is temporarily unavailable.');
        $q = AppointmentProductQuote::find($order->appointment_product_quote_id);
        abort_unless($q && $q->state === 'accepted' && $q->accepted_at && self::paid($order) && ! $order->hasPendingCancellation()
            && ! in_array($order->lifecycle_status, ['cancelled', 'rejected', 'completed'], true), 422,
            'Production requires the accepted quotation and confirmed full payment, with no unresolved cancellation or refund.');
        if ($ready) {
            abort_unless($order->appointment_production_status === 'ready', 422, 'Mark the custom product ready before pickup or J&T handover.');
        }
    }

    /** A timeout never means an old checkout is safe to replace. */
    public static function closeCheckout(Order $order): void
    {
        $payment = $order->payment;
        if (! $payment || ! GatewayPayments::managed($payment)) {
            return;
        }
        $gateway = app(GatewayPayments::class);
        $attempt = $gateway->attempt($payment);
        if (! $attempt) {
            return;
        }
        if (! $attempt->checkout_id && in_array($attempt->status, ['creating', 'unknown'], true)) {
            $gateway->createSession($attempt, true);
            $attempt = DB::table('payment_attempts')->find($attempt->id);
        }
        abort_if(! $attempt->checkout_id && ! in_array($attempt->status, ['failed', 'expired'], true), 422,
            'The previous checkout is still being checked. Do not collect another payment. Try again after reconciliation.');
        if (! $attempt->checkout_id || $attempt->status === 'expired') {
            return;
        }
        $provider = app(PayMongoService::class);
        $session = $provider->retrieveCheckoutSession($attempt->checkout_id);
        abort_unless(isset($session['data']), 422, 'The payment provider could not confirm the old checkout. Try again; do not collect another payment.');
        $gateway->applySession($attempt->id, $session['data']);
        $order->refresh();
        abort_if(self::moneyHeld($order) > 0, 422, 'Payment has been received. Review cancellation and refund before replacing this agreement.');
        if (($session['data']['attributes']['status'] ?? '') !== 'expired') {
            $provider->request('POST', 'v1/checkout_sessions/'.$attempt->checkout_id.'/expire');
            $session = $provider->retrieveCheckoutSession($attempt->checkout_id);
            if (isset($session['data'])) {
                $gateway->applySession($attempt->id, $session['data']);
            }
        }
        abort_unless(($session['data']['attributes']['status'] ?? '') === 'expired', 422,
            'The previous payment may still be processing. Wait for confirmation before collecting a replacement payment.');
        DB::table('payment_attempts')->where('id', $attempt->id)->update(['status' => 'expired', 'updated_at' => now()]);
    }

    public static function onlinePaymentAvailable(): bool
    {
        return \App\Support\PaymentMethodAvailability::isEnabled('GCash')
            && app(PayMongoService::class)->acceptsNewPayments();
    }

    public static function orderStage(Order $order): string
    {
        return match (true) {
            $order->lifecycle_status === 'completed' => 'Completed', $order->lifecycle_status === 'cancelled' => 'Cancelled', $order->lifecycle_status === 'rejected' => 'Closed',
            $order->appointment_production_status === 'payment_review' => 'Payment needs review', $order->customer_stage === 'to_receive' && ! $order->isPickup() => 'In transit',
            $order->appointment_production_status === 'ready' => $order->isPickup() ? 'Ready for pickup' : 'Ready for shipping',
            $order->appointment_production_status === 'in_production' => 'In production', self::paid($order) => 'Paid — Awaiting Production', default => 'Awaiting payment'
        };
    }

    public static function orderData(Order $order): array
    {
        if (! self::custom($order)) {
            return ['order_type' => 'regular'];
        }
        if (! self::installed()) {
            return ['order_type' => 'custom', 'custom_product' => ['unavailable' => true, 'stage' => 'Details temporarily unavailable']];
        }
        $job = AppointmentProductJob::find($order->appointment_product_job_id);
        $q = AppointmentProductQuote::find($order->appointment_product_quote_id);
        $status = self::orderStage($order);
        $operator = in_array(auth()->user()?->role, ['admin', 'staff'], true);
        $admin = auth()->user()?->role === 'admin';

        return ['order_type' => 'custom', 'custom_product' => ['job_id' => $job?->id, 'appointment_id' => $job?->appointment_id,
            'appointment_reference' => $job?->appointment?->reference_no, 'service' => $job?->service_name, 'quotation_version' => $q?->version,
            'meeting' => $operator && $job?->appointment ? AppointmentScheduling::meetingData($job->appointment, true) : null,
            'agreement' => $q?->agreement, 'stage' => $status, 'production_status' => $order->appointment_production_status, 'collection_pending' => (bool) $order->collection_hold, 'revision' => (int) $order->production_revision,
            'online_payment_available' => self::onlinePaymentAvailable(),
            'available_actions' => ['record_cash' => $operator && ! $order->collection_hold && $order->payment_method === 'Cash at FMRC' && $order->payment?->status === 'pending' && $q?->state === 'accepted' && $q->expires_at->isFuture() && ! in_array($order->lifecycle_status, ['cancelled', 'rejected', 'completed']),
                'start_production' => $operator && self::paid($order) && $order->lifecycle_status === 'incoming' && ! $order->hasPendingCancellation() && $q?->state === 'accepted',
                'mark_ready' => $operator && self::paid($order) && $order->appointment_production_status === 'in_production' && ! $order->hasPendingCancellation(),
                'correct_cash' => $admin && $order->payment && $order->payment_method === 'Cash at FMRC' && self::cashHeld($order->payment) > 0 && ! $order->approved_at && $order->lifecycle_status === 'incoming',
                'refund_cash' => $admin && $order->payment && $order->payment_method === 'Cash at FMRC' && self::cashHeld($order->payment) > 0 && in_array($order->lifecycle_status, ['cancelled', 'rejected'], true),
                'collect' => $operator && self::paid($order) && $order->isPickup() && $order->appointment_production_status === 'ready' && $order->lifecycle_status === 'pending' && ! $order->hasPendingCancellation()],
            'cash_balance_centavos' => $order->payment?->method === 'Cash at FMRC' ? self::cashHeld($order->payment) : 0,
            'cash_entries' => $order->payment ? DB::table('appointment_cash_entries')->where('payment_id', $order->payment->id)->get(['id', 'kind', 'amount_centavos', 'receipt_reference', 'confirmed_at', 'note'])->all() : []]];
    }

    public static function present(AppointmentProductJob $job): array
    {
        $orders = $job->orders()->orderByDesc('id')->get();
        $order = $orders->first();
        $quotes = $job->quotes()->orderByDesc('version')->get();
        $current = $quotes->first(fn ($q) => in_array($q->state, ['sent', 'accepted', 'closing'], true));
        $stage = $order && ! in_array($order->lifecycle_status, ['cancelled', 'rejected'], true) ? self::orderData($order)['custom_product']['stage']
            : (self::LABELS[$job->state] ?? 'Reviewing requirements');
        $progress = $job->state;
        if ($order && ! in_array($order->lifecycle_status, ['cancelled', 'rejected'], true)) {
            $progress = match (true) {
                $order->lifecycle_status === 'completed' => 'completed', $order->appointment_production_status === 'payment_review' => 'payment_review',
                $order->customer_stage === 'to_receive' && ! $order->isPickup() => 'in_transit', $order->appointment_production_status === 'ready' => 'ready',
                $order->appointment_production_status === 'in_production' => 'in_production',self::paid($order) => 'awaiting_production',default => 'awaiting_payment'
            };
        }
        $next = match (true) {
            (bool) $order && ! in_array($order->lifecycle_status, ['cancelled', 'rejected'], true) => $order->payment?->status === 'pending' ? 'Complete full payment in My Orders.' : 'Follow production and fulfillment in My Orders.',
            (bool) $current && $current->state === 'sent' && $current->expires_at->isFuture() => 'Review your quotation and approved design before paying.',
            $job->state === 'draft' => 'Finish your details and choose an available appointment.',
            $job->state === 'awaiting_consultation' => 'Attend your consultation. The FMRC team will discuss your idea before quoting.',
            $job->state === 'follow_up' => 'Choose an available follow-up appointment.',
            $job->state === 'needs_information' => 'Provide the requested details in the conversation.',
            in_array($job->state, ['cancelled', 'declined'], true) => 'This custom request is closed. Your appointment history remains available.',
            default => 'The FMRC team is finalizing your specifications and quotation.'
        };

        return ['id' => $job->id, 'online_payment_available' => self::onlinePaymentAvailable(), 'appointment_id' => $job->appointment_id, 'service_id' => $job->service_id, 'service_name' => $job->service_name,
            'state' => $job->state, 'progress' => $progress, 'stage' => $stage, 'revision' => (int) $job->revision, 'request_key' => $job->request_key,
            'requirements' => self::customerBriefView($job->requirements ?? [], $job->booking['aptDesc'] ?? null, $job->appointment?->additional_notes), 'booking' => $job->booking,
            'next_action' => $next, 'outcome_note' => $job->outcome_note, 'discussed_at' => $job->discussed_at?->toIso8601String(),
            'files' => DB::table('appointment_product_files')->where('job_id', $job->id)->get(['id', 'name', 'size', 'message_id'])->all(),
            'messages' => DB::table('appointment_product_messages')->where('job_id', $job->id)->orderBy('id')
                ->get(['id', 'sender_id', 'sender_name', 'sender_role', 'body', 'request_key', 'created_at'])
                ->map(function ($message) {
                    $message->client_request_key = (int) $message->sender_id === (int) auth()->id() ? $message->request_key : null;
                    unset($message->request_key);

                    return $message;
                })->all(),
            'quotations' => $quotes->map(fn ($q) => ['id' => $q->id, 'version' => $q->version, 'state' => $q->state, 'agreement' => $q->agreement,
                'expires_at' => $q->expires_at->toIso8601String(), 'accepted_at' => $q->accepted_at?->toIso8601String(), 'sent_at' => $q->sent_at->toIso8601String()])->all(),
            'orders' => $orders->map(fn ($o) => ['id' => $o->id, 'order_no' => $o->order_no, 'lifecycle_status' => $o->lifecycle_status,
                'payment_status' => $o->payment?->status, 'payment_method' => $o->payment_method, 'total' => (float) $o->total] + self::orderData($o))->all(),
            'follow_ups' => Appointment::where('product_job_id',$job->id)->where('id','!=',$job->appointment_id)->get(['id', 'reference_no', 'appointment_date', 'appointment_time', 'status', 'appointment_method', 'schedule_version'])->all(),
            'activity' => DB::table('appointment_product_events')->where('job_id',$job->id)->orderByDesc('id')->limit(50)->get(['action', 'description', 'created_at'])->all()];
    }
}
