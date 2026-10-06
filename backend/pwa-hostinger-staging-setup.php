<?php

// One-time initializer for the NEW, empty staging website. Never an HTTP installer.
// Commands and arguments cannot choose a domain, database, account or operation.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function stopStagingSetup(string $message): never
{
    fwrite(STDERR, $message."\n");
    exit(1);
}

if (PHP_VERSION_ID < 80300) {
    stopStagingSetup('FMRC requires PHP 8.3 or later.');
}
if (! str_ends_with(str_replace('\\', '/', realpath(__DIR__)), '/domains/staging.ucn-fabmanlab.com/public_html/backend')) {
    stopStagingSetup('Setup refused: run this only inside the separate staging website folder.');
}
if (! is_file(__DIR__.'/vendor/autoload.php') || ! is_file(__DIR__.'/.env')) {
    stopStagingSetup('Extract the staging ZIP and configure staging backend/.env first.');
}
chdir(__DIR__);

try {
    require __DIR__.'/vendor/autoload.php';
    $app = require __DIR__.'/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();
    $origin = 'https://staging.ucn-fabmanlab.com';
    $databaseName = 'u799987132_fmrc_staging';
    $databaseUser = 'u799987132_fmrc_stage';
    $connection = config('database.connections.mysql');

    if (! $app->environment('staging') || config('app.debug') || rtrim(config('app.url', ''), '/') !== $origin
        || rtrim(config('app.frontend_url', ''), '/') !== $origin || config('session.domain') !== null) {
        stopStagingSetup('Setup refused: use the staging environment, URLs and host-only cookies from the supplied template.');
    }
    if (config('database.default') !== 'mysql' || ! empty($connection['url'])
        || $connection['database'] !== $databaseName || $connection['username'] !== $databaseUser) {
        stopStagingSetup('Setup refused: configure only u799987132_fmrc_staging and u799987132_fmrc_stage.');
    }
    if (config('pwa.push_enabled') || config('mail.default') !== 'log' || config('payments.gateway') !== 'manual'
        || config('payments.paymongo.public_key') || config('payments.paymongo.secret_key') || config('payments.paymongo.webhook_secret')) {
        stopStagingSetup('Setup refused: keep push disabled, mail logged and payment gateway credentials empty during initialization.');
    }
    if ($app->configurationIsCached()) {
        stopStagingSetup('Remove staging backend/bootstrap/cache/config.php before running setup.');
    }

    $privateDirectory = $app->storagePath('app/private');
    if (! is_dir($privateDirectory) && ! mkdir($privateDirectory, 0700, true) && ! is_dir($privateDirectory)) {
        throw new RuntimeException('Protected storage is not writable.');
    }
    $lock = fopen($privateDirectory.'/staging-setup.lock', 'c');
    if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
        exit(0);
    }
    $progressFile = $privateDirectory.'/staging-setup.json';
    $progress = is_file($progressFile) ? json_decode(file_get_contents($progressFile), true, flags: JSON_THROW_ON_ERROR) : null;
    if ($progress && ($progress['database'] !== $databaseName || $progress['origin'] !== $origin)) {
        stopStagingSetup('Setup refused: the protected setup record belongs to another installation.');
    }
    if ($progress && ($progress['complete'] ?? false)) {
        echo "Staging setup already completed. Accounts, passwords and keys were retained. Remove the one-time setup cron.\n";
        exit(0);
    }
    if (! filter_var(env('FMRC_STAGING_SETUP_ENABLED', false), FILTER_VALIDATE_BOOLEAN)) {
        stopStagingSetup('Setup is off. Fill in staging .env passwords, then set FMRC_STAGING_SETUP_ENABLED=true.');
    }
    $password = (string) env('FMRC_STAGING_TEST_PASSWORD', '');
    if (strlen($password) < 12 || str_contains($password, 'REPLACE_WITH_')
        || ! preg_match('/[a-z]/', $password) || ! preg_match('/[A-Z]/', $password) || ! preg_match('/[0-9]/', $password)) {
        stopStagingSetup('Use a new private test-login password of at least 12 characters, with uppercase, lowercase and numbers.');
    }
    $database = Illuminate\Support\Facades\DB::connection('mysql');
    $actual = $database->selectOne('SELECT DATABASE() AS selected_database, CURRENT_USER() AS selected_user');
    if ($actual->selected_database !== $databaseName || explode('@', $actual->selected_user, 2)[0] !== $databaseUser) {
        stopStagingSetup('Setup refused: MySQL did not select the expected staging database and account.');
    }
    if (! $progress && $database->getSchemaBuilder()->getTables()) {
        stopStagingSetup('Setup refused: this initializer requires a new, empty staging database. Existing data was retained.');
    }
    $progress ??= ['origin' => $origin, 'database' => $databaseName, 'started_at' => gmdate('c'), 'complete' => false, 'seeded' => false];
    $saveProgress = static function () use (&$progress, $progressFile): void {
        $temporary = $progressFile.'.tmp';
        if (file_put_contents($temporary, json_encode($progress, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n", LOCK_EX) === false
            || ! rename($temporary, $progressFile)) {
            throw new RuntimeException('Could not save protected setup progress.');
        }
        chmod($progressFile, 0600);
    };
    $saveProgress();
    if (! config('app.key') && $kernel->call('key:generate', ['--force' => true]) !== 0) {
        throw new RuntimeException('Could not generate the staging application key.');
    }
    // Additive migrations only. Never migrate:fresh, import a dump or truncate data.
    if ($kernel->call('migrate', ['--force' => true]) !== 0) {
        throw new RuntimeException('Staging migrations did not finish.');
    }
    if (! $progress['seeded']) {
        (new Database\Seeders\SiteSettingSeeder)->run();
        $progress['seeded'] = true;
        $saveProgress();
    }
    foreach (['admin', 'staff', 'customer'] as $role) {
        $user = App\Models\User::firstOrCreate(['email' => $role.'-test@fmrc.invalid'], [
            'name' => 'FMRC Staging '.ucfirst($role), 'username' => $role.'_test',
            'role' => $role, 'password' => $password, 'has_custom_password' => true,
        ]);
        if ($user->role !== $role || $user->username !== $role.'_test') {
            throw new RuntimeException('An existing test account has unexpected ownership.');
        }
        if (! $user->email_verified_at) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }
    }
    if (! is_file($privateDirectory.'/pwa-vapid.json') && $kernel->call('pwa:keys') !== 0) {
        throw new RuntimeException('Could not create the staging VAPID credentials.');
    }
    $progress['complete'] = true;
    $progress['completed_at'] = gmdate('c');
    $saveProgress();
    $environmentFile = $app->environmentFilePath();
    $environment = file_get_contents($environmentFile);
    $environment = preg_replace('/^FMRC_STAGING_SETUP_ENABLED=.*$/m', 'FMRC_STAGING_SETUP_ENABLED=false', $environment);
    $environment = preg_replace('/^FMRC_STAGING_TEST_PASSWORD=.*$/m', 'FMRC_STAGING_TEST_PASSWORD=', $environment);
    if (file_put_contents($environmentFile, $environment, LOCK_EX) === false) {
        throw new RuntimeException('Could not disable the completed one-time setup.');
    }
    echo "Staging setup completed. FMRC tables and admin_test, staff_test, customer_test are ready.\n";
    echo "Use the private test-login password you entered. No production accounts or data were copied.\n";
    echo "Separate VAPID keys are in protected backend/storage/app/private/pwa-vapid.json. Phone delivery remains disabled.\n";
    echo "Remove the one-time setup cron, then configure the staging notification cron.\n";
} catch (Throwable $error) {
    if (isset($app) && $app->bound('log')) {
        try {
            $app->make('log')->error('FMRC staging setup failed.', ['exception' => $error]);
        } catch (Throwable) {
        }
    }
    stopStagingSetup('Staging setup could not finish. Check staging backend/storage/logs/laravel.log; existing data was retained.');
}
