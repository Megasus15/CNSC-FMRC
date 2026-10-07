<?php

namespace App\Http\Middleware;

use App\Services\PwaOutboxProcessor;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class PwaImmediateDelivery
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->attributes->remove(PwaOutboxProcessor::REQUEST_EVENTS);
        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        $events = $request->attributes->get(PwaOutboxProcessor::REQUEST_EVENTS, []);
        $request->attributes->remove(PwaOutboxProcessor::REQUEST_EVENTS);
        if (! $events) {
            return;
        }
        try {
            // PHP-FPM has already sent the response. Only committed events from
            // this request are attempted; a bounded pass leaves retries to cron.
            app(PwaOutboxProcessor::class)->process(100, 10, array_keys($events));
        } catch (\Throwable $error) {
            report($error);
            // The business save succeeded. Its durable outbox remains for cron.
        }
    }
}
