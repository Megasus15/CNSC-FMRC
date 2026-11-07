<?php

namespace App\Services;

final class SeventeenTrackException extends \RuntimeException
{
    public function __construct(public readonly string $reason, public readonly int $retryAfter = 60)
    {
        parent::__construct($reason);
    }
}
