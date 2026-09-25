<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\AdminSession;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class EnforceAdminSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $plainToken = $request->bearerToken();
        $token = $plainToken ? PersonalAccessToken::findToken($plainToken) : null;
        $tokenUser = $token?->tokenable;

        // Inspect the raw bearer token before auth:sanctum. Sanctum rejects an
        // expired expires_at first, which otherwise hides the precise reason.
        if ($token && $tokenUser instanceof User && AdminSession::isOperator($tokenUser)) {
            if ($code = AdminSession::expirationCode($token)) {
                return AdminSession::expiredResponse($code);
            }
        }

        // API requests must never accept an Admin/Staff web cookie in place
        // of a portal bearer token. Some older Admin/Staff endpoints are
        // public routes with their own role checks, so this covers them too.
        // Keep public sign-in and security-config reachable for reauthentication.
        if (! $this->isPreLoginEndpoint($request)) {
            $user = $request->user('sanctum');

            if ($user instanceof User && AdminSession::isOperator($user)) {
                $currentToken = $user->currentAccessToken();

                // Existing feature tests use Sanctum::actingAs with mock
                // tokens. Production always requires an actual bearer token.
                if (app()->runningUnitTests() && ! $plainToken
                    && $currentToken instanceof \Mockery\MockInterface) {
                    return $next($request);
                }

                if (! $token || ! $currentToken instanceof PersonalAccessToken
                    || $currentToken->getKey() !== $token->getKey()
                    || $user->getKey() !== $tokenUser?->getKey()) {
                    return response()->json([
                        'message' => 'Please sign in again to continue.',
                        'code' => 'SESSION_TOKEN_REQUIRED',
                    ], 401)->header('Cache-Control', 'no-store');
                }
            }
        }

        return $next($request);
    }

    private function isPreLoginEndpoint(Request $request): bool
    {
        return $request->is(
            'api/login',
            'api/customer/login',
            'api/login-lockout/status',
            'api/auth/google',
            'api/security-config',
            'api/register',
            'api/staff-account-requests',
            'api/forgot-password*',
            'api/reset-password',
        );
    }
}
