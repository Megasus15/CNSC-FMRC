<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

class AuthController extends Controller
{
    private ?bool $googlePasswordStateSupported = null;

    private const ALLOWED_CUSTOMER_TYPES = [
        'Student',
        'Educator',
        'Cooperatives',
        'Business',
        'Researcher',
        'Association',
        'Others',
    ];

    private function supportsGooglePasswordState(): bool
    {
        return $this->googlePasswordStateSupported ??= Schema::hasColumn('users', 'signed_with_google')
            && Schema::hasColumn('users', 'has_custom_password');
    }

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

    private function exposeGooglePasswordStateFallback(User $user): void
    {
        if (!$this->supportsGooglePasswordState()) {
            // Keep production usable before the migration is deployed. The
            // reminder remains disabled until its state can be persisted.
            $user->setAttribute('signed_with_google', false);
            $user->setAttribute('has_custom_password', true);
        }
    }

    private function ensureAdmin(Request $request): ?\Illuminate\Http\JsonResponse
    {
        $actor = $request->user();
        if (!$actor || $actor->role !== 'admin') {
            return response()->json([
                'message' => 'Forbidden. Admin access is required.',
            ], 403);
        }

        return null;
    }

    public function register(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'username' => 'required|string|min:3|max:50|unique:users,username',
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
            'email.unique' => 'This Gmail address is already registered. Please log in or use another account.',
            'email.regex' => 'Please provide a valid @gmail.com address.',
            'email.email' => 'The provided email address is invalid or unreachable.',
            'username.unique' => 'This username is already taken. Please choose another one.',
        ]);

        $user = User::create($this->withGooglePasswordState([
            'name' => $request->name,
            'username' => $request->username,
            'email' => strtolower(trim($request->email)),
            'password' => Hash::make($request->password),
            'role' => 'customer',
        ], false, true));

        $token = $user->createToken('auth_token')->plainTextToken;

        // --- Welcome Email ---
        $emailDispatch = null;
        try {
            $emailAddress = $user->email;
            if ($emailAddress && filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
                $emailHtml = $this->buildWelcomeEmailHtml($user);
                $userId = (string) $user->id;
                $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
                $fromName = config('mail.from.name', 'UCN-FMRC');

                $emailDispatch = function () use ($emailAddress, $emailHtml, $userId, $fromAddress, $fromName) {
                    try {
                        Mail::html($emailHtml, function ($message) use ($emailAddress, $fromAddress, $fromName) {
                            $message->to($emailAddress)
                                ->subject('Welcome to UCN-FMRC!')
                                ->from($fromAddress, $fromName);
                        });
                        Log::info("Welcome email sent to {$emailAddress} for user #{$userId}");
                    } catch (\Throwable $e) {
                        Log::error("Welcome email FAILED for user #{$userId}: " . $e->getMessage());
                    }
                };
            }
        } catch (\Throwable $e) {
            Log::error("Welcome email dispatch setup FAILED for user #{$user->id}: " . $e->getMessage());
        }

        if ($emailDispatch) {
            $this->dispatchAfterResponse($emailDispatch);
        }

        $this->exposeGooglePasswordStateFallback($user);

        return response()->json([
            'user' => $user,
            'access_token' => $token,
            'token_type' => 'Bearer',
        ]);
    }

    public function login(Request $request)
    {
        $request->validate([
            'login' => 'required|string', // username or email
            'password' => 'required|string',
        ]);

        // Support login by username OR email
        $loginField = filter_var($request->login, FILTER_VALIDATE_EMAIL) ? 'email' : 'username';

        $user = User::where($loginField, $request->login)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'message' => 'Invalid login credentials',
            ], 401);
        }

        // A successful password login proves this is a customer-usable password,
        // not the internal random password of a Google-only account.
        if ($this->supportsGooglePasswordState() && !$user->has_custom_password) {
            $user->has_custom_password = true;
            $user->save();
        }

        $token = $user->createToken('auth_token')->plainTextToken;

        $this->exposeGooglePasswordStateFallback($user);

        return response()->json([
            'message' => 'Login successful',
            'user' => $user,
            'access_token' => $token,
            'token_type' => 'Bearer',
        ]);
    }

    public function googleLogin(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'id_token' => 'nullable|string',
            'access_token' => 'nullable|string',
        ]);

        if (empty($validated['id_token']) && empty($validated['access_token'])) {
            return response()->json([
                'message' => 'A valid Google token is required.',
            ], 422);
        }

        try {
            $payload = null;

            // 1. Try resolving profile via OAuth2 access_token
            if (!empty($validated['access_token'])) {
                $userInfoRes = Http::timeout(10)
                    ->withHeaders(['Authorization' => 'Bearer ' . $validated['access_token']])
                    ->get('https://www.googleapis.com/oauth2/v3/userinfo');

                if ($userInfoRes->successful()) {
                    $payload = $userInfoRes->json();
                }
            }

            // 2. Try resolving profile via Google ID token (JWT)
            if (!$payload && !empty($validated['id_token'])) {
                $response = Http::timeout(10)->get('https://oauth2.googleapis.com/tokeninfo', [
                    'id_token' => $validated['id_token'],
                ]);

                if ($response->successful()) {
                    $payload = $response->json();
                }
            }

            if (!$payload) {
                return response()->json([
                    'message' => 'Invalid or expired Google authentication token.',
                ], 401);
            }

            $email = strtolower(trim((string) ($payload['email'] ?? '')));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return response()->json([
                    'message' => 'Could not retrieve a valid email address from Google.',
                ], 422);
            }

            $emailVerified = filter_var($payload['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN);
            if (!$emailVerified) {
                return response()->json([
                    'message' => 'Your Google email address is not verified.',
                ], 422);
            }

            $name = trim((string) ($payload['name'] ?? ''));
            $givenName = trim((string) ($payload['given_name'] ?? ''));
            $familyName = trim((string) ($payload['family_name'] ?? ''));
            if ($name === '') {
                $name = trim($givenName . ' ' . $familyName);
            }
            if ($name === '') {
                $name = ucfirst(explode('@', $email)[0]);
            }

            // The username for Google sign-in must be the First Name of the account
            $firstNameRaw = !empty($givenName) ? $givenName : (explode(' ', $name)[0] ?? '');
            $baseUsername = strtolower(preg_replace('/[^a-zA-Z0-9_]/', '', $firstNameRaw));
            if (strlen($baseUsername) < 3) {
                $fallback = strtolower(preg_replace('/[^a-zA-Z0-9_]/', '', explode('@', $email)[0]));
                $baseUsername = strlen($fallback) >= 3 ? $fallback : 'user_' . $baseUsername;
            }
            $baseUsername = substr($baseUsername, 0, 15);

            $user = User::where('email', $email)->first();

            if (!$user) {
                $username = $baseUsername;
                $counter = 1;
                while (User::where('username', $username)->exists()) {
                    $username = $baseUsername . $counter;
                    $counter++;
                }

                $user = User::create($this->withGooglePasswordState([
                    'name' => $name,
                    'username' => $username,
                    'email' => $email,
                    'password' => Hash::make(Str::random(32)),
                    'role' => 'customer',
                    'email_verified_at' => now(),
                ], true, false));

                // Send welcome email in background
                $emailHtml = $this->buildWelcomeEmailHtml($user);
                $userId = (string) $user->id;
                $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
                $fromName = config('mail.from.name', 'UCN-FMRC');

                $this->dispatchAfterResponse(function () use ($email, $emailHtml, $userId, $fromAddress, $fromName) {
                    try {
                        Mail::html($emailHtml, function ($message) use ($email, $fromAddress, $fromName) {
                            $message->to($email)
                                ->subject('Welcome to UCN-FMRC!')
                                ->from($fromAddress, $fromName);
                        });
                        Log::info("Google auth welcome email sent to {$email} for user #{$userId}");
                    } catch (\Throwable $e) {
                        Log::error("Google auth welcome email FAILED for user #{$userId}: " . $e->getMessage());
                    }
                });
            } else {
                $needsSave = false;

                if ($this->supportsGooglePasswordState() && !$user->signed_with_google) {
                    $user->signed_with_google = true;
                    $needsSave = true;
                }

                // If existing customer account has an email-like username or default name, align it to First Name
                if ($user->role === 'customer' && (empty($user->username) || str_contains($user->username, '@') || $user->username === explode('@', $email)[0])) {
                    $username = $baseUsername;
                    $counter = 1;
                    while (User::where('username', $username)->where('id', '!=', $user->id)->exists()) {
                        $username = $baseUsername . $counter;
                        $counter++;
                    }
                    $user->username = $username;
                    if (empty($user->name) || $user->name === 'User') {
                        $user->name = $name;
                    }
                    $needsSave = true;
                }

                if ($needsSave) {
                    $user->save();
                }
            }

            $token = $user->createToken('auth_token')->plainTextToken;
            $this->exposeGooglePasswordStateFallback($user);

            return response()->json([
                'message' => 'Google sign-in successful',
                'user' => $user,
                'access_token' => $token,
                'token_type' => 'Bearer',
            ]);
        } catch (\Throwable $e) {
            Log::error('Google sign-in exception: ' . $e->getMessage());
            return response()->json([
                'message' => 'Google sign-in failed. Please try again or use your password.',
            ], 500);
        }
    }

    public function logout(Request $request)
    {
        // Revoke only the token that made this request. Deleting every token of
        // the account signed the user out of all their other devices at once and
        // left those sessions holding a token that no longer existed, which the
        // customer portal could only show as an endless "reconnecting..." state.
        $token = $request->user()?->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        } elseif ($request->user()) {
            // Session-based (cookie) callers have no personal access token to
            // revoke, so fall back to clearing the account's API tokens.
            $request->user()->tokens()->delete();
        }

        return response()->json([
            'message' => 'Logged out successfully'
        ]);
    }

    // For Admin to see all registered users in both customer/admin portals.
    public function getUsers(Request $request)
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $columns = ['id', 'name', 'username', 'email', 'role', 'created_at'];
        if ($this->supportsGooglePasswordState()) {
            $columns[] = 'signed_with_google';
            $columns[] = 'has_custom_password';
        }

        $users = User::query()
            ->select($columns)
            ->orderBy('created_at', 'asc')
            ->get();

        if (!$this->supportsGooglePasswordState()) {
            $users->each(function (User $user) {
                $this->exposeGooglePasswordStateFallback($user);
            });
        }

        return response()->json([
            'data' => $users,
        ]);
    }

    // For Admin to create a system user account.
    public function adminCreateUser(Request $request)
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'username' => 'required|string|max:255|alpha_dash|unique:users,username',
            'email' => 'required|string|email|max:255|regex:/^[A-Za-z0-9._%+-]+@gmail\.com$/i|unique:users,email',
            'role' => 'required|in:customer,staff',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::create($this->withGooglePasswordState([
            'name'     => $validated['name'],
            'username' => $validated['username'] ?? null,
            'email'    => $validated['email'] ?? null,
            'password' => Hash::make($validated['password']),
            'role'     => $validated['role'],
        ], false, true));

        // --- Admin-Created Account Welcome Email ---
        $emailDispatch = null;
        try {
            $emailAddress = $user->email;
            if ($emailAddress && filter_var($emailAddress, FILTER_VALIDATE_EMAIL)) {
                $emailHtml   = $this->buildAdminCreatedAccountEmailHtml($user, $validated['password']);
                $userId      = (string) $user->id;
                $fromAddress = config('mail.from.address', 'noreply@cnsc-fmrc.edu.ph');
                $fromName    = config('mail.from.name', 'UCN-FMRC');

                $emailDispatch = function () use ($emailAddress, $emailHtml, $userId, $fromAddress, $fromName) {
                    try {
                        Mail::html($emailHtml, function ($message) use ($emailAddress, $fromAddress, $fromName) {
                            $message->to($emailAddress)
                                ->subject('Your UCN-FMRC Account Has Been Created')
                                ->from($fromAddress, $fromName);
                        });
                        Log::info("Admin-created account email sent to {$emailAddress} for user #{$userId}");
                    } catch (\Throwable $e) {
                        Log::error("Admin-created account email FAILED for user #{$userId}: " . $e->getMessage());
                    }
                };
            }
        } catch (\Throwable $e) {
            Log::error("Admin-created email dispatch setup FAILED for user #{$user->id}: " . $e->getMessage());
        }

        if ($emailDispatch) {
            $this->dispatchAfterResponse($emailDispatch);
        }

        $this->exposeGooglePasswordStateFallback($user);

        return response()->json([
            'message' => 'User account created successfully.',
            'data'    => $user,
        ], 201);
    }

    public function adminDeleteUser(Request $request, User $user)
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        if ((int) $request->user()->id === (int) $user->id) {
            return response()->json([
                'message' => 'You cannot delete your own account.',
            ], 422);
        }

        $user->tokens()->delete();
        $user->delete();

        return response()->json([
            'message' => 'User account deleted successfully.',
        ]);
    }

    public function adminDeleteUsersBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();
        $actorId = (int) $request->user()->id;

        $deletedIds = DB::transaction(function () use ($ids, $actorId): array {
            $users = User::query()
                ->whereIn('id', $ids)
                ->where('id', '!=', $actorId)
                ->get();

            $eligibleIds = $users->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
            foreach ($users as $user) {
                $user->tokens()->delete();
                $user->delete();
            }

            return $eligibleIds;
        });

        if (!$deletedIds) {
            return response()->json([
                'message' => 'No eligible user accounts were found to delete. Your own account is protected.',
            ], 404);
        }

        return response()->json([
            'action' => 'delete',
            'scope' => 'users',
            'processed_ids' => $deletedIds,
            'processed_count' => count($deletedIds),
            'skipped_ids' => array_values(array_diff($ids, $deletedIds)),
            'message' => count($deletedIds) . ' user account(s) deleted successfully.',
        ]);
    }

    public function customerProfile(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthorized.',
            ], 401);
        }

        if ($user->role !== 'customer') {
            return response()->json([
                'message' => 'Forbidden. Customer access is required.',
            ], 403);
        }

        return response()->json([
            'data' => $this->transformCustomerProfile($user),
        ]);
    }

    public function updateCustomerProfile(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthorized.',
            ], 401);
        }

        if ($user->role !== 'customer') {
            return response()->json([
                'message' => 'Forbidden. Customer access is required.',
            ], 403);
        }

        $validated = $request->validate([
            'name' => 'nullable|string|max:255',
            'phone_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9\+\-\s\(\)]+$/'],
            'address_line' => 'nullable|string|max:500',
            'address_details' => 'nullable|string|max:255',
            'department' => 'nullable|string|max:120',
            'customer_type' => 'nullable|string|max:120|in:' . implode(',', self::ALLOWED_CUSTOMER_TYPES),
        ]);

        if (array_key_exists('name', $validated)) {
            $user->name = trim((string) $validated['name']) ?: $user->name;
        }

        if (array_key_exists('phone_number', $validated)) {
            $normalizedPhone = $this->normalizePhoneNumber($validated['phone_number']);

            if ($normalizedPhone !== null && !preg_match('/^9\d{9,10}$/', $normalizedPhone)) {
                return response()->json([
                    'message' => 'Phone number must be a valid PH mobile number after +63 (ex: 9XXXXXXXXX).',
                ], 422);
            }

            $user->phone_number = $normalizedPhone;
        }

        if (array_key_exists('address_line', $validated)) {
            $user->address_line = trim((string) $validated['address_line']) ?: null;
        }

        if (array_key_exists('address_details', $validated)) {
            $user->address_details = trim((string) $validated['address_details']) ?: null;
        }

        if (array_key_exists('department', $validated)) {
            $user->department = trim((string) $validated['department']) ?: null;
        }

        if (array_key_exists('customer_type', $validated)) {
            $user->customer_type = trim((string) $validated['customer_type']) ?: null;
        }

        $user->save();

        return response()->json([
            'message' => 'Customer profile updated successfully.',
            'data' => $this->transformCustomerProfile($user),
        ]);
    }

    private function normalizePhoneNumber(?string $rawPhone): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) ($rawPhone ?? ''));
        if (!$digits) {
            return null;
        }

        if (str_starts_with($digits, '63')) {
            $digits = substr($digits, 2);
        }

        if (strlen($digits) === 11 && str_starts_with($digits, '0')) {
            $digits = substr($digits, 1);
        }

        return $digits !== '' ? $digits : null;
    }

    private function transformCustomerProfile(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username,
            'email' => $user->email,
            'phone_number' => $user->phone_number,
            'address_line' => $user->address_line,
            'address_details' => $user->address_details,
            'department' => $user->department,
            'customer_type' => $user->customer_type,
            'signed_with_google' => $this->supportsGooglePasswordState()
                ? (bool) $user->signed_with_google
                : false,
            'has_custom_password' => $this->supportsGooglePasswordState()
                ? (bool) $user->has_custom_password
                : true,
            'updated_at' => optional($user->updated_at)->toIso8601String(),
        ];
    }
    
    /**
     * Update the authenticated user's email (self profile update).
     */
    public function updateSelfProfile(Request $request)
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthorized.'], 401);
        }

        // Allow updating of email and username for the authenticated user.
        $validated = $request->validate([
            'email' => ['nullable', 'string', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@gmail\.com$/i', Rule::unique('users', 'email')->ignore($user->id)],
            'username' => ['nullable', 'string', 'max:255', 'alpha_dash', Rule::unique('users', 'username')->ignore($user->id)],
        ]);

        if (array_key_exists('email', $validated) && $validated['email']) {
            $user->email = $validated['email'];
        }

        if (array_key_exists('username', $validated) && $validated['username']) {
            $user->username = $validated['username'];
        }

        $user->save();

        return response()->json([
            'message' => 'Profile updated successfully.',
            'data' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'role' => $user->role,
                'updated_at' => optional($user->updated_at)->toIso8601String(),
            ],
        ]);
    }
    
    // Change / Set Password function (supports both standard users and Google-authenticated users)
    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'nullable|string',
            'new_password' => 'required|string|min:8|confirmed',
        ], [
            'new_password.min' => 'New password must be at least 8 characters.',
            'new_password.confirmed' => 'New password confirmation does not match.',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized.'], 401);
        }

        $passwordStateSupported = $this->supportsGooglePasswordState();
        $hasCustomPassword = !$passwordStateSupported || (bool) $user->has_custom_password;

        if ($hasCustomPassword && empty($request->current_password)) {
            return response()->json([
                'message' => 'Current password is required to change your password.',
            ], 422);
        }

        // First-time Google customers do not have a customer-created password
        // to verify. Once one has been set, every later change requires it.
        if (!empty($request->current_password)) {
            if (!Hash::check($request->current_password, $user->password)) {
                return response()->json(['message' => 'Current password does not match.'], 422);
            }
        }

        $user->password = Hash::make($request->new_password);
        if ($passwordStateSupported) {
            $user->has_custom_password = true;
        }
        $user->save();

        return response()->json([
            'message' => 'Password updated successfully. You can now use your username and password to log in.',
            'data' => [
                'signed_with_google' => $passwordStateSupported
                    ? (bool) $user->signed_with_google
                    : false,
                'has_custom_password' => true,
            ],
        ]);
    }

    private function buildWelcomeEmailHtml(User $user): string
    {
        $name    = e($user->name ?? 'Valued Customer');
        $email   = e($user->email);
        $appName = config('app.name') ?: 'UCN-FMRC';
        if (strtolower($appName) === 'laravel') {
            $appName = 'UCN-FMRC';
        }
        $year    = now()->year;
        $accent  = '#800000';

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:{$accent};padding:28px 32px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">UCN-FMRC</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Customer Portal &middot; Fabrication &amp; Manufacturing Research Center</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
    <h2 style="margin:0 0 12px;color:#1f2937;font-size:20px;font-weight:700;">Welcome to the UCN-FMRC Customer Portal, {$name}!</h2>
    <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
        We're pleased to have you on the platform. Your account has been created for the <strong>University of Camarines Norte &mdash; Fabrication and Manufacturing Research Center (UCN-FMRC)</strong>, and you can now access appointments, orders, and updates.
    </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Account Name</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$name}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 20px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Email</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$email}</span>
      </td>
    </tr>
  </table>

  <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.7;">With your new account, you can:</p>
  <ul style="margin:0 0 20px;padding-left:20px;color:#374151;font-size:14px;line-height:2;">
    <li>Browse and order fabrication products</li>
    <li>Schedule appointments with the FMRC team</li>
    <li>Track your orders in real-time</li>
    <li>Manage your profile and preferences</li>
  </ul>

  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
    If you did not create this account, please disregard this email or contact us immediately.
  </p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">
    &copy; {$year} {$appName}. All rights reserved.<br>
    This is an automated notification &mdash; please do not reply to this email.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }

    private function buildAdminCreatedAccountEmailHtml(User $user, string $plainPassword): string
    {
        $name     = e($user->name ?? 'Valued User');
        $email    = e($user->email ?? '');
        $username = e($user->username ?? $email);
        $role     = ucfirst(strtolower($user->role ?? 'customer'));
        $password = e($plainPassword);
        $appName  = config('app.name') ?: 'UCN-FMRC';
        if (strtolower($appName) === 'laravel') {
            $appName = 'UCN-FMRC';
        }
        $year   = now()->year;
        $accent = '#800000';

        $portalNote = $role === 'Staff'
            ? 'As a <strong>Staff</strong> member, you have access to the administrative dashboard for managing orders, appointments, inventory, and more.'
            : 'As a <strong>Customer</strong>, you can browse products, place orders, schedule appointments, and track your requests through the portal.';

        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:{$accent};padding:28px 32px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">UCN-FMRC</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Fabrication &amp; Manufacturing Research Center &mdash; Account Notification</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
    <h2 style="margin:0 0 8px;color:#1f2937;font-size:20px;font-weight:700;">Your Account Has Been Created, {$name}!</h2>
    <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
        An authorized administrator has created a new <strong>{$role}</strong> account for you on the
        <strong>University of Camarines Norte &mdash; Fabrication and Manufacturing Research Center (UCN-FMRC)</strong> platform.
        You may use the credentials below to access the system.
    </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Full Name</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$name}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Username</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$username}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Email Address</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$email}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f4f8;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Temporary Password</span><br>
        <span style="color:#800000;font-size:15px;font-weight:700;letter-spacing:0.04em;">{$password}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 20px;">
        <span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Account Role</span><br>
        <span style="color:#111827;font-size:15px;font-weight:700;">{$role}</span>
      </td>
    </tr>
  </table>

  <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.7;">{$portalNote}</p>

  <p style="margin:0 0 20px;padding:12px 16px;background:#fef3c7;border-left:4px solid #d97706;border-radius:6px;color:#92400e;font-size:13px;line-height:1.6;">
    <strong>Security Notice:</strong> For your protection, please change your password immediately after your first login. Do not share your credentials with anyone.
  </p>

  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
    If you believe this account was created in error, or if you did not authorize this action,
    please contact the UCN-FMRC administration team immediately.
  </p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">
    &copy; {$year} {$appName}. All rights reserved.<br>
    This is an automated system notification &mdash; please do not reply to this email.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }

    private function dispatchAfterResponse(callable $callback): void
    {
        try {
            app()->terminating(function () use ($callback) {
                if (function_exists('fastcgi_finish_request')) {
                    @fastcgi_finish_request();
                }
                $callback();
            });
        } catch (\Throwable $e) {
            if (function_exists('fastcgi_finish_request')) {
                @fastcgi_finish_request();
            }
            $callback();
        }
    }
}
