<?php

namespace App\Support;

use App\Models\SiteSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class SiteSettingsVideo
{
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
        return url('/api/site-settings/about-video').'?v='.hash('sha256', $value);
    }

    /** Serve the existing public video separately, with browser range support. */
    public static function response(Request $request): BinaryFileResponse
    {
        $value = SiteSetting::get('about_video_url');
        abort_unless(self::isEmbedded($value), 404);
        preg_match('/\Adata:([^;]+);base64,/i', $value, $matches);
        $type = strtolower($matches[1]);
        $version = hash('sha256', $value);
        $requestedVersion = $request->query('v');
        abort_if($requestedVersion !== null && (! is_string($requestedVersion) || ! hash_equals($version, $requestedVersion)), 404);

        // A private, content-addressed cache avoids decoding the full video for
        // every range request. The endpoint exposes only the public About video.
        $disk = Storage::disk('local');
        $directory = 'site-setting-media';
        $relativePath = $directory.'/'.$version.'.'.self::TYPES[$type];
        $path = $disk->path($relativePath);
        if (! is_file($path)) {
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
