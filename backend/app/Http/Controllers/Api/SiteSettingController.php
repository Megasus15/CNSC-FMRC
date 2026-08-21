<?php

namespace App\Http\Controllers\Api;

use App\Models\SiteSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;

class SiteSettingController extends Controller
{
    /**
     * Public: Return all site settings as a flat key->value object.
     *
     * ETag/304 revalidation (same idiom as HomeSdgController::index()) lets the
     * customer pages poll this endpoint for realtime edits without re-sending
     * the base64 hero/vision artwork every time nothing has changed.
     */
    public function index(Request $request): Response|JsonResponse
    {
        $rows = SiteSetting::all(['key', 'value']);

        $data = [];
        foreach ($rows as $row) {
            $data[$row->key] = $row->value;
        }

        $payload = ['data' => $data];

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
     * Admin: Bulk upsert site settings.
     * Expects JSON body: { "hero_title": "...", "about_text": "...", ... }
     */
    public function bulkUpdate(Request $request): JsonResponse
    {
        // auth:sanctum alone would let any signed-in customer token rewrite the
        // public site content and the official report letterhead, so the role is
        // checked here with the same rule the admin dashboard uses.
        $actor = $request->user();
        $role = strtolower((string) ($actor->role ?? ''));
        if (! $actor || ! in_array($role, ['admin', 'staff'], true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        $request->validate([
            '*' => 'nullable',
        ]);

        // Accept any key-value pairs from the request body
        $input = $request->all();

        foreach ($input as $key => $value) {
            if (is_string($key) && $key !== '') {
                SiteSetting::set($key, $value);
            }
        }

        return response()->json(['message' => 'Site settings updated successfully.']);
    }
}
