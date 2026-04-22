<?php

namespace App\Http\Controllers\Api;

use App\Models\SiteSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class SiteSettingController extends Controller
{
    /**
     * Public: Return all site settings as a flat key->value object.
     */
    public function index(): JsonResponse
    {
        $rows = SiteSetting::all(['key', 'value']);

        $data = [];
        foreach ($rows as $row) {
            $data[$row->key] = $row->value;
        }

        return response()->json(['data' => $data]);
    }

    /**
     * Admin: Bulk upsert site settings.
     * Expects JSON body: { "hero_title": "...", "about_text": "...", ... }
     */
    public function bulkUpdate(Request $request): JsonResponse
    {
        $payload = $request->validate([
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
