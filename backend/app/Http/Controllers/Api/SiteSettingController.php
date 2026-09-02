<?php

namespace App\Http\Controllers\Api;

use App\Models\SiteSetting;
use App\Support\EmailTemplate;
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
            // The email-template overrides are back-office copy, not page
            // content. Serving ~20 KB of notification text to every customer
            // page load would be pure waste; the editor reads them through
            // /admin/email-templates instead.
            if (str_starts_with((string) $row->key, EmailTemplate::KEY_PREFIX)) {
                continue;
            }

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

        // The Gmail notification copy is admin-only (see denyUnlessAdmin below),
        // and this endpoint is the back door into it: without this check a staff
        // token could rewrite all 27 notifications through the generic settings
        // route even with the editor page removed from their portal.
        if ($role !== 'admin') {
            foreach ($input as $key => $value) {
                if (is_string($key) && str_starts_with($key, EmailTemplate::KEY_PREFIX)) {
                    return response()->json([
                        'message' => 'Forbidden. Admin access is required to change email templates.',
                    ], 403);
                }
            }
        }

        foreach ($input as $key => $value) {
            if (is_string($key) && $key !== '') {
                SiteSetting::set($key, $value);
            }
        }

        return response()->json(['message' => 'Site settings updated successfully.']);
    }

    /**
     * Admin only: the whole Gmail notification registry — every slug with its
     * group, label, tokens, compiled-in defaults and saved override.
     *
     * Sending the defaults down is what keeps the editor page free of a second,
     * drifting copy of 27 templates' worth of wording.
     */
    public function emailTemplates(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessAdmin($request)) {
            return $denied;
        }

        return response()->json([
            'data' => [
                'key_prefix' => EmailTemplate::KEY_PREFIX,
                'groups' => EmailTemplate::GROUPS,
                'editable_parts' => EmailTemplate::EDITABLE_PARTS,
                'clearable_parts' => EmailTemplate::CLEARABLE_PARTS,
                'templates' => EmailTemplate::registry(),
            ],
        ]);
    }

    /**
     * Admin only: render one notification with sample content.
     *
     * The preview runs through the same EmailTemplate::render() a real send
     * uses, so what the editor shows in its iframe is what the recipient gets.
     * Optional draft parts let the page preview an edit before it is saved.
     */
    public function previewEmailTemplate(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'slug' => 'required|string|max:80',
            'parts' => 'sometimes|array',
        ]);

        $slug = (string) $validated['slug'];

        if (! EmailTemplate::has($slug)) {
            return response()->json(['message' => 'Unknown email template.'], 404);
        }

        $draft = [];
        foreach (EmailTemplate::EDITABLE_PARTS as $part) {
            $value = $validated['parts'][$part] ?? null;
            if (is_string($value)) {
                // 20 KB is far past any legitimate email paragraph and keeps a
                // pasted document from becoming a slow render.
                $draft[$part] = mb_substr($value, 0, 20000);
            }
        }

        return response()->json([
            'data' => [
                'slug' => $slug,
                'html' => $draft === []
                    ? EmailTemplate::preview($slug)
                    : EmailTemplate::previewDraft($slug, $draft),
            ],
        ]);
    }

    /**
     * The email-template endpoints are read-only, but the notification wording
     * goes out under the lab's name to every customer, so editing it is an
     * admin-only responsibility — the same rule Maintenance Mode uses, one step
     * stricter than the admin-or-staff gate bulkUpdate() applies to ordinary
     * page content above.
     */
    private function denyUnlessAdmin(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        $role = strtolower((string) ($actor->role ?? ''));

        if (! $actor || $role !== 'admin') {
            return response()->json([
                'message' => 'Forbidden. Admin access is required to change email templates.',
            ], 403);
        }

        return null;
    }
}
