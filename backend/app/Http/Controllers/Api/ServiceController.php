<?php

namespace App\Http\Controllers\Api;

use App\Models\Service;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ServiceController extends Controller
{
    // ─── Public ─────────────────────────────────────────────────────────────────

    public function index(): JsonResponse
    {
        $services = Service::orderBy('sort_order')->orderBy('id')->get()
            ->map(fn($s) => $this->format($s));

        return response()->json(['data' => $services]);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    public function adminIndex(): JsonResponse
    {
        return $this->index();
    }

    public function image(Request $request, Service $service): Response|JsonResponse
    {
        $storedImage = $service->image_data;
        if (!$storedImage) {
            return response()->json(['message' => 'No image available for this service.'], 404);
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
            $thumbnail = $this->buildServiceThumbnail($imageBytes, $service);
            if ($thumbnail) {
                [$imageBytes, $mimeType] = $thumbnail;
            }
        }

        return $this->imageResponse($request, $imageBytes, $mimeType, $service->updated_at);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title'             => 'required|string|max:255',
            'category'          => 'required|string|max:100',
            'description'       => 'nullable|string',
            'image_data'        => 'nullable|string',
            'modal_description' => 'nullable|string',
            'modal_features'    => 'nullable|array',
            'modal_features.*'  => 'string|max:200',
            'modal_materials'   => 'nullable|array',
            'modal_materials.*' => 'string|max:200',
            'modal_best_for'    => 'nullable|array',
            'modal_best_for.*'  => 'string|max:200',
            'sort_order'        => 'integer|min:0',
        ]);

        $service = Service::create($validated);

        return response()->json([
            'message' => 'Service created successfully.',
            'data'    => $this->format($service),
        ], 201);
    }

    public function update(Request $request, Service $service): JsonResponse
    {
        $validated = $request->validate([
            'title'             => 'required|string|max:255',
            'category'          => 'required|string|max:100',
            'description'       => 'nullable|string',
            'image_data'        => 'nullable|string',
            'modal_description' => 'nullable|string',
            'modal_features'    => 'nullable|array',
            'modal_features.*'  => 'string|max:200',
            'modal_materials'   => 'nullable|array',
            'modal_materials.*' => 'string|max:200',
            'modal_best_for'    => 'nullable|array',
            'modal_best_for.*'  => 'string|max:200',
            'sort_order'        => 'integer|min:0',
        ]);

        if (isset($validated['image_data'])) {
            $val = trim((string) $validated['image_data']);
            if (
                $val === '' ||
                str_starts_with($val, 'http://') ||
                str_starts_with($val, 'https://') ||
                str_starts_with($val, '/api/') ||
                str_contains($val, '/api/services/')
            ) {
                unset($validated['image_data']);
            }
        }

        $service->update($validated);

        return response()->json([
            'message' => 'Service updated successfully.',
            'data'    => $this->format($service->fresh()),
        ]);
    }

    public function destroy(Service $service): JsonResponse
    {
        $service->delete();

        return response()->json(['message' => 'Service deleted successfully.']);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────────

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

    private function buildServiceThumbnail(string $sourceBytes, Service $service): ?array
    {
        if (!function_exists('imagecreatefromstring')) {
            return null;
        }

        $useWebp = function_exists('imagewebp');
        $extension = $useWebp ? 'webp' : 'jpg';
        $mimeType = $useWebp ? 'image/webp' : 'image/jpeg';
        $version = $service->updated_at?->format('YmdHis') ?? 'unversioned';
        $cachePath = 'service-thumbnails/' . $service->id . '-' . $version . '.' . $extension;

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

            $targetWidth = 600;
            $targetHeight = 400;
            $thumbnail = imagecreatetruecolor($targetWidth, $targetHeight);
            if ($thumbnail === false) {
                imagedestroy($source);
                return null;
            }

            $white = imagecolorallocate($thumbnail, 255, 255, 255);
            imagefill($thumbnail, 0, 0, $white);

            // Cover resize
            $sourceRatio = $sourceWidth / $sourceHeight;
            $targetRatio = $targetWidth / $targetHeight;

            if ($sourceRatio > $targetRatio) {
                $cropWidth = (int) floor($sourceHeight * $targetRatio);
                $cropHeight = $sourceHeight;
                $sourceX = (int) floor(($sourceWidth - $cropWidth) / 2);
                $sourceY = 0;
            } else {
                $cropWidth = $sourceWidth;
                $cropHeight = (int) floor($sourceWidth / $targetRatio);
                $sourceX = 0;
                $sourceY = (int) floor(($sourceHeight - $cropHeight) / 2);
            }

            imagecopyresampled(
                $thumbnail,
                $source,
                0,
                0,
                $sourceX,
                $sourceY,
                $targetWidth,
                $targetHeight,
                $cropWidth,
                $cropHeight
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
            Log::warning('[SERVICE THUMBNAIL] Unable to build thumbnail', [
                'service_id' => $service->id,
                'message' => $error->getMessage(),
            ]);
            return null;
        }
    }

    private function resolveServiceImageUrl(Service $service): ?string
    {
        if (empty($service->image_data)) {
            return null;
        }

        if (str_starts_with($service->image_data, 'http://') || str_starts_with($service->image_data, 'https://')) {
            return $service->image_data;
        }

        $version = $service->updated_at?->getTimestamp() ?? time();
        return url("/api/services/{$service->id}/image?v={$version}");
    }

    private function format(Service $s): array
    {
        return [
            'id'                => $s->id,
            'title'             => $s->title,
            'category'          => $s->category,
            'description'       => $s->description,
            'image_data'        => $this->resolveServiceImageUrl($s),
            'modal_description' => $s->modal_description,
            'modal_features'    => $s->modal_features ?? [],
            'modal_materials'   => $s->modal_materials ?? [],
            'modal_best_for'    => $s->modal_best_for ?? [],
            'sort_order'        => $s->sort_order,
            'created_at'        => $s->created_at,
            'updated_at'        => $s->updated_at,
        ];
    }
}
