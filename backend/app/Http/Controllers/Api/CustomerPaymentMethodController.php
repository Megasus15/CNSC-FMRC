<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/** Compatibility endpoints for removing obsolete saved payment details. */
class CustomerPaymentMethodController extends Controller
{
    public function getGcashAccount(Request $request): JsonResponse {
        return response()->json(['linked' => false, 'phone' => null, 'masked_phone' => null, 'display_label' => 'GCash']);
    }

    public function linkGcashAccount(Request $request): JsonResponse
    {
        return response()->json(['message' => 'Select GCash at checkout to authorize payment securely in GCash.'], 410);
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
