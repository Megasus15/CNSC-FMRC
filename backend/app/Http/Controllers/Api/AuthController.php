<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
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
            ->orderBy('created_at', 'desc')
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
            'username' => 'nullable|required_without:email|string|max:255|alpha_dash|unique:users,username',
            'email' => 'nullable|required_without:username|string|email|max:255|regex:/^[A-Za-z0-9._%+-]+@gmail\.com$/i|unique:users,email',
            'role' => 'required|in:customer,cashier,staff',
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
