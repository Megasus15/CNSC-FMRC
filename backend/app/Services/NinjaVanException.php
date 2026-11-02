<?php

namespace App\Services;

final class NinjaVanException extends \RuntimeException
{
    public function __construct(public readonly int $httpStatus, public readonly string $providerCode, public readonly bool $ambiguous)
    {
        parent::__construct('The courier request could not be confirmed. Review its latest status before retrying.');
    }
}
