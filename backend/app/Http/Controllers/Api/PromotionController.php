<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Promotion;
use App\Models\AdminNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class PromotionController extends Controller
{
    private const SCHEDULE_TIME_ZONE = 'Asia/Manila';

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        return response()->json([
            'data' => Promotion::query()
                ->where('is_archived', false)
                ->latest()
                ->get()
                ->map(fn($p) => $this->format($p)),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $p = Promotion::create($this->validated($request) + ['created_by' => $request->user()->id]);

        AdminNotification::create([
            'type' => 'info',
            'title' => 'Product Promotion Saved',
            'message' => "Promotion '{$p->title}' ({$p->discount_percent}% off) was saved.",
            'is_read' => false,
            // Lets the header notification link straight to this promotion
            // instead of relying on its wording to guess the page.
            'metadata' => [
                'promotion_id' => $p->id,
            ],
        ]);

        return response()->json(['data' => $this->format($p), 'message' => 'Promotion saved.'], 201);
    }

    public function update(Request $request, Promotion $promotion): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $promotion->update($this->validated($request));
        $fresh = $promotion->fresh();

        AdminNotification::create([
            'type' => 'info',
            'title' => 'Product Promotion Updated',
            'message' => "Promotion '{$fresh->title}' ({$fresh->discount_percent}% off) was updated.",
            'is_read' => false,
            'metadata' => [
                'promotion_id' => $fresh->id,
            ],
        ]);

        return response()->json(['data' => $this->format($fresh), 'message' => 'Promotion updated.']);
    }

    public function archiveBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();
        $archivedAt = now();

        $archivedIds = DB::transaction(function () use ($ids, $archivedAt): array {
            $eligibleIds = Promotion::query()
                ->whereIn('id', $ids)
                ->where('is_archived', false)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($eligibleIds) {
                Promotion::query()->whereIn('id', $eligibleIds)->update([
                    'is_archived' => true,
                    'archived_at' => $archivedAt,
                    'updated_at' => now(),
                ]);
            }

            return $eligibleIds;
        });

        if (!$archivedIds) {
            return response()->json(['message' => 'No active promotions were found to archive.'], 404);
        }

        return response()->json([
            'action' => 'archive',
            'scope' => 'promotions',
            'processed_ids' => $archivedIds,
            'processed_count' => count($archivedIds),
            'skipped_ids' => array_values(array_diff($ids, $archivedIds)),
            'message' => count($archivedIds) . ' promotion(s) archived successfully.',
        ]);
    }

    public function destroy(Request $request, Promotion $promotion): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $promotion->delete();
        return response()->json(['message' => 'Promotion deleted.']);
    }

    public function active(): JsonResponse
    {
        $promotions = Promotion::where('is_enabled', true)
            ->where('is_archived', false)
            ->latest()
            ->get()
            ->filter(fn($p) => $p->isLive())
            ->map(fn($p) => $this->format($p))
            ->values();

        return response()->json(['data' => $promotions]);
    }

    private function validated(Request $request): array
    {
        $d = $request->validate([
            'title' => 'required|string|max:120',
            'discount_percent' => 'required|integer|min:0|max:100',
            'scope' => 'required|in:all_products,specific_products',
            'product_ids' => 'nullable|array',
            'product_ids.*' => 'integer|exists:products,id',
            'starts_at' => 'nullable|date',
            'ends_at' => 'nullable|date|after_or_equal:starts_at',
            'is_enabled' => 'boolean',
        ]);

        if ($d['scope'] === 'specific_products' && empty($d['product_ids'])) {
            abort(422, 'Select at least one product.');
        }

        foreach (['starts_at', 'ends_at'] as $field) {
            if (!empty($d[$field])) {
                $d[$field] = $this->normalizeScheduleDate($d[$field]);
            }
        }

        return $d;
    }

    private function format(Promotion $p): array
    {
        $now = now(self::SCHEDULE_TIME_ZONE);

        return [
            'id' => $p->id,
            'title' => $p->title,
            'discount_percent' => (int)$p->discount_percent,
            'scope' => $p->scope,
            'product_ids' => $p->product_ids ?? [],
            'starts_at' => $this->formatScheduleDate($p->starts_at),
            'ends_at' => $this->formatScheduleDate($p->ends_at),
            'is_enabled' => (bool)$p->is_enabled,
            'is_archived' => (bool)$p->is_archived,
            'archived_at' => $this->formatScheduleDate($p->archived_at),
            'is_live' => $p->isLive($now),
            'status' => $p->status($now),
        ];
    }

    private function formatScheduleDate(?Carbon $value): ?string
    {
        return $value?->copy()->timezone(self::SCHEDULE_TIME_ZONE)->toIso8601String();
    }

    private function normalizeScheduleDate(string $value): Carbon
    {
        $value = trim($value);
        if (preg_match('/(?:Z|[+-]\d{2}:?\d{2})$/i', $value)) {
            return Carbon::parse($value)->utc();
        }

        foreach (['Y-m-d\\TH:i:s', 'Y-m-d\\TH:i', 'Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d'] as $format) {
            try {
                return Carbon::createFromFormat($format, $value, self::SCHEDULE_TIME_ZONE)->utc();
            } catch (\Throwable) {
                // Try the next accepted date shape.
            }
        }

        return Carbon::parse($value . ' +08:00')->utc();
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
