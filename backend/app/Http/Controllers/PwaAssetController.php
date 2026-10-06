<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class PwaAssetController extends Controller
{
    // Allow the ordinary website to detect its own installed WebAPKs on Android.
    // Resolve the origin per deployment so staging never points at production.
    public function assetLinks(Request $request)
    {
        $origin = $request->getSchemeAndHttpHost();

        return response()->json(array_map(fn ($app) => [
            'relation' => ['delegate_permission/common.query_webapk'],
            'target' => ['namespace' => 'web', 'site' => "$origin/apps/$app/manifest.webmanifest"],
        ], ['customer', 'team']), 200, ['Cache-Control' => 'public, max-age=3600', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function original(Request $request, string $folder, string $path)
    {
        $app = in_array($folder, ['admin-page', 'staff-page', 'admin-auth']) ? 'team' : 'customer';

        return $this->show($request, $app, "$folder/$path");
    }

    // Laravel's local server uses the same original files as the Apache aliases.
    public function show(Request $request, string $app, string $path = '')
    {
        abort_unless(in_array($app, ['customer', 'team', 'shared']), 404);
        $path = $path ?: 'index.html';
        abort_if(str_contains($path, '..') || str_contains($path, '\\') || str_contains($path, "\0"), 404);
        $root = dirname(base_path());
        $physical = "$root/apps/$app/$path";
        $pages = $app === 'customer' ? ['home-page', 'about-page', 'services-page', 'products-page', 'contact-page', 'customer-auth'] : ['admin-page', 'staff-page', 'admin-auth'];
        $assets = ['home-page', 'about-page', 'services-page', 'products-page', 'contact-page', 'customer-auth', 'admin-page', 'staff-page', 'admin-auth', 'images'];
        $first = explode('/', $path)[0];
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (in_array($first, $pages) && in_array($extension, ['', 'html'])) {
            $physical = "$root/$path".($extension ? '' : '.html');
        } elseif (in_array($first, $assets) && in_array($extension, ['js', 'css', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'ico', 'woff', 'woff2', 'mp4', 'gif'])) {
            $physical = "$root/$path";
        } else {
            abort_unless(preg_match('~^(index\.html|install(?:\.html)?|offline(?:\.html)?|sw\.js|manifest\.webmanifest|icons/[a-z0-9-]+\.(png|svg))$~', $path) || ($app === 'shared' && preg_match('~^[a-z-]+\.(css|js)$~', $path)), 404);
            if (! $extension) {
                $physical .= '.html';
            }
        }
        $real = realpath($physical);
        abort_unless($real && is_file($real) && str_starts_with(strtolower($real), strtolower($root.DIRECTORY_SEPARATOR)), 404);
        $mime = ['html' => 'text/html', 'js' => 'text/javascript', 'css' => 'text/css', 'webmanifest' => 'application/manifest+json', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'gif' => 'image/gif', 'mp4' => 'video/mp4'];

        return response()->file($real, ['Content-Type' => $mime[strtolower(pathinfo($real, PATHINFO_EXTENSION))] ?? 'application/octet-stream',
            'Cache-Control' => in_array($extension, ['js', 'html', '', 'webmanifest']) ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options' => 'nosniff']);
    }
}
