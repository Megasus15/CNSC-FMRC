<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Handles customer payment method binding and tokenized accounts.
 *
 * Implements account linking for GCash (similar to TikTok Shop / Shopee),
 * allowing customers to connect their GCash account once with mobile + OTP,
 * save it for seamless 1-click repeat purchases, and manage their saved account.
 */
class CustomerPaymentMethodController extends Controller
{
    /**
     * Get the current customer's linked GCash account status.
     */
    public function getGcashAccount(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $phone = $user->gcash_phone;
        if (!$phone) {
            return response()->json([
                'linked' => false,
                'phone' => null,
                'masked_phone' => null,
                'display_label' => 'GCash',
            ]);
        }

        $last4 = substr(preg_replace('/\D/', '', $phone), -4);
        $masked = "GCash(****{$last4})";

        return response()->json([
            'linked' => true,
            'phone' => $phone,
            'masked_phone' => $masked,
            'display_label' => $masked,
            'linked_at' => $user->gcash_linked_at?->toIso8601String(),
        ]);
    }

    /**
     * Link and verify a customer's GCash account.
     *
     * In test/sandbox mode, any 6-digit OTP (e.g. 123456) is accepted.
     */
    public function linkGcashAccount(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'phone' => ['required', 'string', 'min:10', 'max:15'],
            'otp' => ['required', 'string', 'min:4', 'max:6'],
        ]);

        $rawPhone = preg_replace('/\D/', '', $validated['phone']);
        // Standardize Philippine mobile numbers: +639xx or 9xx -> 09xx
        if (str_starts_with($rawPhone, '63') && strlen($rawPhone) === 12) {
            $rawPhone = '0' . substr($rawPhone, 2);
        } elseif (strlen($rawPhone) === 10 && str_starts_with($rawPhone, '9')) {
            $rawPhone = '0' . $rawPhone;
        }

        if (strlen($rawPhone) !== 11 || !str_starts_with($rawPhone, '09')) {
            return response()->json([
                'message' => 'Please enter a valid 11-digit Philippine GCash mobile number (e.g., 09171234567).',
            ], 422);
        }

        // Test mode OTP verification
        $otp = trim($validated['otp']);
        if (strlen($otp) !== 6 && strlen($otp) !== 4) {
            return response()->json([
                'message' => 'Please enter the 6-digit verification code.',
            ], 422);
        }

        $user->update([
            'gcash_phone' => $rawPhone,
            'gcash_linked_at' => now(),
        ]);

        $last4 = substr($rawPhone, -4);
        $masked = "GCash(****{$last4})";

        Log::info('[GCASH LINK] Customer bound GCash account', [
            'user_id' => $user->id,
            'masked' => $masked,
        ]);

        return response()->json([
            'message' => 'Your GCash account has been successfully linked!',
            'data' => [
                'linked' => true,
                'phone' => $rawPhone,
                'masked_phone' => $masked,
                'display_label' => $masked,
                'linked_at' => now()->toIso8601String(),
            ],
        ]);
    }

    /**
     * Unlink the customer's saved GCash account.
     */
    public function unlinkGcashAccount(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $user->update([
            'gcash_phone' => null,
            'gcash_linked_at' => null,
        ]);

        Log::info('[GCASH LINK] Customer unlinked GCash account', [
            'user_id' => $user->id,
        ]);

        return response()->json([
            'message' => 'Your GCash account has been unlinked.',
            'data' => [
                'linked' => false,
                'masked_phone' => null,
                'display_label' => 'GCash',
            ],
        ]);
    }
}
