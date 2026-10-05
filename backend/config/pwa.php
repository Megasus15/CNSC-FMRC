<?php

return [
    'push_enabled' => env('PWA_PUSH_ENABLED', false),
    'vapid' => [
        'subject' => env('PWA_VAPID_SUBJECT', 'https://ucn-fabmanlab.com'),
        'public_key' => env('PWA_VAPID_PUBLIC_KEY', ''),
        'private_key' => env('PWA_VAPID_PRIVATE_KEY', ''),
    ],
    // Exact vendor hosts or suffixes owned by a push provider. No user-supplied hosts.
    'push_hosts' => ['fcm.googleapis.com', 'updates.push.services.mozilla.com', '.push.services.mozilla.com', '.notify.windows.com', 'web.push.apple.com', '.push.apple.com'],
];
