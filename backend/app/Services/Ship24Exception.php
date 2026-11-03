<?php

namespace App\Services;

final class Ship24Exception extends \RuntimeException
{
    public function __construct(public readonly string $reason, public readonly int $retryAfter = 60)
    {
        // Never expose provider response bodies, credentials or customer details.
        parent::__construct('Tracking updates are temporarily unavailable. Your saved waybill is still available.');
    }
}
