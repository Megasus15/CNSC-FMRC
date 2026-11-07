<?php

namespace App\Http\Middleware;

use App\Services\AppointmentProducts;
use Closure;

class EnsureAppointmentProductSchema
{
    public function handle($request, Closure $next)
    {
        abort_unless(AppointmentProducts::installed(), 503, 'Custom-product consultations are temporarily unavailable. Please try again shortly.');

        $response = $next($request);
        $response->headers->set('Cache-Control', 'private, no-store');

        return $response;
    }
}
