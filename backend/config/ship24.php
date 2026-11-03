<?php

return [
    // Emergency stop. Account/carrier verification and Admin activation are also required.
    'enabled' => (bool) env('SHIP24_ENABLED', false),
    'api_key' => env('SHIP24_API_KEY', ''),
    'webhook_secret' => env('SHIP24_WEBHOOK_SECRET', ''),
    'monthly_registration_limit' => (int) env('SHIP24_MONTHLY_REGISTRATION_LIMIT', 10),
    'allow_demo_handover' => (bool) env('SHIP24_ALLOW_DEMO_HANDOVER', false),
];
