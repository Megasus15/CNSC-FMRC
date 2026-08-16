<?php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    // Customer order polling reads ETag so unchanged database snapshots can
    // return a zero-byte 304 response even when the static site uses Live Server.
    'exposed_headers' => ['ETag'],

    'max_age' => 0,

    'supports_credentials' => false,
];
