<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class PortalPreferenceController extends Controller
{
    private function authorizePortal(Request $request): void
    {
        abort_unless(in_array(strtolower((string) $request->user()?->role), ['admin', 'staff'], true), 403);
        abort_unless(Schema::hasTable('user_portal_preferences'), 503, 'Preferences are temporarily unavailable.');
    }

    public function show(Request $request): JsonResponse
    {
        $this->authorizePortal($request);
        $stored = DB::table('user_portal_preferences')->where('user_id', $request->user()->id)->first();

        return response()->json([
            'user_id' => $request->user()->id,
            'preferences' => [
                'theme' => $stored?->theme ?? 'system',
                'compact' => (bool) ($stored?->compact ?? false),
                'reducedMotion' => (bool) ($stored?->reduced_motion ?? false),
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function update(Request $request): JsonResponse
    {
        $this->authorizePortal($request);
        $data = $request->validate([
            'theme' => ['required', Rule::in(['light', 'dark', 'system'])],
            'compact' => ['required', 'boolean'],
            'reducedMotion' => ['required', 'boolean'],
            'user_id' => ['prohibited'],
        ]);
        // Ownership is always derived from the authenticated session.
        $now = now();
        DB::table('user_portal_preferences')->upsert([[
            'user_id' => $request->user()->id,
            'theme' => $data['theme'],
            'compact' => $data['compact'],
            'reduced_motion' => $data['reducedMotion'],
            'created_at' => $now,
            'updated_at' => $now,
        ]], ['user_id'], ['theme', 'compact', 'reduced_motion', 'updated_at']);

        return $this->show($request);
    }
}
