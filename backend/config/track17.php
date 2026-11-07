<?php

return [
    'enabled' => (bool) env('TRACK17_ENABLED', false),
    'api_key' => env('TRACK17_API_KEY', ''),
    // Lifetime local budget, including diagnostics and uncertain registrations. Never resets monthly.
    'registration_limit' => (int) env('TRACK17_REGISTRATION_LIMIT', 200),
    'carrier_code' => 100240,
    'allow_demo_handover' => (bool) env('TRACK17_ALLOW_DEMO_HANDOVER', false),
];
