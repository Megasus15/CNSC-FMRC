<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Promotion;
use App\Models\AdminNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class PromotionController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['data' => Promotion::latest()->get()->map(fn($p) => $this->format($p))]);
    }

    public function store(Request $request): JsonResponse
    {
        $p = Promotion::create($this->validated($request) + ['created_by' => $request->user()->id]);

        AdminNotification::create([
            'type' => 'info',
            'title' => 'Product Promotion Saved',
            'message' => "Promotion '{$p->title}' ({$p->discount_percent}% off) was saved.",
            'is_read' => false,
        ]);

        return response()->json(['data' => $this->format($p), 'message' => 'Promotion saved.'], 201);
    }

    public function update(Request $request, Promotion $promotion): JsonResponse
    {
        $promotion->update($this->validated($request));
        $fresh = $promotion->fresh();

        AdminNotification::create([
            'type' => 'info',
            'title' => 'Product Promotion Updated',
            'message' => "Promotion '{$fresh->title}' ({$fresh->discount_percent}% off) was updated.",
            'is_read' => false,
        ]);

        return response()->json(['data' => $this->format($fresh), 'message' => 'Promotion updated.']);
    }

    public function destroy(Promotion $promotion): JsonResponse
    {
        $promotion->delete();
        return response()->json(['message' => 'Promotion deleted.']);
    }

    public function active(): JsonResponse
    {
        $promotions = Promotion::where('is_enabled', true)
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

        return $d;
    }

    private function format(Promotion $p): array
    {
        return [
            'id' => $p->id,
            'title' => $p->title,
            'discount_percent' => (int)$p->discount_percent,
            'scope' => $p->scope,
            'product_ids' => $p->product_ids ?? [],
            'starts_at' => optional($p->starts_at)->toIso8601String(),
            'ends_at' => optional($p->ends_at)->toIso8601String(),
            'is_enabled' => (bool)$p->is_enabled,
            'is_live' => $p->isLive(),
        ];
    }
}