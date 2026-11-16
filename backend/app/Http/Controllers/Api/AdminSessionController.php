<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\AdminSession;
use App\Support\OperatorSessionPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class AdminSessionController extends Controller
{
    public function preferences(Request $request): JsonResponse
    {
        if (!$this->operatorToken($request)) return $this->forbidden();
        abort_unless(OperatorSessionPolicy::installed(), 503, 'Automatic sign-out settings require the latest database update. Your existing session protection remains active.');
        return response()->json(['preferences' => OperatorSessionPolicy::forUser($request->user()), 'effective_on' => 'next_login'])
            ->header('Cache-Control', 'private, no-store');
    }

    public function updatePreferences(Request $request): JsonResponse
    {
        if (!$this->operatorToken($request)) return $this->forbidden();
        abort_unless(OperatorSessionPolicy::installed(), 503, 'Automatic sign-out settings require the latest database update. Your existing session protection remains active.');
        $data = $request->validate(['enabled' => ['required', 'boolean'], 'max_hours' => ['required', 'integer', 'in:6,12'], 'user_id' => ['prohibited']]);
        abort_if(array_diff(array_keys($request->all()), ['enabled', 'max_hours']), 422, 'Only enabled and max_hours may be changed.');
        OperatorSessionPolicy::save($request->user(), ['enabled' => (bool) $data['enabled'], 'max_hours' => (int) $data['max_hours']]);
        return $this->preferences($request);
    }

    public function status(Request $request): JsonResponse
    {
        $token = $this->operatorToken($request);

        if (! $token) {
            return $this->forbidden();
        }

        return response()->json(AdminSession::status($token))
            ->header('Cache-Control', 'no-store');
    }

    public function activity(Request $request): JsonResponse
    {
        $token = $this->operatorToken($request);

        if (! $token) {
            return $this->forbidden();
        }

        $validated = $request->validate([
            'interaction' => 'required|in:activity,stay_signed_in',
        ]);

        $status = AdminSession::status($token);
        $warningStarted = now()->greaterThanOrEqualTo($status['idle_warning_at']);

        // Once the warning appears, incidental gestures cannot hide it. The
        // explicit "Stay signed in" action is the only way to renew then.
        if (! $warningStarted || $validated['interaction'] === 'stay_signed_in') {
            $token->forceFill(['last_interaction_at' => now()])->save();
            $status = AdminSession::status($token);
        }

        return response()->json($status)->header('Cache-Control', 'no-store');
    }

    private function operatorToken(Request $request): ?PersonalAccessToken
    {
        $user = $request->user('sanctum');

        if (! $user instanceof User || ! AdminSession::isOperator($user)) {
            return null;
        }

        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken ? $token : null;
    }

    private function forbidden(): JsonResponse
    {
        return response()->json([
            'message' => 'This session is available to Admin and Staff accounts only.',
        ], 403)->header('Cache-Control', 'no-store');
    }
}
