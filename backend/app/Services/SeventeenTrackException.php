<?php

namespace App\Services;

final class SeventeenTrackException extends \RuntimeException
{
    public function __construct(public readonly string $reason, public readonly int $retryAfter = 60,
        public readonly ?int $httpStatus = null, public readonly ?int $providerCode = null, public readonly ?string $endpoint = null)
    {
        parent::__construct($reason);
    }
}
