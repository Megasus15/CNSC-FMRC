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
    private const WORKSPACE_DEFAULTS = ['sidebarWidth' => 270, 'sidebarLabel' => 'UCN-FMRC', 'sidebarLogo' => ''];

    private function workspace(?object $stored): array
    {
        $values = json_decode($stored?->workspace ?? 'null', true);
        return array_replace(self::WORKSPACE_DEFAULTS, is_array($values) ? array_intersect_key($values, self::WORKSPACE_DEFAULTS) : []);
    }

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
                'theme' => $stored?->theme ?? 'light',
                'compact' => (bool) ($stored?->compact ?? false),
                'reducedMotion' => (bool) ($stored?->reduced_motion ?? false),
                ...$this->workspace($stored),
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
            'sidebarWidth' => ['sometimes', 'integer', 'between:76,270'],
            'sidebarLabel' => ['sometimes', 'required', 'string', 'max:18', 'not_regex:/[\x00-\x1F\x7F]/u'],
            'sidebarLogo' => ['sometimes', 'nullable', 'string', 'max:400000', function ($attribute, $value, $fail) {
                if (!$value) return;
                if (!preg_match('/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+\/=]+)$/', $value, $matches)) {
                    $fail('Please choose a PNG, JPG, or WebP logo.');
                    return;
                }
                $bytes = base64_decode($matches[2], true);
                $image = $bytes === false ? false : @getimagesizefromstring($bytes);
                if (!$image || strlen($bytes) > 300000 || $image[0] !== $image[1] || $image[0] < 16 || $image[0] > 512 || $image['mime'] !== 'image/'.$matches[1]) {
                    $fail('Please fit your logo to the circular preview before saving.');
                }
            }],
            'user_id' => ['prohibited'],
        ]);
        $stored = DB::table('user_portal_preferences')->where('user_id', $request->user()->id)->first();
        $workspace = array_replace($this->workspace($stored), array_intersect_key($data, self::WORKSPACE_DEFAULTS));
        $workspace['sidebarWidth'] = (int) $workspace['sidebarWidth'];
        $workspace['sidebarLabel'] = trim($workspace['sidebarLabel']);
        $workspace['sidebarLogo'] ??= '';
        $hasWorkspace = Schema::hasColumn('user_portal_preferences', 'workspace');
        // Existing deployments can still save appearance before the workspace
        // upgrade, but must never claim a custom logo or width was persisted.
        abort_if(!$hasWorkspace && $workspace !== self::WORKSPACE_DEFAULTS, 503, 'Workspace preferences are temporarily unavailable.');
        // Ownership is always derived from the authenticated session.
        $now = now();
        $row = [
            'user_id' => $request->user()->id,
            'theme' => $data['theme'],
            'compact' => $data['compact'],
            'reduced_motion' => $data['reducedMotion'],
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $columns = ['theme', 'compact', 'reduced_motion', 'updated_at'];
        if ($hasWorkspace) {
            $row['workspace'] = json_encode($workspace, JSON_THROW_ON_ERROR);
            $columns[] = 'workspace';
        }
        DB::table('user_portal_preferences')->upsert([$row], ['user_id'], $columns);

        return $this->show($request);
    }
}
