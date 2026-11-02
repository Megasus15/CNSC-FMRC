<?php

return [
    'enabled' => (bool) env('NINJAVAN_ENABLED', false),
    'environment' => env('NINJAVAN_ENVIRONMENT', 'sandbox'),
    'production_approved' => (bool) env('NINJAVAN_PRODUCTION_APPROVED', false),
    'client_id' => env('NINJAVAN_CLIENT_ID', ''),
    'client_secret' => env('NINJAVAN_CLIENT_SECRET', ''),
    'from' => [
        'name' => env('NINJAVAN_FROM_NAME', 'FMRC'), 'phone_number' => env('NINJAVAN_FROM_PHONE', ''),
        'email' => env('NINJAVAN_FROM_EMAIL', ''),
        'address' => ['address1' => env('NINJAVAN_FROM_STREET', ''), 'area' => env('NINJAVAN_FROM_BARANGAY', ''),
            'city' => env('NINJAVAN_FROM_CITY', ''), 'state' => env('NINJAVAN_FROM_PROVINCE', ''),
            'postcode' => env('NINJAVAN_FROM_POSTAL_CODE', ''), 'country' => 'PH', 'address_type' => 'office'],
    ],
    // These must match the account's approved time slots; no pickup is
    // requested unless the operator chooses it and the slots are configured.
    'pickup_start' => env('NINJAVAN_PICKUP_START', ''),
    'pickup_end' => env('NINJAVAN_PICKUP_END', ''),
    'delivery_start' => env('NINJAVAN_DELIVERY_START', ''),
    'delivery_end' => env('NINJAVAN_DELIVERY_END',''),
];
