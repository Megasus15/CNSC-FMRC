<?php

namespace App\Http\Middleware;

use App\Services\TurnstileVerifier;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class VerifyTurnstile
{
    /**
     * Guard a route with the Cloudflare Turnstile challenge.
     *
     * Two modes are supported:
     *
     *  - "enforce" (default): the request is rejected with a 422 unless a valid
     *    token is present. Used for the public customer-facing forms.
     *  - "advisory": the token is still verified and the outcome is logged, but a
     *    missing or failing check never rejects the request. Used for the
     *    admin/staff portal, where a widget that cannot issue a token (an
     *    unreachable Cloudflare edge, a site key whose allow-list is missing the
     *    current host, an expired challenge) must not lock staff out of their own
     *    workspace.
     */
    public function handle(Request $request, Closure $next, string $mode = 'enforce'): Response
    {
        $verifier = app(TurnstileVerifier::class);

        // Keep local development and existing deployments functional until the
        // production keys are added to .env and the feature is enabled.
        if (!$verifier->isEnabled()) {
            return $next($request);
        }

        $advisory = $mode === 'advisory';
        $token = $request->input('cf-turnstile-response');
        $token = is_string($token) ? trim($token) : '';

        // On an advisory route there is nothing to gain from calling out to
        // Cloudflare when no token was submitted: the request continues either
        // way, and skipping the call keeps sign-in latency unchanged.
        if ($advisory && $token === '') {
            $this->logAdvisoryMiss($request, false);

            return $next($request);
        }

        if ($verifier->verify($token !== '' ? $token : null, $request->ip())) {
            return $next($request);
        }

        if ($advisory) {
            $this->logAdvisoryMiss($request, true);

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

    private function logAdvisoryMiss(Request $request, bool $tokenPresent): void
    {
        Log::info('Cloudflare Turnstile did not pass on an advisory route; the request was allowed through.', [
            'path' => $request->path(),
            'ip' => $request->ip(),
            'token_present' => $tokenPresent,
        ]);
    }
}
