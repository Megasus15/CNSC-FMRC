<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class AuthController extends Controller
{
    private const ALLOWED_CUSTOMER_TYPES = [
        'Student',
        'Educator',
        'Cooperatives',
        'Business',
        'Researcher',
        'Association',
        'Others',
    ];

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
            'username' => 'required_without:email|string|max:255|unique:users',
            'email' => 'required_without:username|string|email|max:255|unique:users',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::create([
            'name' => $request->name,
            'username' => $request->username,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => 'customer',
        ]);

        $token = $user->createToken('auth_token')->plainTextToken;

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

        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'message' => 'Login successful',
            'user' => $user,
            'access_token' => $token,
            'token_type' => 'Bearer',
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->tokens()->delete();

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

        $users = User::query()
            ->select(['id', 'name', 'username', 'email', 'role', 'created_at'])
            ->orderBy('created_at', 'asc')
            ->get();

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

        $user = User::create([
            'name' => $validated['name'],
            'username' => $validated['username'] ?? null,
            'email' => $validated['email'] ?? null,
            'password' => Hash::make($validated['password']),
            'role' => $validated['role'],
        ]);

        return response()->json([
            'message' => 'User account created successfully.',
            'data' => $user,
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
    
    // Change password function
    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'required',
            'new_password' => 'required|string|min:8|confirmed',
        ]);

        $user = $request->user();

        if (!Hash::check($request->current_password, $user->password)) {
            return response()->json(['message' => 'Current password does not match'], 400);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return response()->json(['message' => 'Password changed successfully']);
    }
}
