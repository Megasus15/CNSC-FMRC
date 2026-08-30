<?php

namespace App\Http\Controllers\Api;

use App\Models\MaintenanceSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Maintenance Mode (STEP 11, Part B).
 *
 * `index()` is public because every customer page has to read it before it can
 * decide what to paint. `update()` is admin-ONLY -- deliberately stricter than
 * PUT /api/admin/site-settings, which also accepts a staff token. Taking the
 * customer site offline is not a staff action.
 */
class MaintenanceController extends Controller
{
    /**
     * Public: the whole maintenance snapshot.
     *
     * Same ETag/304 idiom as SiteSettingController::index() and
     * HomeSdgController::index(). It matters more here than there: the customer
     * gate revalidates on the existing 20s site-content tick, and an unchanged
     * snapshot answers 304 with no body.
     */
    public function index(Request $request): Response|JsonResponse
    {
        $payload = ['data' => MaintenanceSetting::snapshot()];

        $etag = '"' . hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) . '"';
        $headers = [
            'Cache-Control' => 'public, no-cache, must-revalidate',
            'ETag' => $etag,
        ];

        if (trim((string) $request->header('If-None-Match')) === $etag) {
            return response('', 304, $headers);
        }

        return response()->json($payload)->withHeaders($headers);
    }

    /**
     * Admin only: write any subset of the 11 scopes in one transaction.
     *
     * Body: { "scopes": { "<scope>": { "is_active": bool, "message": "..." }, ... } }
     */
    public function update(Request $request): JsonResponse
    {
        $actor = $request->user();
        $role = strtolower((string) ($actor->role ?? ''));

        if (! $actor || $role !== 'admin') {
            return response()->json([
                'message' => 'Forbidden. Admin access is required to change maintenance mode.',
            ], 403);
        }

        $validated = $request->validate([
            'scopes' => 'required|array|min:1',
            'scopes.*.is_active' => 'required|boolean',
            // 75 characters is the ceiling the request set; the column is
            // string(75) too, so an over-long message fails here rather than
            // being silently truncated by the database.
            'scopes.*.message' => 'nullable|string|max:75',
        ]);

        // Unknown keys are rejected instead of ignored: a typo in a scope name
        // would otherwise look like a successful save that does nothing.
        $unknown = array_values(array_filter(
            array_keys($validated['scopes']),
            fn ($scope) => ! MaintenanceSetting::isKnownScope((string) $scope)
        ));

        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'scopes' => 'Unknown maintenance scope: ' . implode(', ', $unknown) . '.',
            ]);
        }

        DB::transaction(function () use ($validated, $actor) {
            foreach ($validated['scopes'] as $scope => $conf) {
                $message = trim((string) ($conf['message'] ?? ''));

                MaintenanceSetting::updateOrCreate(
                    ['scope' => $scope],
                    [
                        'is_active' => (bool) $conf['is_active'],
                        // An empty box means "use the default", stored as NULL so
                        // the default can change later without a data migration.
                        'message' => $message !== '' ? $message : null,
                        'updated_by' => $actor->id,
                    ]
                );
            }
        });

        return response()->json([
            'message' => 'Maintenance settings updated successfully.',
            'data' => MaintenanceSetting::snapshot(),
        ]);
    }
}
