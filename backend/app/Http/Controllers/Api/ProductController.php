<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Models\Promotion;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

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

        if (isset($validated['image_data'])) {
            $val = trim((string) $validated['image_data']);
            if (
                $val === '' ||
                str_starts_with($val, 'http://') ||
                str_starts_with($val, 'https://') ||
                str_starts_with($val, '/api/') ||
                str_contains($val, '/api/products/')
            ) {
                unset($validated['image_data']);
            }
        }

        $product->update($validated);

        return response()->json([
            'message' => 'Product updated successfully.',
            'data'    => $this->formatProduct($product->fresh()),
        ]);
    }

    public function image(Request $request, Product $product): Response|JsonResponse
    {
        $storedImage = $product->image_data;
        if (!$storedImage) {
            return response()->json(['message' => 'No image available for this product.'], 404);
        }

        // If it's already an external HTTP(S) URL, redirect with caching
        if (str_starts_with($storedImage, 'http://') || str_starts_with($storedImage, 'https://')) {
            return redirect()->away($storedImage, 302, [
                'Cache-Control' => 'public, max-age=604800',
            ]);
        }

        $decoded = $this->decodeStoredImage($storedImage);
        if (!$decoded) {
            return response()->json(['message' => 'Invalid image format.'], 404);
        }

        [$imageBytes, $mimeType] = $decoded;

        $isFull = $request->boolean('full');
        if (!$isFull) {
            $thumbnail = $this->buildProductThumbnail($imageBytes, $product);
            if ($thumbnail) {
                [$imageBytes, $mimeType] = $thumbnail;
            }
        }

        return $this->imageResponse($request, $imageBytes, $mimeType, $product->updated_at);
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

    private function imageResponse(Request $request, string $imageBytes, string $mimeType, ?\DateTimeInterface $updatedAt): Response
    {
        $etag = '"' . hash('sha256', $imageBytes) . '"';
        if ($request->header('If-None-Match') === $etag) {
            return response('', 304, [
                'ETag'          => $etag,
                'Cache-Control' => 'public, max-age=604800, max-stale=86400, stale-while-revalidate=86400',
            ]);
        }

        $headers = [
            'Content-Type'   => $mimeType,
            'Content-Length' => (string) strlen($imageBytes),
            'ETag'           => $etag,
            'Cache-Control'  => 'public, max-age=604800, max-stale=86400, stale-while-revalidate=86400',
        ];

        if ($updatedAt) {
            $headers['Last-Modified'] = Carbon::instance($updatedAt)->toRfc7231String();
        }

        return response($imageBytes, 200, $headers);
    }

    private function decodeStoredImage(?string $storedImage): ?array
    {
        if (!is_string($storedImage) || $storedImage === '') {
            return null;
        }

        $commaPosition = strpos($storedImage, ',');
        if ($commaPosition === false) {
            return null;
        }

        $header = substr($storedImage, 0, $commaPosition);
        if (!preg_match('/^data:(image\/(?:png|jpe?g|gif|webp));base64$/i', $header, $matches)) {
            return null;
        }

        $imageBytes = base64_decode(substr($storedImage, $commaPosition + 1), true);
        if (!is_string($imageBytes) || $imageBytes === '') {
            return null;
        }

        $mimeType = strtolower($matches[1]);
        if ($mimeType === 'image/jpg') {
            $mimeType = 'image/jpeg';
        }

        return [$imageBytes, $mimeType];
    }

    private function buildProductThumbnail(string $sourceBytes, Product $product): ?array
    {
        if (!function_exists('imagecreatefromstring')) {
            return null;
        }

        $useWebp = function_exists('imagewebp');
        $extension = $useWebp ? 'webp' : 'jpg';
        $mimeType = $useWebp ? 'image/webp' : 'image/jpeg';
        $version = $product->updated_at?->format('YmdHis') ?? 'unversioned';
        $cachePath = 'product-thumbnails/' . $product->id . '-' . $version . '.' . $extension;

        try {
            if (Storage::disk('local')->exists($cachePath)) {
                $cached = Storage::disk('local')->get($cachePath);
                if (is_string($cached) && $cached !== '') {
                    return [$cached, $mimeType];
                }
            }

            $imageInfo = @getimagesizefromstring($sourceBytes);
            $sourceWidth = (int) ($imageInfo[0] ?? 0);
            $sourceHeight = (int) ($imageInfo[1] ?? 0);
            if ($sourceWidth < 1 || $sourceHeight < 1 || ($sourceWidth * $sourceHeight) > 40_000_000) {
                return null;
            }

            $source = @imagecreatefromstring($sourceBytes);
            if ($source === false) {
                return null;
            }

            $targetWidth = 400;
            $targetHeight = 400;
            $thumbnail = imagecreatetruecolor($targetWidth, $targetHeight);
            if ($thumbnail === false) {
                imagedestroy($source);
                return null;
            }

            $white = imagecolorallocate($thumbnail, 255, 255, 255);
            imagefill($thumbnail, 0, 0, $white);

            $cropSize = min($sourceWidth, $sourceHeight);
            $sourceX = (int) floor(($sourceWidth - $cropSize) / 2);
            $sourceY = (int) floor(($sourceHeight - $cropSize) / 2);

            imagecopyresampled(
                $thumbnail,
                $source,
                0,
                0,
                $sourceX,
                $sourceY,
                $targetWidth,
                $targetHeight,
                $cropSize,
                $cropSize
            );

            ob_start();
            $encoded = $useWebp
                ? imagewebp($thumbnail, null, 82)
                : imagejpeg($thumbnail, null, 85);
            $thumbnailBytes = ob_get_clean();

            imagedestroy($thumbnail);
            imagedestroy($source);

            if (!$encoded || !is_string($thumbnailBytes) || $thumbnailBytes === '') {
                return null;
            }

            Storage::disk('local')->put($cachePath, $thumbnailBytes);
            return [$thumbnailBytes, $mimeType];
        } catch (\Throwable $error) {
            Log::warning('[PRODUCT THUMBNAIL] Unable to build thumbnail', [
                'product_id' => $product->id,
                'message' => $error->getMessage(),
            ]);
            return null;
        }
    }

    private function resolveProductImageUrl(Product $product): ?string
    {
        if (empty($product->image_data)) {
            return null;
        }

        if (str_starts_with($product->image_data, 'http://') || str_starts_with($product->image_data, 'https://')) {
            return $product->image_data;
        }

        $version = $product->updated_at?->getTimestamp() ?? time();
        return url("/api/products/{$product->id}/image?v={$version}");
    }

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
            'image_data'     => $this->resolveProductImageUrl($product),
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
