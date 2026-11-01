<?php

namespace App\Support;

use App\Models\SiteSetting;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class SiteSettingsVideo
{
    public const MAX_BYTES = 50 * 1024 * 1024;

    private const TYPES = [
        'video/mp4' => 'mp4',
        'video/webm' => 'webm',
        'video/ogg' => 'ogv',
        'video/quicktime' => 'mov',
        'video/x-msvideo' => 'avi',
    ];

    public static function isEmbedded(mixed $value): bool
    {
        return is_string($value)
            && preg_match('/\Adata:(video\/(?:mp4|webm|ogg|quicktime|x-msvideo));base64,/i', $value) === 1;
    }

    public static function reference(string $value): string
    {
        return url('/api/site-settings/about-video').'?v='.(self::storedFile($value) ?? hash('sha256', $value));
    }

    public static function storedFile(mixed $value): ?string
    {
        if (! is_string($value) || ! str_starts_with($value, '/api/site-settings/about-video?')) {
            return null;
        }
        parse_str(parse_url($value, PHP_URL_QUERY) ?? '', $query);
        $file = $query['v'] ?? null;

        return is_string($file) && preg_match('/\A[a-f0-9]{64}\.(?:mp4|webm|ogv|mov|avi)\z/', $file) ? $file : null;
    }

    public static function stage(UploadedFile $video, int $owner): array
    {
        $disk = Storage::disk('local');
        $directory = 'site-setting-video-drafts/'.$owner;
        foreach ($disk->files($directory) as $old) {
            if ($disk->lastModified($old) < now()->subDay()->timestamp) {
                $disk->delete($old);
            }
        }
        $token = (string) Str::uuid();
        $extension = self::TYPES[$video->getMimeType()];
        $path = $video->storeAs($directory, $token.'.'.$extension, 'local');
        abort_unless($path, 503);
        Cache::put('about-video-upload:'.$token, ['owner' => $owner, 'path' => $path, 'extension' => $extension], now()->addDay());

        return ['token' => $token, 'name' => $video->getClientOriginalName(), 'size' => $video->getSize()];
    }

    public static function publish(string $token, int $owner): string
    {
        $draft = Cache::get('about-video-upload:'.$token);
        $disk = Storage::disk('local');
        if (! is_array($draft) || ($draft['owner'] ?? null) !== $owner || ! $disk->exists($draft['path'])) {
            throw ValidationException::withMessages(['about_video_upload_token' => 'Upload the video completely before saving your changes.']);
        }
        $file = hash_file('sha256', $disk->path($draft['path'])).'.'.$draft['extension'];
        $destination = 'site-setting-media/'.$file;
        if ($draft['path'] !== $destination) {
            if ($disk->exists($destination)) {
                $disk->delete($draft['path']);
            } else {
                abort_unless($disk->move($draft['path'], $destination), 503);
            }
        }
        // Keep the receipt briefly usable if the client retries after losing
        // the save response. It is never written to public site settings.
        Cache::put('about-video-upload:'.$token, array_replace($draft, ['path' => $destination, 'published' => true]), now()->addDay());

        return '/api/site-settings/about-video?v='.$file;
    }

    public static function discard(string $token, int $owner): void
    {
        $draft = Cache::get('about-video-upload:'.$token);
        abort_unless(is_array($draft) && ($draft['owner'] ?? null) === $owner, 404);
        if (empty($draft['published'])) {
            Storage::disk('local')->delete($draft['path']);
        }
        Cache::forget('about-video-upload:'.$token);
    }

    public static function validateSetting(string $attribute, mixed $value, \Closure $fail): void
    {
        if (! is_string($value) || ! str_starts_with($value, 'data:')) return;
        if (! self::isEmbedded($value)) {
            $fail('Choose an MP4, WebM, OGG, MOV, or AVI video.');
            return;
        }
        $offset = strpos($value, ',') + 1;
        $bytes = intdiv((strlen($value) - $offset) * 3, 4) - substr_count(substr($value, -2), '=');
        if ($bytes > self::MAX_BYTES) {
            $fail('The video must be 50 MB or smaller.');
        }
    }

    /** Serve the existing public video separately, with browser range support. */
    public static function response(Request $request): BinaryFileResponse
    {
        $value = SiteSetting::get('about_video_url');
        $stored = self::storedFile($value);
        abort_unless($stored || self::isEmbedded($value), 404);
        if ($stored) {
            $extension = pathinfo($stored, PATHINFO_EXTENSION);
            $type = array_search($extension, self::TYPES, true);
            $version = $stored;
        } else {
            preg_match('/\Adata:([^;]+);base64,/i', $value, $matches);
            $type = strtolower($matches[1]);
            $version = hash('sha256', $value);
        }
        $requestedVersion = $request->query('v');
        abort_if($requestedVersion !== null && (! is_string($requestedVersion) || ! hash_equals($version, $requestedVersion)), 404);

        // A private, content-addressed cache avoids decoding the full video for
        // every range request. The endpoint exposes only the public About video.
        $disk = Storage::disk('local');
        $directory = 'site-setting-media';
        $relativePath = $directory.'/'.($stored ?? $version.'.'.self::TYPES[$type]);
        $path = $disk->path($relativePath);
        if (! is_file($path)) {
            abort_if($stored !== null, 404);
            abort_unless($disk->makeDirectory($directory), 503);
            $temporary = tempnam(dirname($path), 'video-');
            abort_if($temporary === false, 503);
            $handle = null;
            try {
                $handle = fopen($temporary, 'wb');
                abort_if($handle === false, 503);
                // Decode in complete base64 blocks without another full-size
                // string and decoded-video allocation in PHP memory.
                for ($offset = strlen($matches[0]), $length = strlen($value); $offset < $length; $offset += 262144) {
                    $binary = base64_decode(substr($value, $offset, 262144), true);
                    abort_if($binary === false, 404);
                    abort_if(fwrite($handle, $binary) !== strlen($binary), 503);
                }
                fclose($handle);
                $handle = null;
                // Publish the completed file atomically for concurrent requests.
                if (! @rename($temporary, $path)) {
                    abort_unless(is_file($path), 503);
                }
            } finally {
                if (is_resource($handle)) {
                    fclose($handle);
                }
                if (is_file($temporary)) {
                    unlink($temporary);
                }
            }
        }

        $response = response()->file($path, [
            'Content-Type' => $type,
            'Content-Disposition' => 'inline; filename="fmrc-about-video.'.self::TYPES[$type].'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'public, max-age=86400',
            'ETag' => '"'.$version.'"',
        ]);
        $response->isNotModified($request);

        return $response;
    }
}
