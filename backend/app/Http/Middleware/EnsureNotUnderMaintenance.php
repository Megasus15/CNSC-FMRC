<?php

namespace App\Http\Middleware;

use App\Models\MaintenanceSetting;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;

/**
 * Maintenance Mode (STEP 11, Part B) -- the authoritative gate.
 *
 * Attached by class-string in routes/api.php exactly the way VerifyTurnstile is,
 * so bootstrap/app.php needs no alias:
 *
 *     ->middleware(EnsureNotUnderMaintenance::class . ':page_contact')
 *
 * Hiding a section in the browser is a courtesy. This is the part that actually
 * closes the page: a phone holding a cached copy still cannot post into a scope
 * the admin has switched off.
 */
class EnsureNotUnderMaintenance
{
    public function handle(Request $request, Closure $next, string $scope): Response
    {
        // Defensive: on a deployment where the frontend files have landed but
        // `php artisan migrate` has not been run yet, the table does not exist.
        // Failing open is right here -- the site keeps working exactly as it did
        // before the feature existed instead of 503-ing every submit.
        if (! Schema::hasTable('maintenance_settings')) {
            return $next($request);
        }

        if (! MaintenanceSetting::isActive($scope)) {
            return $next($request);
        }

        return response()->json([
            'message' => MaintenanceSetting::messageFor($scope),
            'maintenance' => true,
            'scope' => $scope,
        ], 503);
    }
}
