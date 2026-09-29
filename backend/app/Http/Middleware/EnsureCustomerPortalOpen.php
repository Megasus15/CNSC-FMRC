<?php

namespace App\Http\Middleware;

use App\Models\MaintenanceSetting;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Keep authenticated customer actions unavailable during site-wide maintenance. */
class EnsureCustomerPortalOpen
{
    public function handle(Request $request, Closure $next): Response
    {
        $role = strtolower((string) ($request->user()?->role ?? ''));

        // Admin and Staff must retain the ability to work and restore the site.
        // A customer may still revoke their session from an already open tab.
        if ($role !== 'customer' || $request->is('api/logout') || ! MaintenanceSetting::isActive('site_portal')) {
            return $next($request);
        }

        return response()->json([
            'message' => MaintenanceSetting::messageFor('site_portal'),
            'maintenance' => true,
            'scope' => 'site_portal',
        ], 503);
    }
}
