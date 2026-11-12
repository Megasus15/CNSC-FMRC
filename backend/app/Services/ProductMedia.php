<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductMediaAsset;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;

/** Private staging, atomic gallery publication, and immutable published references. */
final class ProductMedia
{
    private const IMAGE_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];

    public static function stage(UploadedFile $file, int $owner): ProductMediaAsset
    {
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());
        $extension = strtolower($file->getClientOriginalExtension());
        $image = isset(self::IMAGE_TYPES[$mime]);
        if (! $file->isValid() || (! $image && ($mime !== 'video/mp4' || $extension !== 'mp4'))
            || ($image && ! in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true))) {
            self::invalid('Choose a JPG, PNG, WebP, GIF photo or an MP4 video.');
        }
        if ($file->getSize() > ($image ? 5 : 50) * 1024 * 1024) {
            self::invalid($image ? 'Each photo must be 5 MB or smaller.' : 'Each video must be 50 MB or smaller.');
        }
        if ($image) {
            $info = @getimagesize($file->getRealPath());
            if (! $info || $info[0] * $info[1] > 40_000_000) self::invalid('Choose a valid photo of 40 megapixels or less.');
        }
        // Uploads are individual requests, never one 140 MB multipart request.
        $path = $file->storeAs('product-media', Str::uuid().'.'.($image ? self::IMAGE_TYPES[$mime] : 'mp4'), 'local');
        abort_unless($path, 503, 'Media storage is unavailable. Please try again.');
        try {
            return ProductMediaAsset::create([
                'owner_id' => $owner, 'upload_token' => Str::uuid(), 'path' => $path,
                'name' => mb_substr(basename(str_replace('\\', '/', $file->getClientOriginalName())), 0, 200),
                'mime' => $mime, 'type' => $image ? 'image' : 'video', 'size' => $file->getSize(), 'expires_at' => now()->addDay(),
            ]);
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
    }

    public static function descriptor(ProductMediaAsset $asset, bool $draft = false): array
    {
        $url = $asset->source_url ?: url('/api/product-media/'.$asset->id);
        return array_filter([
            'id' => $asset->id, 'token' => $draft ? $asset->upload_token : null,
            'name' => $asset->name, 'type' => $asset->type, 'size' => $asset->size,
            'url' => $draft ? null : $url,
            'thumbnail_url' => ! $draft && $asset->type === 'image' ? ($asset->source_url ?: $url.'?thumbnail=1') : null,
        ], fn ($value) => $value !== null);
    }

    public static function gallery(Product $product): array
    {
        if (! $product->media_managed) {
            $image = self::legacyUrl($product);
            return ['media' => $image ? [['id' => 'legacy', 'legacy' => true, 'name' => 'Current product photo', 'type' => 'image',
                'url' => str_contains($image, '/api/products/') ? $image.'&full=1' : $image, 'thumbnail_url' => $image]] : [],
                'cover' => $image ? 'legacy' : null, 'media_revision' => 0];
        }
        return ['media' => $product->mediaItems->map(fn ($asset) => self::descriptor($asset))->all(),
            'cover' => $product->cover_media_id ? (string) $product->cover_media_id : null, 'media_revision' => $product->media_revision];
    }

    public static function legacyUrl(Product $product): ?string
    {
        if (! $product->image_data) return null;
        if (preg_match('~^https?://~i', $product->image_data)) return $product->image_data;
        return url('/api/products/'.$product->id.'/image?v='.($product->updated_at?->getTimestamp() ?? 0));
    }

    public static function coverUrl(Product $product): ?string
    {
        if (! $product->media_managed) return self::legacyUrl($product);
        return $product->coverMedia ? self::descriptor($product->coverMedia)['thumbnail_url'] : null;
    }

    /** Called inside the product transaction, with its row locked. */
    public static function commit(Product $product, Request $request): void
    {
        if (! $request->exists('media')) return; // old integrations retain their single-image behavior
        $request->validate([
            'media' => 'present|array|max:10', 'media.*' => 'required|array',
            'media.*.id' => 'sometimes|integer|min:1', 'media.*.token' => 'sometimes|uuid', 'media.*.legacy' => 'sometimes|boolean',
            'cover' => 'present|nullable|string|max:80', 'media_revision' => 'required|integer|min:0',
        ]);
        abort_unless((int) $product->media_revision === $request->integer('media_revision'), 409,
            'This product gallery changed in another session. Your draft is kept. Close and reopen the product to load the latest gallery.');
        $assets = []; $keys = []; $cover = null;
        foreach ($request->input('media') as $entry) {
            if ((int) isset($entry['id']) + (int) isset($entry['token']) + (int) ! empty($entry['legacy']) !== 1) self::invalid('A gallery item is invalid. Please select its file again.', 'media');
            if (! empty($entry['legacy'])) {
                if ($product->media_managed || ! $product->image_data) self::invalid('The previous photo is no longer available. Refresh this product.', 'media');
                $key = 'legacy';
                $asset = new ProductMediaAsset(['type' => 'image']);
            } elseif (isset($entry['token'])) {
                $key = $entry['token'];
                $asset = ProductMediaAsset::where('upload_token', $key)->lockForUpdate()->first();
                if (! $asset || $asset->owner_id !== $request->user()->id || $asset->published_at || ! $asset->expires_at?->isFuture()
                    || ! Storage::disk('local')->exists($asset->path)) self::invalid('An upload expired or belongs to another account. Remove it and upload the file again.', 'media');
            } else {
                $key = (string) $entry['id'];
                $asset = ProductMediaAsset::whereKey($entry['id'])->where('product_id', $product->id)->whereNotNull('published_at')->lockForUpdate()->first();
                if (! $asset) self::invalid('A gallery item no longer belongs to this product. Refresh its details.', 'media');
            }
            if (in_array($key, $keys, true)) self::invalid('Each gallery item may appear only once.', 'media');
            $keys[] = $key;
            if ($request->input('cover') === $key) $cover = $asset;
            $assets[] = $asset;
        }
        if (count(array_filter($assets, fn ($asset) => $asset->type === 'video')) > 2) self::invalid('Choose up to two MP4 videos per product.', 'media');
        if ($assets && (! $cover || $cover->type !== 'image')) self::invalid('Choose a cover photo for this product. Videos need a photo cover.', 'cover');
        if (! $assets && $request->input('cover') !== null) self::invalid('The cover must be one of the gallery photos.', 'cover');
        // Detached published assets remain available to carts/order snapshots. Only drafts expire.
        ProductMediaAsset::where('product_id', $product->id)->whereNotIn('id', array_filter(array_map(fn ($asset) => $asset->id, $assets)))->update(['product_id' => null]);
        foreach ($assets as $position => $asset) {
            if (! $asset->exists) {
                $isCover = $cover === $asset;
                $asset = self::legacyAsset($product);
                if ($isCover) $cover = $asset;
            }
            $asset->forceFill(['product_id' => $product->id, 'position' => $position, 'published_at' => $asset->published_at ?? now(), 'expires_at' => null])->save();
        }
        $product->forceFill(['cover_media_id' => $cover?->id, 'media_managed' => true, 'media_revision' => $product->media_revision + 1])->save();
    }

    private static function legacyAsset(Product $product): ProductMediaAsset
    {
        // Preserve the original stored photo/endpoint; publish a separate immutable copy.
        $value = $product->image_data;
        $attributes = ['name' => 'Original product photo', 'type' => 'image', 'mime' => 'image/jpeg', 'published_at' => now()];
        if (preg_match('~^https?://~i', $value)) {
            $attributes['source_url'] = $value;
        } elseif (preg_match('~^data:(image/(?:jpeg|jpg|png|webp|gif));base64,(.+)$~s', $value, $matches)
            && ($bytes = base64_decode($matches[2], true)) !== false && @getimagesizefromstring($bytes)) {
            $mime = $matches[1] === 'image/jpg' ? 'image/jpeg' : $matches[1];
            $path = 'product-media/legacy-'.hash('sha256', $bytes).'.'.self::IMAGE_TYPES[$mime];
            abort_unless(Storage::disk('local')->put($path, $bytes), 503, 'The existing photo could not be saved. Please try again.');
            $attributes += ['path' => $path, 'size' => strlen($bytes)];
            $attributes['mime'] = $mime;
        } else {
            self::invalid('The existing photo cannot be read. Remove it and upload a replacement.', 'media');
        }
        return ProductMediaAsset::create($attributes);
    }

    public static function discard(string $token, int $owner): void
    {
        DB::transaction(function () use ($token, $owner) {
            $asset = ProductMediaAsset::where('upload_token', $token)->where('owner_id', $owner)->lockForUpdate()->firstOrFail();
            // A lost save response must never let Cancel delete an already-published file.
            if ($asset->published_at) return;
            abort_unless(! Storage::disk('local')->exists($asset->path) || Storage::disk('local')->delete($asset->path), 503, 'The draft could not be removed. Please try again.');
            $asset->delete();
        });
    }

    public static function cleanExpired(): int
    {
        $count = 0;
        ProductMediaAsset::whereNull('published_at')->where('expires_at', '<=', now())->select('id')->chunkById(100, function ($rows) use (&$count) {
            foreach ($rows as $row) DB::transaction(function () use ($row, &$count) {
                $asset = ProductMediaAsset::whereKey($row->id)->whereNull('published_at')->where('expires_at', '<=', now())->lockForUpdate()->first();
                if (! $asset) return;
                if (! Storage::disk('local')->exists($asset->path) || Storage::disk('local')->delete($asset->path)) { $asset->delete(); $count++; }
            });
        });
        return $count;
    }

    public static function response(Request $request, ProductMediaAsset $asset): BinaryFileResponse|RedirectResponse
    {
        abort_unless($asset->published_at, 404);
        if ($asset->source_url) return redirect()->away($asset->source_url);
        $disk = Storage::disk('local');
        abort_unless($asset->path && $disk->exists($asset->path), 404);
        $path = $asset->path; $mime = $asset->mime;
        if ($request->boolean('thumbnail') && $asset->type === 'image' && function_exists('imagecreatefromstring')) {
            $thumbnail = 'product-media-thumbnails/'.$asset->id.'.webp';
            if (! $disk->exists($thumbnail)) {
                $info = @getimagesize($disk->path($path));
                if ($info && $info[0] * $info[1] <= 40_000_000 && function_exists('imagewebp')) {
                    $source = @imagecreatefromstring($disk->get($path));
                    if ($source) {
                        $scale = min(1, 480 / max($info[0], $info[1]));
                        $target = imagecreatetruecolor(max(1, (int) ($info[0] * $scale)), max(1, (int) ($info[1] * $scale)));
                        imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
                        imagecopyresampled($target, $source, 0, 0, 0, 0, imagesx($target), imagesy($target), $info[0], $info[1]);
                        ob_start(); imagewebp($target, null, 82); $bytes = ob_get_clean();
                        imagedestroy($target); imagedestroy($source);
                        if ($bytes) $disk->put($thumbnail, $bytes);
                    }
                }
            }
            if ($disk->exists($thumbnail)) { $path = $thumbnail; $mime = 'image/webp'; }
        }
        $response = response()->file($disk->path($path), ['Content-Type' => $mime,
            'Content-Disposition' => 'inline; filename="product-media-'.$asset->id.'.'.pathinfo($path, PATHINFO_EXTENSION).'"',
            'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'public, max-age=604800, immutable',
            'ETag' => '"product-media-'.$asset->id.'-'.hash('sha256', $path).'"']);
        $response->isNotModified($request);
        return $response;
    }

    private static function invalid(string $message, string $field = 'file'): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
