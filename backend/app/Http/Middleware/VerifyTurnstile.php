<?php

namespace App\Http\Middleware;

use App\Services\TurnstileVerifier;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyTurnstile
{
    /**
     * Guard a route with the Cloudflare Turnstile challenge.
     *
     * The request is rejected with a 422 unless the submitted token is verified
     * by Cloudflare. This applies to every guarded route, including the
     * admin/staff login: a correct email/username and password are not enough on
     * their own, the challenge has to be completed as well.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $verifier = app(TurnstileVerifier::class);

        // Keep local development and existing deployments functional until the
        // production keys are added to .env and the feature is enabled.
        if (!$verifier->isEnabled()) {
            return $next($request);
        }

        $token = $request->input('cf-turnstile-response');
        $token = is_string($token) ? trim($token) : '';

        if ($token !== '' && $verifier->verify($token, $request->ip())) {
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
