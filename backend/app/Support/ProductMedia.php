<?php

namespace App\Support;

use App\Models\Product;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** Product gallery files are private until the product's manifest references them. */
final class ProductMedia
{
    private const TYPES = [
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
        'video/mp4' => 'mp4', 'video/webm' => 'webm',
    ];

    public static function validateCover(string $attribute, mixed $value, \Closure $fail): void
    {
        if ($value === null || $value === '' || preg_match('~^(https?://|/api/)~i', $value)) return;
        if (! preg_match('~^data:(image/(?:jpeg|png|webp));base64,(.+)$~s', $value, $match)) {
            $fail('Choose a JPG, PNG or WebP cover image.');
            return;
        }
        if (strlen($match[2]) > 4 * ceil(10 * 1024 * 1024 / 3)) {
            $fail('The cover image must be 10 MB or smaller.');
            return;
        }
        $bytes = base64_decode($match[2], true);
        if ($bytes !== false && strlen($bytes) > 10 * 1024 * 1024) {
            $fail('The cover image must be 10 MB or smaller.');
            return;
        }
        $image = $bytes === false ? false : @getimagesizefromstring($bytes);
        if (! $image || ($image['mime'] ?? null) !== $match[1]) $fail('Choose a readable JPG, PNG or WebP cover image.');
    }

    public static function stage(UploadedFile $file, Product $product, int $owner): array
    {
        $mime = $file->getMimeType();
        $video = str_starts_with((string) $mime, 'video/');
        $limit = ($video ? 30 : 10) * 1024 * 1024;
        $fail = static fn (string $message) => throw ValidationException::withMessages(['file' => $message]);
        if (! isset(self::TYPES[$mime])) {
            $fail('Choose a JPG, PNG, WebP, MP4, or WebM file.');
        }
        if ($file->getSize() > $limit) {
            $fail($video ? 'The video must be 30 MB or smaller.' : 'Each image must be 10 MB or smaller.');
        }
        $duration = null;
        if ($video) {
            $info = (new \getID3)->analyze($file->getRealPath());
            $duration = (float) ($info['playtime_seconds'] ?? 0);
            if (! empty($info['error']) || empty($info['video']) || ! is_finite($duration) || $duration <= 0) {
                $fail('This video could not be read. Export it as MP4 or WebM and try again.');
            }
            if ($duration > 30) {
                $fail('The video must be 30 seconds or shorter.');
            }
        } elseif (! @getimagesize($file->getRealPath())) {
            $fail('This image could not be read. Choose a valid JPG, PNG, or WebP image.');
        }

        $disk = Storage::disk('local');
        $token = (string) Str::uuid();
        $directory = 'product-media-drafts/'.$product->id;
        $path = $file->storeAs($directory, $token.'.'.self::TYPES[$mime], 'local');
        abort_unless($path, 503, 'The upload could not be stored. Please try again.');
        $receipt = [
            'id' => $token, 'owner' => $owner, 'product_id' => (int) $product->id,
            'path' => $path, 'type' => $video ? 'video' : 'image', 'mime' => $mime,
            'size' => $file->getSize(), 'duration_seconds' => $duration,
            'expires_at' => now()->addDay()->timestamp,
        ];
        if (! $disk->put($directory.'/'.$token.'.json', json_encode($receipt, JSON_THROW_ON_ERROR))) {
            $disk->delete($path);
            abort(503, 'The upload could not be stored. Please try again.');
        }

        return ['upload_token' => $token, 'type' => $receipt['type'], 'duration_seconds' => $duration];
    }

    public static function draft(Product $product, string $token, int $owner): array
    {
        abort_unless(Str::isUuid($token), 404);
        $raw = Storage::disk('local')->get('product-media-drafts/'.$product->id.'/'.$token.'.json');
        $draft = $raw ? json_decode($raw, true) : null;
        if (! is_array($draft) || ($draft['owner'] ?? null) !== $owner
            || ($draft['product_id'] ?? null) !== (int) $product->id
            || ($draft['expires_at'] ?? 0) <= now()->timestamp
            || ! Storage::disk('local')->exists($draft['path'])) {
            throw ValidationException::withMessages(['gallery_media' => 'This upload has expired or belongs to another editor. Upload the file again.']);
        }

        return $draft;
    }

