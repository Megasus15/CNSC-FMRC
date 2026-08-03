<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class ProductController extends Controller
{
    // ─── Public: Customer-facing (non-blocked products only) ───────────────────

    public function index(): JsonResponse
    {
        $products = Product::where('is_blocked', false)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn($p) => $this->formatProduct($p));

        return response()->json(['data' => $products]);
    }

    // ─── Admin: All products including blocked ──────────────────────────────────

    public function adminIndex(): JsonResponse
    {
        $products = Product::orderByDesc('created_at')->get()
            ->map(fn($p) => $this->formatProduct($p));

        return response()->json(['data' => $products]);
    }

    public function catalogOptions(Request $request): JsonResponse
    {
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

    // ─── Admin: Product names for walk-in item detail dropdown ──────────────────

    public function productNames(): JsonResponse
    {
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

    public function destroy(Product $product): JsonResponse
    {
        $product->delete();

        return response()->json(['message' => 'Product deleted successfully.']);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private function formatProduct(Product $product): array
    {
        $promotion = Promotion::query()->where('is_enabled', true)->get()
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
            'promotion' => $promotion ? ['id' => $promotion->id, 'title' => $promotion->title, 'ends_at' => optional($promotion->ends_at)->toIso8601String()] : null,
            'stock_status'   => $product->stock_status,
            'is_blocked'     => (bool) $product->is_blocked,
            'image_data'     => $product->image_data,
            'summary'        => $product->summary,
            'details_chips'  => $product->details_chips ?? [],
            'availability'   => $product->availability ?? [],
            'recommended_for'=> $product->recommended_for ?? [],
            'created_at'     => $product->created_at,
            'updated_at'     => $product->updated_at,
        ];
    }
}
