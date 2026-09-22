<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnforceSpectatorMode
{
    public function handle(Request $request, Closure $next): Response
    {
        // Resolve bearer tokens even on legacy public API routes. Restricting
        // only the auth:sanctum group would leave appointment writes reachable.
        $user = $request->user('sanctum');

        if (! $user instanceof User || ! $user->isSpectator()) {
            return $next($request);
        }

        $request->attributes->set('spectator_mode', true);

        // Ending this session is always permitted, including after expiry.
        if ($request->isMethod('POST') && $request->is('api/logout', 'logout')) {
            return $next($request);
        }

        if ($user->spectatorHasExpired()) {
            return response()->json([
                'message' => 'This temporary presentation account has expired.',
                'code' => 'SPECTATOR_EXPIRED',
            ], 403);
        }

        // Customer payment-status polling can settle payments. The spectator
        // uses admin data feeds exclusively, and cannot enter customer flows.
        $readablePath = $request->is('api/*', '/', 'dashboard', 'profile', 'appointments/verify/*')
            && ! $request->is('api/customer/*');

        if ($readablePath) {
            if (in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
                return $next($request);
            }

            // This handler renders HTML only; it neither sends nor saves mail.
            if ($request->isMethod('POST') && $request->is('api/admin/email-templates/preview')) {
                return $next($request);
            }
        }

        return response()->json([
            'message' => 'Spectator mode is view only. Changes are disabled for this presentation account.',
            'code' => 'SPECTATOR_READ_ONLY',
        ], 403);
    }
}
