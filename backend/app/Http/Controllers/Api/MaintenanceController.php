<?php

namespace App\Http\Controllers\Api;

use App\Models\MaintenancePageSetting;
use App\Models\MaintenanceSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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
     * gate revalidates without reloading the document, and an unchanged
     * snapshot answers 304 with no body.
     */
    public function index(Request $request): Response|JsonResponse
    {
        // `installed` is false only in the window between a files-only deploy and
        // `php artisan migrate`. MaintenanceSetting fails open, so the snapshot is
        // still a valid all-online answer; the flag is what lets the admin panel
        // say WHY every switch is off instead of showing a silent, dead form.
        $payload = [
            'data' => MaintenanceSetting::snapshot(),
            'site_page' => MaintenancePageSetting::snapshot(),
            'installed' => MaintenanceSetting::tableReady(),
            'site_page_installed' => MaintenancePageSetting::available(),
        ];

        $etag = '"'.hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)).'"';
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
     * Admin only: write any subset of the known scopes in one transaction.
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

        // Writing is the one thing that cannot fail open: without the table there
        // is nowhere to record the switch, and silently reporting success would
        // leave the admin believing the site was offline when it was not.
        if (! MaintenanceSetting::tableReady()) {
            return response()->json([
                'message' => 'Maintenance Mode is not installed on this server yet. Run "php artisan migrate" once, then reload this page.',
                'installed' => false,
            ], 503);
        }

        $rules = [
            'scopes' => 'required|array|min:1',
            'scopes.*' => 'required|array:is_active,message',
            'scopes.*.is_active' => 'required|boolean',
            // Existing notices remain concise, while the full site-wide page
            // can carry a useful paragraph within the widened 255-char column.
            'scopes.*.message' => 'nullable|string|max:75',
            'scopes.site_portal.message' => 'nullable|string|max:200',
            'site_page' => 'sometimes|array:eyebrow,headline,headline_accent,supporting_line,image_alt,theme,image_data',
            'site_page.theme' => 'sometimes|in:'.implode(',', MaintenancePageSetting::THEMES),
            'site_page.image_data' => 'sometimes|nullable|string|max:1398150',
        ];
        if ($request->has('scopes.site_portal')) {
            unset($rules['scopes.*.message']);
            foreach (MaintenanceSetting::scopes() as $scope) {
                $rules["scopes.{$scope}.message"] = 'nullable|string|max:'.($scope === 'site_portal' ? '200' : '75');
            }
        }
        foreach (MaintenancePageSetting::TEXT_LIMITS as $field => $limit) {
            $rules["site_page.{$field}"] = 'sometimes|nullable|string|max:'.$limit;
        }
        $validated = $request->validate($rules);

        if (array_key_exists('site_page', $validated) && ! MaintenancePageSetting::available()) {
            return response()->json([
                'message' => 'Maintenance page settings are not installed yet. Run "php artisan migrate", then click Refresh.',
                'installed' => true,
                'site_page_installed' => false,
            ], 503);
        }

        // Unknown keys are rejected instead of ignored: a typo in a scope name
        // would otherwise look like a successful save that does nothing.
        $unknown = array_values(array_filter(
            array_keys($validated['scopes']),
            fn ($scope) => ! MaintenanceSetting::isKnownScope((string) $scope)
        ));

        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'scopes' => 'Unknown maintenance scope: '.implode(', ', $unknown).'.',
            ]);
        }

        $imagePath = null;
        $page = $validated['site_page'] ?? null;
        if (is_array($page) && array_key_exists('image_data', $page) && $page['image_data'] !== null && $page['image_data'] !== '') {
            $data = $page['image_data'];
            if (! preg_match('~^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$~D', $data, $matches)) {
                throw ValidationException::withMessages(['site_page.image_data' => 'Choose a PNG, JPG, or WebP image.']);
            }
            $bytes = base64_decode($matches[2], true);
            if ($bytes === false || strlen($bytes) > 1024 * 1024 || strlen($bytes) < 16) {
                throw ValidationException::withMessages(['site_page.image_data' => 'Choose an image smaller than 1 MB.']);
            }
            $details = @getimagesizefromstring($bytes);
            $expected = ['png' => 'image/png', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp'];
            if (! $details || ($details['mime'] ?? '') !== $expected[$matches[1]] || ($details[0] ?? 0) < 1 || ($details[1] ?? 0) < 1 || ($details[0] ?? 0) > 2400 || ($details[1] ?? 0) > 2400) {
                throw ValidationException::withMessages(['site_page.image_data' => 'Choose a readable image up to 2400 by 2400 pixels.']);
            }
            $extension = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
            $imagePath = 'maintenance/site-page-'.substr(hash('sha256', $bytes), 0, 24).'.'.$extension;
            if (! Storage::disk('public')->put($imagePath, $bytes)) {
                return response()->json(['message' => 'The maintenance illustration could not be stored. Please try again.'], 500);
            }
        }

        DB::transaction(function () use ($validated, $actor, $page, $imagePath) {
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
            if (is_array($page)) {
                $setting = MaintenancePageSetting::query()->firstOrNew(['id' => 1]);
                foreach (['eyebrow', 'headline', 'headline_accent', 'supporting_line', 'image_alt', 'theme'] as $field) {
                    if (array_key_exists($field, $page)) {
                        $setting->{$field} = is_string($page[$field]) ? trim($page[$field]) : null;
                    }
                }
                if (array_key_exists('image_data', $page)) {
                    $setting->image_path = $page['image_data'] === '' || $page['image_data'] === null ? null : $imagePath;
                }
                $setting->updated_by = $actor->id;
                $setting->save();
            }
        });

        return response()->json([
            'message' => 'Maintenance settings updated successfully.',
            'data' => MaintenanceSetting::snapshot(),
            'site_page' => MaintenancePageSetting::snapshot(),
            'installed' => true,
            'site_page_installed' => MaintenancePageSetting::available(),
        ]);
    }
}
