<?php

namespace App\Http\Middleware;

use App\Services\TurnstileVerifier;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyTurnstile
{
    public function handle(Request $request, Closure $next): Response
    {
        $verifier = app(TurnstileVerifier::class);

        // Keep local development and existing deployments functional until the
        // production keys are added to .env and the feature is enabled.
        if (!$verifier->isEnabled()) {
            return $next($request);
        }

        $token = $request->input('cf-turnstile-response');
        if ($verifier->verify(is_string($token) ? $token : null, $request->ip())) {
            return $next($request);
        }

        return response()->json([
            'message' => 'Please complete the security check and try again.',
            'errors' => [
                'cf-turnstile-response' => [
                    'The security check is missing or could not be verified.',
                ],
            ],
        ], 422);
    }
}