    public static function discard(Product $product, string $token, int $owner): void
    {
        $draft = self::draft($product, $token, $owner);
        Storage::disk('local')->delete([$draft['path'], 'product-media-drafts/'.$product->id.'/'.$token.'.json']);
    }

    /** Validate everything before copying files or updating any product fields. */
    public static function resolve(Product $product, array $input, int $owner, mixed $cover): array
    {
        $fail = static fn (string $message) => throw ValidationException::withMessages(['gallery_media' => $message]);
        if (count($input) > 4) $fail('Use up to five gallery items, including the cover image.');
        if ($input && ! $cover) $fail('Choose a cover image before adding gallery media.');
        $existing = collect($product->gallery_media ?? [])->keyBy('id');
        $items = [];
        $drafts = [];
        foreach ($input as $entry) {
            if (! empty($entry['upload_token']) && empty($entry['id'])) {
                $draft = self::draft($product, $entry['upload_token'], $owner);
                $id = $draft['id'];
                // Stable IDs and retained draft files make a lost-response retry safe.
                $item = $existing->get($id) ?? array_diff_key($draft, array_flip(['owner', 'product_id', 'expires_at']));
                $item['path'] = 'product-media/'.$product->id.'/'.$id.'.'.self::TYPES[$item['mime']];
                $drafts[] = [$draft['path'], $item['path']];
            } elseif (! empty($entry['id']) && empty($entry['upload_token']) && $existing->has($entry['id'])) {
                $item = $existing->get($entry['id']);
            } else {
                $fail('Choose media from this product or upload a new file.');
            }
            if (isset($items[$item['id']])) $fail('Each gallery item can appear only once.');
            $items[$item['id']] = $item;
        }
        if (collect($items)->where('type', 'video')->count() > 1) $fail('Only one short video can be added to a product.');
        $disk = Storage::disk('local');
        foreach ($drafts as [$from, $to]) {
            if (! $disk->exists($to)) abort_unless($disk->copy($from, $to), 503, 'The gallery could not be saved. Please try again.');
        }

        return array_values($items);
    }

    public static function references(Product $product, ?string $cover): array
    {
        $items = $cover ? [['id' => 'cover', 'type' => 'image', 'url' => $cover, 'duration_seconds' => null]] : [];
        foreach ($product->gallery_media ?? [] as $item) {
            $items[] = [
                'id' => $item['id'], 'type' => $item['type'],
                'url' => url('/api/products/'.$product->id.'/media/'.$item['id']),
                'duration_seconds' => $item['duration_seconds'] ?? null,
            ];
        }

        return $items;
    }

    /** Only paths produced by this service may be deleted. */
    public static function pruneProduct(int $id): void
    {
        // Serialize collection with publishing so a concurrent save cannot have
        // its newly copied, not-yet-committed file removed by another save.
        DB::transaction(function () use ($id) {
            $keep = array_column(Product::whereKey($id)->lockForUpdate()->first()?->gallery_media ?? [], 'path');
            $disk = Storage::disk('local');
            foreach ($disk->files('product-media/'.$id) as $path) {
                if (! in_array($path, $keep, true)) $disk->delete($path);
            }
        });
    }

    public static function cleanup(): void
    {
        $disk = Storage::disk('local');
        $cutoff = now()->subDay()->timestamp;
        foreach ($disk->allFiles('product-media-drafts') as $path) {
            if ($disk->lastModified($path) <= $cutoff) $disk->delete($path);
        }
        // Failed database/file writes can leave a copied file. A day's grace
        // avoids collecting a file while its publishing transaction is open.
        foreach ($disk->directories('product-media') as $directory) {
            $id = basename($directory);
            if (! ctype_digit($id)) continue;
            $keep = array_column(Product::find((int) $id)?->gallery_media ?? [], 'path');
            foreach ($disk->files($directory) as $path) {
                if (! in_array($path, $keep, true) && $disk->lastModified($path) <= $cutoff) $disk->delete($path);
            }
        }
    }
}
