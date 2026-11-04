<?php

namespace App\Http\Middleware;

use App\Support\CustomProductSchema;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequireCustomProductSchema
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!CustomProductSchema::ready()) {
            return response()->json([
                'code' => 'custom_requests_unavailable',
                'message' => CustomProductSchema::MESSAGE,
            ], 503)->header('Cache-Control', 'no-store');
        }

        return $next($request);
    }
}
