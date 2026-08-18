<?php

namespace App\Http\Controllers\Api;

use App\Models\HomeSdg;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;

class HomeSdgController extends Controller
{
    // ─── Public ─────────────────────────────────────────────────────────────────

    /**
     * Customer hero strip. ETag/304 revalidation keeps the poll cheap even
     * though the payload carries base64 artwork (same idiom as
     * OrderController::customerIndex()).
     */
    public function index(Request $request): Response|JsonResponse
    {
        $payload = [
            'data' => HomeSdg::query()
                ->where('is_visible', true)
                ->orderBy('sort_order')
                ->orderBy('id')
                ->get()
                ->map(fn (HomeSdg $s) => $this->format($s))
                ->values(),
            'max_slots' => HomeSdg::MAX_SLOTS,
        ];

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

    // ─── Admin / Staff ───────────────────────────────────────────────────────────

    public function adminIndex(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        return response()->json([
            'data' => HomeSdg::query()
                ->orderBy('sort_order')
                ->orderBy('id')
                ->get()
                ->map(fn (HomeSdg $s) => $this->format($s))
                ->values(),
            'max_slots' => HomeSdg::MAX_SLOTS,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        if (HomeSdg::count() >= HomeSdg::MAX_SLOTS) {
            return response()->json([
                'message' => 'The home page can display a maximum of ' . HomeSdg::MAX_SLOTS . ' SDGs. Remove one first.',
            ], 422);
        }

        $validated = $this->validated($request);
        $validated['sort_order'] ??= (int) HomeSdg::max('sort_order') + 1;

        $sdg = HomeSdg::create($validated);

        return response()->json([
            'message' => 'SDG added successfully.',
            'data' => $this->format($sdg),
        ], 201);
    }

    public function update(Request $request, HomeSdg $homeSdg): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $homeSdg->update($this->validated($request));

        return response()->json([
            'message' => 'SDG updated successfully.',
            'data' => $this->format($homeSdg->fresh()),
        ]);
    }

    public function destroy(Request $request, HomeSdg $homeSdg): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $homeSdg->delete();

        return response()->json(['message' => 'SDG removed successfully.']);
    }

    /**
     * Rewrite sort_order from the given id sequence so the admin arrows and the
     * customer strip agree on one canonical order.
     */
    public function reorder(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);

        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values();

        DB::transaction(function () use ($ids): void {
            $known = HomeSdg::query()->whereIn('id', $ids->all())->pluck('id')->all();

            foreach ($ids as $position => $id) {
                if (in_array($id, $known, true)) {
                    HomeSdg::query()->whereKey($id)->update([
                        'sort_order' => $position,
                        'updated_at' => now(),
                    ]);
                }
            }
        });

        return response()->json([
            'message' => 'SDG order updated.',
            'data' => HomeSdg::query()
                ->orderBy('sort_order')
                ->orderBy('id')
                ->get()
                ->map(fn (HomeSdg $s) => $this->format($s))
                ->values(),
        ]);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    private function validated(Request $request): array
    {
        return $request->validate([
            'title' => 'required|string|max:160',
            'description' => 'nullable|string|max:2000',
            'image_data' => 'nullable|string',
            'sort_order' => 'nullable|integer|min:0',
            'is_visible' => 'boolean',
        ]);
    }

    private function format(HomeSdg $s): array
    {
        return [
            'id' => $s->id,
            'title' => $s->title,
            'description' => $s->description,
            'image_data' => $s->image_data,
            'sort_order' => (int) $s->sort_order,
            'is_visible' => (bool) $s->is_visible,
            'created_at' => $s->created_at,
            'updated_at' => $s->updated_at,
        ];
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, ['admin', 'staff'], true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }
}
