<?php
return [
    'gateway' => env('PAYMENT_GATEWAY', 'paymongo'),
    // These fields apply only to historical manual transactions.
    'gcash' => ['reference_digits' => 13, 'payment_window_hours' => 48, 'proof_max_kb' => 2048],
    'paymongo' => [
        'enabled' => (bool) env('PAYMONGO_ENABLED', false),
        // QR Ph can be paid using GCash. Direct GCash needs separate activation.
        'checkout_method' => env('PAYMONGO_CHECKOUT_METHOD', 'qrph'),
        'secret_key' => env('PAYMONGO_SECRET_KEY'),
        'webhook_secret' => env('PAYMONGO_WEBHOOK_SECRET'),
    ],
];
