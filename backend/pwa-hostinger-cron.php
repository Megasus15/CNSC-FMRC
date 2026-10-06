<?php

// Hostinger's PHP cron option can run this file without SSH or command arguments.
// This is never an HTTP installer; no command or environment values are accepted.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

if (PHP_VERSION_ID < 80300) {
    fwrite(STDERR, "FMRC requires PHP 8.3 or later. Select a supported cron PHP version.\n");
    exit(1);
}

chdir(__DIR__);
if (! is_file(__DIR__.'/vendor/autoload.php')) {
    fwrite(STDERR, "Extract the FMRC dependency ZIP into the backend folder first.\n");
    exit(1);
}

try {
    require __DIR__.'/vendor/autoload.php';
    $app = require __DIR__.'/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();

    // Generate on the server once. Existing credentials and .env are preserved.
    $privateDirectory = $app->storagePath('app/private');
    if (! is_dir($privateDirectory) && ! mkdir($privateDirectory, 0700, true) && ! is_dir($privateDirectory)) {
        throw new RuntimeException('Protected storage is not writable.');
    }
    $lock = fopen($privateDirectory.'/pwa-key-generation.lock', 'c');
    if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
        if ($lock) {
            fclose($lock);
        }
        exit(0);
    }
    try {
        if (! is_file($privateDirectory.'/pwa-vapid.json')) {
            $result = $kernel->call('pwa:keys');
            echo $kernel->output();
            if ($result !== 0) {
                exit($result);
            }
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }

    // Does not enable push, migrate tables, or replay customer transactions.
    $result = $kernel->call('pwa:process');
    echo $kernel->output();
    if ($result === 0) {
        echo "FMRC notification cron completed.\n";
    }
    exit($result);
} catch (Throwable $error) {
    // Detailed errors belong in protected storage, not cron output or HTTP.
    if (isset($app) && $app->bound('log')) {
        try {
            $app->make('log')->error('FMRC notification cron failed.', ['exception' => $error]);
        } catch (Throwable) {
            // The storage problem may also prevent logging. Keep output generic.
        }
    }
    fwrite(STDERR, "FMRC notification cron could not finish. Check backend/storage/logs/laravel.log and the PHP version/extensions.\n");
    exit(1);
}
