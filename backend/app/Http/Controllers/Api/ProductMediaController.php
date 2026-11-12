<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use App\Support\ProductMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class ProductMediaController extends Controller
{
    private function authorizeEditor(Request $request): int
    {
        abort_unless(in_array($request->user()?->role, ['admin', 'staff'], true), 403);

        return (int) $request->user()->id;
    }

    public function store(Request $request, Product $product): JsonResponse
    {
        $owner = $this->authorizeEditor($request);
        $request->validate(['file' => ['required', 'file', 'max:30720']], ['file.max' => 'The file must be 30 MB or smaller. Images must be 10 MB or smaller.']);

        return response()->json(['data' => ProductMedia::stage($request->file('file'), $product, $owner)], 201);
    }

    public function destroy(Request $request, Product $product, string $token): JsonResponse
    {
        ProductMedia::discard($product, $token, $this->authorizeEditor($request));

        return response()->json(['message' => 'Upload discarded.']);
    }

    public function show(Request $request, Product $product, string $media): BinaryFileResponse
    {
        abort_if($product->is_blocked, 404);
        return $this->file($request, $product, $media);
    }

    public function editorShow(Request $request, Product $product, string $media): BinaryFileResponse
    {
        $this->authorizeEditor($request);
        $response = $this->file($request, $product, $media);
        $response->headers->set('Cache-Control', 'private, no-store');

        return $response;
    }

    private function file(Request $request, Product $product, string $media): BinaryFileResponse
    {
        $item = collect($product->gallery_media ?? [])->firstWhere('id', $media);
        abort_unless($item, 404);
        $disk = Storage::disk('local');
        abort_unless($disk->exists($item['path']), 404);
        // BinaryFileResponse supplies Content-Length, conditional requests and
        // byte ranges without loading an entire clip into application memory.
        $response = response()->file($disk->path($item['path']), [
            'Content-Type' => $item['mime'], 'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'public, max-age=3600', 'ETag' => '"'.$item['id'].'"',
        ]);
        $response->isNotModified($request);

        return $response;
    }

    public function preview(Request $request, Product $product, string $token): BinaryFileResponse
    {
        $item = ProductMedia::draft($product, $token, $this->authorizeEditor($request));

        $response = response()->file(Storage::disk('local')->path($item['path']), [
            'Content-Type' => $item['mime'], 'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
        $response->setPrivate();

        return $response;
    }
}
