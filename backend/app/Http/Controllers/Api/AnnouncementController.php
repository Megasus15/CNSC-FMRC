<?php

namespace App\Http\Controllers\Api;

use App\Models\Announcement;
use App\Models\AdminNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class AnnouncementController extends Controller
{
    public function publicIndex(Request $request): JsonResponse
    {
        $placement = $request->query('placement');
        $items = Announcement::where('is_enabled', true)
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
        return response()->json(['data' => Announcement::latest()->get()->map(fn($a) => $this->format($a))]);
    }

    public function store(Request $request): JsonResponse
    {
        $a = Announcement::create($this->validated($request) + ['created_by' => $request->user()->id]);
        
        AdminNotification::create([
            'type' => 'info',
            'title' => 'Visitor Announcement Published',
            'message' => "Announcement '{$a->title}' was published.",
            'is_read' => false,
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
        ]);

        return response()->json(['data' => $this->format($fresh), 'message' => 'Announcement updated.']);
    }

    public function destroy(Announcement $announcement): JsonResponse
    {
        $announcement->delete();
        return response()->json(['message' => 'Announcement deleted.']);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
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
    }

    private function format(Announcement $a): array
    {
        return [
            'id' => $a->id,
            'title' => $a->title,
            'message' => $a->message,
            'cta_label' => $a->cta_label,
            'cta_url' => $a->cta_url,
            'placement' => $a->placement,
            'accent_color' => $a->accent_color,
            'secondary_color' => $a->secondary_color,
            'starts_at' => optional($a->starts_at)->toIso8601String(),
            'ends_at' => optional($a->ends_at)->toIso8601String(),
            'is_enabled' => (bool)$a->is_enabled,
            'is_live' => $a->isLive(),
        ];
    }
}