<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\StaffAccountRequestApproved;
use App\Mail\StaffAccountRequestRejected;
use App\Models\StaffAccountRequest;
use App\Models\User;
use App\Support\OrderNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;

/**
 * Staff-account applications: public submission, admin decision.
 *
 * The portal has no self-service sign-up for staff -- only the admin could
 * create one, which meant every new staff member had to hand their chosen
 * password to the admin over chat. This flow inverts that: the applicant picks
 * their own credentials, only the bcrypt hash is stored, and approval simply
 * promotes that hash into a real `users` row. The admin never sees the password
 * and nothing plaintext is ever written down.
 *
 * Every endpoint fails soft when the table has not been installed on the server
 * yet (a Hostinger deploy copies files and never runs migrations), so the form
 * and the queue both say "not installed" instead of returning a 500.
 */
class StaffAccountRequestController extends Controller
{
    /**
     * Accepted submissions per IP per hour. Only a submission that actually
     * creates a row is counted -- a visitor correcting a validation error is not
     * spending their allowance, but somebody flooding the admin's queue is.
     */
    private const MAX_SUBMISSIONS_PER_HOUR = 5;

    private const THROTTLE_DECAY_SECONDS = 3600;

    private ?bool $googlePasswordStateSupported = null;

    /**
     * Public: submit an application for a staff account.
     *
     * Guarded by Turnstile on the route (the same challenge /register and /login
     * carry) and by an IP throttle here. Nothing sensitive comes back -- the
     * response deliberately does not confirm whether the Gmail already has an
     * account, so this cannot be used to enumerate staff.
     */
    public function store(Request $request): JsonResponse
    {
        if (!StaffAccountRequest::tableReady()) {
            return response()->json([
                'installed' => false,
                'message' => 'Account requests are not enabled on this server yet. '
                    . 'Please contact the FMRC office so an administrator can create your account directly.',
            ], 503);
        }

        $throttleKey = 'staff-account-request:' . sha1((string) $request->ip());
        if (RateLimiter::tooManyAttempts($throttleKey, self::MAX_SUBMISSIONS_PER_HOUR)) {
            return response()->json([
                'message' => 'You have submitted several requests already. Please wait before sending another one.',
                'retry_after_seconds' => RateLimiter::availableIn($throttleKey),
            ], 429);
        }

        // Mirrors AuthController::register() so an approved applicant can never
        // fail to sign in on a rule this form did not enforce.
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'username' => 'required|string|min:3|max:50|alpha_dash|unique:users,username',
            'email' => [
                'required',
                'string',
                'email:rfc,dns',
                'max:255',
                'regex:/^[a-zA-Z0-9._%+-]+@gmail\.com$/i',
                'unique:users,email',
            ],
            'password' => 'required|string|min:8|confirmed',
        ], [
            'name.required' => 'Please enter your full name.',
            'username.required' => 'Please choose a username.',
            'username.min' => 'Username must be at least 3 characters.',
            'username.alpha_dash' => 'Username may only contain letters, numbers, dashes and underscores.',
            'username.unique' => 'This username is already taken. Please choose another one.',
            'email.unique' => 'This Gmail address already has an account. Try signing in instead.',
            'email.regex' => 'Please provide a valid @gmail.com address.',
            'email.email' => 'The provided email address is invalid or unreachable.',
            'password.min' => 'Password must be at least 8 characters.',
            'password.confirmed' => 'Password confirmation does not match.',
        ]);

        $name = trim((string) $validated['name']);
        $username = trim((string) $validated['username']);
        $email = strtolower(trim((string) $validated['email']));

        // "One pending request per person" lives here rather than in a unique
        // index, because a REJECTED applicant must be able to apply again and an
        // index cannot tell the two apart. Returning it in `errors` keeps the
        // message on the offending field in the modal.
        if ($clash = $this->pendingClash($email, $username)) {
            return response()->json([
                'message' => 'You already have a request waiting for review.',
                'errors' => $clash,
            ], 422);
        }

        $row = StaffAccountRequest::create([
            'name' => $name,
            'username' => $username,
            'email' => $email,
            // Bcrypt only. The plaintext password is never stored, never logged,
            // and never shown to the administrator who approves the request.
            'password_hash' => Hash::make((string) $validated['password']),
            'status' => StaffAccountRequest::STATUS_PENDING,
            'request_ip' => substr((string) $request->ip(), 0, 45),
        ]);

        RateLimiter::hit($throttleKey, self::THROTTLE_DECAY_SECONDS);

        // notifyAdmins() swallows its own failures, so a notification problem can
        // never lose a request that is already stored.
        OrderNotifier::notifyAdmins(
            'account_request',
            'New staff account request',
            "{$name} ({$email}) is requesting a staff account. Review it on Accounts Management.",
            ['staff_account_request_id' => $row->id],
        );

        Log::info("Staff account request #{$row->id} submitted for {$email}");

        return response()->json([
            'installed' => true,
            'message' => 'Your request has been submitted. An administrator will review it and email you the decision.',
        ], 201);
    }

    /**
     * Admin: the approval queue. Pending first, newest first inside each group,
     * so the thing that needs a decision is always at the top.
     */
    public function index(Request $request): JsonResponse
    {
        if ($forbidden = $this->ensureAdmin($request)) {
            return $forbidden;
        }

        if (!StaffAccountRequest::tableReady()) {
            return response()->json([
                'installed' => false,
                'data' => [],
                'counts' => ['pending' => 0, 'approved' => 0, 'rejected' => 0, 'total' => 0],
            ]);
        }

        $status = strtolower(trim((string) $request->query('status', '')));

        $query = StaffAccountRequest::query()->with('reviewer');
        if ($status !== '' && $status !== 'all' && StaffAccountRequest::isKnownStatus($status)) {
            $query->where('status', $status);
        }

        $rows = $query
            ->orderByRaw("CASE WHEN status = '" . StaffAccountRequest::STATUS_PENDING . "' THEN 0 ELSE 1 END")
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $grouped = StaffAccountRequest::query()
            ->selectRaw('status, COUNT(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');

        return response()->json([
            'installed' => true,
            'data' => $rows->map(fn (StaffAccountRequest $row) => $row->toQueueArray())->values(),
            'counts' => [
                'pending' => (int) ($grouped[StaffAccountRequest::STATUS_PENDING] ?? 0),
                'approved' => (int) ($grouped[StaffAccountRequest::STATUS_APPROVED] ?? 0),
                'rejected' => (int) ($grouped[StaffAccountRequest::STATUS_REJECTED] ?? 0),
                'total' => (int) $grouped->sum(),
            ],
        ]);
    }

    /**
     * Admin: approve a request, creating the staff account.
     *
     * The stored bcrypt hash moves straight into the new `users` row. That is
     * safe *and* the applicant's originally typed password still works: the
     * `hashed` cast calls Hash::make() only when the value is not already a hash.
     * Nothing here needs, or ever had, the plaintext.
     */
    public function approve(Request $request, string $id): JsonResponse
    {
        if ($forbidden = $this->ensureAdmin($request)) {
            return $forbidden;
        }

        if ($unavailable = $this->ensureInstalled()) {
            return $unavailable;
        }

        $row = StaffAccountRequest::find((int) $id);
        if (!$row) {
            return response()->json(['message' => 'That account request no longer exists.'], 404);
        }

        if ($conflict = $this->ensureStillPending($row)) {
            return $conflict;
        }

        $email = strtolower(trim((string) $row->email));
        $username = trim((string) $row->username);

        // The request may have sat in the queue while somebody else claimed the
        // same Gmail or username. Re-check now rather than let User::create()
        // fail on a database constraint.
        if ($taken = $this->claimedSinceSubmission($email, $username)) {
            return response()->json([
                'message' => $taken,
                'status' => $row->status,
            ], 409);
        }

        $passwordHash = (string) $row->password_hash;
        if ($passwordHash === '') {
            return response()->json([
                'message' => 'This request no longer carries a password, so an account cannot be created from it. '
                    . 'Ask the applicant to submit a new request.',
            ], 422);
        }

        $reviewer = $request->user();

        $user = DB::transaction(function () use ($row, $email, $username, $passwordHash, $reviewer): User {
            $created = User::create($this->withGooglePasswordState([
                'name' => trim((string) $row->name),
                'username' => $username,
                'email' => $email,
                // Already a bcrypt hash; the `hashed` cast passes it through.
                'password' => $passwordHash,
                'role' => 'staff',
            ], false, true));

            $row->update([
                'status' => StaffAccountRequest::STATUS_APPROVED,
                // The credential has served its purpose. Keeping it would turn the
                // decided queue into a pile of reusable password hashes.
                'password_hash' => null,
                'decision_note' => null,
                'reviewed_by' => $reviewer?->id,
                'reviewed_at' => now(),
                'created_user_id' => $created->id,
            ]);

            return $created;
        });

        Log::info("Staff account request #{$row->id} approved; created user #{$user->id} ({$email})");

        $this->sendDecisionEmail($row->fresh() ?? $row, StaffAccountRequest::STATUS_APPROVED);

        return response()->json([
            'message' => 'Staff account approved successfully.',
            'data' => $row->fresh()?->toQueueArray(),
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'role' => $user->role,
            ],
        ]);
    }

    /**
     * Admin: reject a request. No account is created; the optional note is quoted
     * back to the applicant in the decision email.
     */
    public function reject(Request $request, string $id): JsonResponse
    {
        if ($forbidden = $this->ensureAdmin($request)) {
            return $forbidden;
        }

        if ($unavailable = $this->ensureInstalled()) {
            return $unavailable;
        }

        $validated = $request->validate([
            'note' => 'nullable|string|max:300',
        ], [
            'note.max' => 'Please keep the reason to 300 characters or fewer.',
        ]);

        $row = StaffAccountRequest::find((int) $id);
        if (!$row) {
            return response()->json(['message' => 'That account request no longer exists.'], 404);
        }

        if ($conflict = $this->ensureStillPending($row)) {
            return $conflict;
        }

        $note = trim((string) ($validated['note'] ?? ''));

        $row->update([
            'status' => StaffAccountRequest::STATUS_REJECTED,
            'password_hash' => null,
            'decision_note' => $note !== '' ? $note : null,
            'reviewed_by' => $request->user()?->id,
            'reviewed_at' => now(),
        ]);

        Log::info("Staff account request #{$row->id} rejected ({$row->email})");

        $this->sendDecisionEmail($row->fresh() ?? $row, StaffAccountRequest::STATUS_REJECTED);

        return response()->json([
            'message' => 'Account request rejected.',
            'data' => $row->fresh()?->toQueueArray(),
        ]);
    }

    /**
     * Admin only -- staff are excluded on purpose.
     *
     * Accounts Management is already admin-only in the browser
     * (accounts.js bounces a staff session off the page), so the API has to agree
     * or the restriction would be cosmetic. Same shape and wording as
     * AuthController::ensureAdmin().
     */
    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor || $actor->role !== 'admin') {
            return response()->json([
                'message' => 'Forbidden. Admin access is required.',
            ], 403);
        }

        return null;
    }

    /**
     * 503 for the write endpoints when the table has not been installed.
     *
     * index() answers 200 with `installed: false` instead, because an admin
     * loading the page is not an error -- but approving a row that cannot exist
     * is.
     */
    private function ensureInstalled(): ?JsonResponse
    {
        if (StaffAccountRequest::tableReady()) {
            return null;
        }

        return response()->json([
            'installed' => false,
            'message' => 'Account requests are not enabled on this server yet. '
                . 'Run the database install script, then reload this page.',
        ], 503);
    }

    /**
     * Guard against two admins deciding the same row, or one admin
     * double-clicking. The already-recorded status comes back so the page can
     * refresh itself instead of guessing.
     */
    private function ensureStillPending(StaffAccountRequest $row): ?JsonResponse
    {
        if ($row->isPending()) {
            return null;
        }

        return response()->json([
            'message' => 'This request has already been ' . $row->status . '.',
            'status' => $row->status,
        ], 409);
    }

    /**
     * Is there already a PENDING request holding this Gmail or username?
     *
     * Returns a Laravel-shaped `errors` array so the modal can put the message
     * under the offending input instead of in a banner. Decided rows are ignored
     * on purpose: a rejected applicant is allowed to try again.
     */
    private function pendingClash(string $email, string $username): ?array
    {
        $pending = StaffAccountRequest::query()
            ->where('status', StaffAccountRequest::STATUS_PENDING)
            ->where(function ($query) use ($email, $username) {
                $query->whereRaw('LOWER(email) = ?', [$email])
                    ->orWhereRaw('LOWER(username) = ?', [strtolower($username)]);
            })
            ->first();

        if (!$pending) {
            return null;
        }

        $errors = [];

        if (strtolower((string) $pending->email) === $email) {
            $errors['email'] = ['A request for this Gmail address is already awaiting review. '
                . 'Please wait for the administrator\'s decision email.'];
        }

        if (strtolower((string) $pending->username) === strtolower($username)) {
            $errors['username'] = ['This username is already reserved by a request awaiting review.'];
        }

        // Belt and braces: the row matched, so at least one message must exist
        // even if the columns were edited by hand in the database.
        return $errors !== [] ? $errors : ['email' => ['You already have a request awaiting review.']];
    }

    /**
     * Did somebody claim this Gmail or username while the request waited?
     *
     * Checked again at approval time so User::create() cannot fail on a unique
     * index and leave the admin looking at a 500.
     */
    private function claimedSinceSubmission(string $email, string $username): ?string
    {
        if (User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return 'That Gmail address now belongs to an existing account, so this request '
                . 'cannot be approved. Reject it and ask the applicant to use "Forgot Password?" instead.';
        }

        if (User::query()->whereRaw('LOWER(username) = ?', [strtolower($username)])->exists()) {
            return 'That username was taken by another account while this request was waiting. '
                . 'Reject it and ask the applicant to submit a new request with a different username.';
        }

        return null;
    }

    /**
     * Are the Google-sign-in bookkeeping columns deployed on this server?
     *
     * Same probe AuthController carries, for the same reason: `users` gained
     * these two columns in a migration that a file-copy deploy never ran.
     */
    private function supportsGooglePasswordState(): bool
    {
        return $this->googlePasswordStateSupported ??= Schema::hasColumn('users', 'signed_with_google')
            && Schema::hasColumn('users', 'has_custom_password');
    }

    /**
     * An approved applicant chose their own password and never touched Google, so
     * the flags are always (false, true) -- exactly what register() records.
     */
    private function withGooglePasswordState(
        array $attributes,
        bool $signedWithGoogle,
        bool $hasCustomPassword,
    ): array {
        if ($this->supportsGooglePasswordState()) {
            $attributes['signed_with_google'] = $signedWithGoogle;
            $attributes['has_custom_password'] = $hasCustomPassword;
        }

        return $attributes;
    }

    /**
     * Email the applicant the decision, after the response has been flushed.
     *
     * Deferred through OrderNotifier::afterResponse() because Hostinger runs no
     * queue worker -- an SMTP round trip would otherwise sit in front of the
     * admin's click. The try/catch matters more than the deferral: approval has
     * already written a `users` row by this point, so a mail failure must never
     * bubble up and make a completed decision look like an error.
     */
    private function sendDecisionEmail(StaffAccountRequest $row, string $decision): void
    {
        $email = trim((string) $row->email);
        if ($email === '') {
            return;
        }

        $mailable = $decision === StaffAccountRequest::STATUS_APPROVED
            ? new StaffAccountRequestApproved($row)
            : new StaffAccountRequestRejected($row);

        OrderNotifier::afterResponse(function () use ($email, $mailable, $row, $decision): void {
            try {
                Mail::to($email)->send($mailable);
            } catch (\Throwable $e) {
                Log::error("Staff account request #{$row->id} {$decision} email failed: " . $e->getMessage());
            }
        });
    }
}
