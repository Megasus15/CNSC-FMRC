<?php

namespace App\Http\Controllers\Api;

use App\Models\Announcement;
use App\Models\AdminNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AnnouncementController extends Controller
{
    private const SCHEDULE_TIME_ZONE = 'Asia/Manila';

    public function publicIndex(Request $request): JsonResponse
    {
        $placement = $request->query('placement');
        $items = Announcement::where('is_enabled', true)
            ->where('is_archived', false)
            ->latest()
            ->get()
            ->filter(function ($a) use ($placement) {
                if (!$a->isLive()) {
                    return false;
                }
                if (!$placement || $placement === 'all') {
                    return true;
                }
                return $a->placement === 'both' || $a->placement === $placement;
            })
            ->map(fn($a) => $this->format($a))
            ->values();

        return response()->json(['data' => $items]);
    }

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Announcement::query()
                ->where('is_archived', false)
                ->latest()
                ->get()
                ->map(fn($a) => $this->format($a)),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $a = Announcement::create($this->validated($request) + ['created_by' => $request->user()->id]);
        
        AdminNotification::create([
            'type' => 'info',
            'title' => 'Visitor Announcement Published',
            'message' => "Announcement '{$a->title}' was published.",
            'is_read' => false,
            // Lets the header notification link straight to this announcement
            // instead of relying on its wording to guess the page.
            'metadata' => [
                'announcement_id' => $a->id,
            ],
        ]);

        return response()->json(['data' => $this->format($a), 'message' => 'Announcement published.'], 201);
    }

    public function update(Request $request, Announcement $announcement): JsonResponse
    {
        $announcement->update($this->validated($request));
        $fresh = $announcement->fresh();

        AdminNotification::create([
            'type' => 'info',
            'title' => 'Visitor Announcement Updated',
            'message' => "Announcement '{$fresh->title}' was updated.",
            'is_read' => false,
            'metadata' => [
                'announcement_id' => $fresh->id,
            ],
        ]);

        return response()->json(['data' => $this->format($fresh), 'message' => 'Announcement updated.']);
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
            $eligibleIds = Announcement::query()
                ->whereIn('id', $ids)
                ->where('is_archived', false)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($eligibleIds) {
                Announcement::query()->whereIn('id', $eligibleIds)->update([
                    'is_archived' => true,
                    'archived_at' => $archivedAt,
                    'updated_at' => now(),
                ]);
            }

            return $eligibleIds;
        });

        if (!$archivedIds) {
            return response()->json(['message' => 'No active announcements were found to archive.'], 404);
        }

        return response()->json([
            'action' => 'archive',
            'scope' => 'announcements',
            'processed_ids' => $archivedIds,
            'processed_count' => count($archivedIds),
            'skipped_ids' => array_values(array_diff($ids, $archivedIds)),
            'message' => count($archivedIds) . ' announcement(s) archived successfully.',
        ]);
    }

    public function destroy(Announcement $announcement): JsonResponse
    {
        $announcement->delete();
        return response()->json(['message' => 'Announcement deleted.']);
    }

    private function validated(Request $request): array
    {
        $validated = $request->validate([
            'title' => 'required|string|max:140',
            'message' => 'required|string|max:2000',
            'cta_label' => 'nullable|string|max:60',
            'cta_url' => 'nullable|string|max:500',
            'placement' => 'required|in:site,products,both',
            'accent_color' => 'nullable|string|max:20',
            'secondary_color' => 'nullable|string|max:20',
            'starts_at' => 'nullable|date',
            'ends_at' => 'nullable|date|after_or_equal:starts_at',
            'is_enabled' => 'boolean',
        ]);

        foreach (['starts_at', 'ends_at'] as $field) {
            if (!empty($validated[$field])) {
                $validated[$field] = $this->normalizeScheduleDate($validated[$field]);
            }
        }

        return $validated;
    }

    private function format(Announcement $a): array
    {
        $now = now(self::SCHEDULE_TIME_ZONE);

        return [
            'id' => $a->id,
            'title' => $a->title,
            'message' => $a->message,
            'cta_label' => $a->cta_label,
            'cta_url' => $a->cta_url,
            'placement' => $a->placement,
            'accent_color' => $a->accent_color,
            'secondary_color' => $a->secondary_color,
            'starts_at' => $this->formatScheduleDate($a->starts_at),
            'ends_at' => $this->formatScheduleDate($a->ends_at),
            'is_enabled' => (bool)$a->is_enabled,
            'is_archived' => (bool)$a->is_archived,
            'archived_at' => $this->formatScheduleDate($a->archived_at),
            'is_live' => $a->isLive($now),
            'status' => $a->status($now),
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
