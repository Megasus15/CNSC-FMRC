<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ProductController extends Controller
{
    private const SCHEDULE_TIME_ZONE = 'Asia/Manila';

    // ─── Public: Customer-facing (non-blocked products only) ───────────────────

    public function index(): JsonResponse
    {
        $promotionCandidates = $this->promotionCandidates();
        $products = Product::where('is_blocked', false)
            ->withCount('activeRatings as ratings_count')
            ->withAvg('activeRatings as ratings_avg_stars', 'stars')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn($p) => $this->formatProduct($p, $promotionCandidates));

        return response()->json(['data' => $products]);
    }

    // ─── Admin: All products including blocked ──────────────────────────────────

    public function adminIndex(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $promotionCandidates = $this->promotionCandidates();
        $products = Product::withCount('activeRatings as ratings_count')
            ->withAvg('activeRatings as ratings_avg_stars', 'stars')
            ->orderByDesc('created_at')->get()
            ->map(fn($p) => $this->formatProduct($p, $promotionCandidates));

        return response()->json(['data' => $products]);
    }

    public function catalogOptions(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'category' => 'required|string|max:100',
        ]);

        $products = Product::query()
            ->where('category', trim($validated['category']))
            ->orderBy('name')
            ->get(['id', 'name', 'code', 'category'])
            ->map(fn (Product $product) => [
                'id' => (int) $product->id,
                'name' => $product->name,
                'code' => $product->code,
                'category' => $product->category,
            ]);

        return response()->json([
            'data' => $products,
        ]);
    }

    public function promotionOptions(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        return response()->json([
            'data' => Product::query()
                ->orderBy('name')
                ->get(['id', 'name', 'code', 'category'])
                ->map(fn (Product $product) => [
                    'id' => (int) $product->id,
                    'name' => $product->name,
                    'code' => $product->code,
                    'category' => $product->category,
                ]),
        ]);
    }

    // ─── Admin: Product names for walk-in item detail dropdown ──────────────────

    public function productNames(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $names = Product::orderBy('name')
            ->pluck('name')
            ->unique()
            ->values();

        return response()->json([
            'data' => $names,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'name'           => 'required|string|max:255',
            'category'       => 'required|string|max:100',
            'code'           => 'required|string|max:100|unique:products,code',
            'stock'          => 'required|integer|min:0',
            'price'          => 'required|numeric|min:0',
            'stock_status'   => 'required|in:in_stock,out_of_stock',
            'is_blocked'     => 'boolean',
            'image_data'     => 'nullable|string',
            'summary'        => 'nullable|string',
            'details_chips'  => 'nullable|array',
            'details_chips.*'=> 'string|max:200',
            'availability'   => 'nullable|array',
            'availability.*' => 'string|max:200',
            'recommended_for'   => 'nullable|array',
            'recommended_for.*' => 'string|max:200',
        ]);

        $product = Product::create($validated);

        return response()->json([
            'message' => 'Product created successfully.',
            'data'    => $this->formatProduct($product),
        ], 201);
    }

    public function update(Request $request, Product $product): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'name'           => 'required|string|max:255',
            'category'       => 'required|string|max:100',
            'code'           => 'required|string|max:100|unique:products,code,' . $product->id,
            'stock'          => 'required|integer|min:0',
            'price'          => 'required|numeric|min:0',
            'stock_status'   => 'required|in:in_stock,out_of_stock',
            'is_blocked'     => 'boolean',
            'image_data'     => 'nullable|string',
            'summary'        => 'nullable|string',
            'details_chips'  => 'nullable|array',
            'details_chips.*'=> 'string|max:200',
            'availability'   => 'nullable|array',
            'availability.*' => 'string|max:200',
            'recommended_for'   => 'nullable|array',
            'recommended_for.*' => 'string|max:200',
        ]);

        $product->update($validated);

        return response()->json([
            'message' => 'Product updated successfully.',
            'data'    => $this->formatProduct($product->fresh()),
        ]);
    }

    public function deleteBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);

        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();
        $deletedIds = DB::transaction(function () use ($ids): array {
            $eligibleIds = Product::query()
                ->whereIn('id', $ids)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($eligibleIds) {
                Product::destroy($eligibleIds);
            }

            return $eligibleIds;
        });

        if (!$deletedIds) {
            return response()->json(['message' => 'No matching products were found to delete.'], 404);
        }

        return response()->json([
            'action' => 'delete',
            'scope' => 'products',
            'processed_ids' => $deletedIds,
            'processed_count' => count($deletedIds),
            'skipped_ids' => array_values(array_diff($ids, $deletedIds)),
            'message' => count($deletedIds) . ' product(s) deleted successfully.',
        ]);
    }

    public function destroy(Request $request, Product $product): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $product->delete();

        return response()->json(['message' => 'Product deleted successfully.']);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private function formatProduct(Product $product, ?Collection $promotionCandidates = null): array
    {
        $promotion = ($promotionCandidates ?? $this->promotionCandidates())
            ->filter(fn (Promotion $candidate) => $candidate->appliesTo($product))
            ->sortByDesc('discount_percent')
            ->first();
        $price = (float) $product->price;
        $discountPercent = $promotion ? (int) $promotion->discount_percent : 0;
        $salePrice = round($price * (1 - ($discountPercent / 100)), 2);

        return [
            'id'             => $product->id,
            'name'           => $product->name,
            'category'       => $product->category,
            'code'           => $product->code,
            'stock'          => $product->stock,
            'price'          => $price,
            'sale_price'     => $salePrice,
            'discount_percent' => $discountPercent,
            'promotion' => $promotion ? [
                'id' => $promotion->id,
                'title' => $promotion->title,
                'ends_at' => $promotion->ends_at?->copy()->timezone(self::SCHEDULE_TIME_ZONE)->toIso8601String(),
            ] : null,
            'stock_status'   => $product->stock_status,
            'is_blocked'     => (bool) $product->is_blocked,
            'image_data'     => $product->image_data,
            'summary'        => $product->summary,
            'details_chips'  => $product->details_chips ?? [],
            'availability'   => $product->availability ?? [],
            'recommended_for'=> $product->recommended_for ?? [],
            'review_count'   => (int) ($product->ratings_count ?? 0),
            'rating_average' => round((float) ($product->ratings_avg_stars ?? 0), 1),
            'created_at'     => $product->created_at,
            'updated_at'     => $product->updated_at,
        ];
    }

    private function promotionCandidates(): Collection
    {
        return Promotion::query()
            ->where('is_enabled', true)
            ->where('is_archived', false)
            ->get();
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
