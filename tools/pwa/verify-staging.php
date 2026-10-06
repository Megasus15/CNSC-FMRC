<?php

// Verify the actual upload ZIP on LOCAL MySQL, with a newly created database/user.
// Existing local databases/accounts and all remote Hostinger data are untouched.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__, 2);
require $root.'/backend/vendor/autoload.php';
$app = require $root.'/backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function (Throwable $error): void {
    fwrite(STDERR, 'FAIL: '.$error->getMessage()."\n");
    exit(1);
});
$source = config('database.connections.mysql');
if (! $app->environment('local') || ! in_array($source['host'], ['localhost', '127.0.0.1'], true) || ! empty($source['url'])) {
    throw new RuntimeException('Verification requires the local development MySQL server.');
}
$server = Illuminate\Support\Facades\DB::connection('mysql')->getPdo();
$database = 'u799987132_fmrc_staging';
$username = 'u799987132_fmrc_stage';
$query = $server->prepare('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?');
$query->execute([$database]);
if ($query->fetchColumn() || $server->query("SELECT COUNT(*) FROM mysql.user WHERE User=".$server->quote($username))->fetchColumn()) {
    throw new RuntimeException('A local database or user with the staging name already exists; verification refused to change it.');
}
$nonce = bin2hex(random_bytes(5));
$fixture = $root.'/output/pwa-hostinger-build/staging-verify-'.$nonce.'/domains/staging.ucn-fabmanlab.com/public_html';
mkdir($fixture, 0700, true);
$zip = new ZipArchive;
if ($zip->open($root.'/output/fmrc-hostinger-staging.zip') !== true || ! $zip->extractTo($fixture)) {
    throw new RuntimeException('Could not extract the staging ZIP.');
}
$zip->close();
$backend = $fixture.'/backend';
$databasePassword = bin2hex(random_bytes(24));
$testPassword = 'Staging7'.bin2hex(random_bytes(12));
$template = str_replace(['REPLACE_WITH_STAGING_DATABASE_PASSWORD', 'REPLACE_WITH_NEW_TEST_LOGIN_PASSWORD'],
    [$databasePassword, $testPassword], file_get_contents($backend.'/.env.staging.example'));
$environment = getenv();
foreach (array_keys($environment) as $key) {
    if (preg_match('/^(APP_|DB_|FRONTEND_|PWA_|FMRC_|CACHE_|SESSION_|MAIL_|PAYMENT_|PAYMONGO_)/', $key)) {
        unset($environment[$key]);
    }
}
$openssl = dirname(PHP_BINARY).'/extras/ssl/openssl.cnf';
if (is_file($openssl)) {
    $environment['OPENSSL_CONF'] = $openssl;
}
$run = static function (array $arguments, bool $success = true) use ($backend, $environment, $testPassword, $databasePassword): string {
    $process = proc_open([PHP_BINARY, ...$arguments], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $backend, $environment);
    if (! is_resource($process)) {
        throw new RuntimeException('Could not start isolated verification.');
    }
    $output = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($process);
    if (($code === 0) !== $success || str_contains($output, $testPassword) || str_contains($output, $databasePassword)) {
        throw new RuntimeException('Unexpected setup result: '.str_replace([$testPassword, $databasePassword], '[REDACTED]', $output));
    }
    return $output;
};
$check = static function (bool $condition, string $message): void {
    if (! $condition) {
        throw new RuntimeException($message);
    }
};
$createdDatabase = false;
$createdUser = false;
try {
    $server->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $createdDatabase = true;
    $server->exec('CREATE USER '.$server->quote($username)."@'localhost' IDENTIFIED BY ".$server->quote($databasePassword));
    $createdUser = true;
    $server->exec("GRANT ALL ON `$database`.* TO ".$server->quote($username)."@'localhost'");

    file_put_contents($backend.'/.env', $template);
    $check(str_contains($run(['pwa-hostinger-staging-setup.php'], false), 'Setup is off'), 'Disabled setup was not refused.');
    $ready = str_replace('FMRC_STAGING_SETUP_ENABLED=false', 'FMRC_STAGING_SETUP_ENABLED=true', $template);
    foreach ([
        ['APP_ENV=staging', 'APP_ENV=production'],
        ['DB_DATABASE='.$database, 'DB_DATABASE=u799987132_ucn_fmrc_db'],
        ['APP_URL=https://staging.ucn-fabmanlab.com', 'APP_URL=https://ucn-fabmanlab.com'],
        ['PWA_PUSH_ENABLED=false', 'PWA_PUSH_ENABLED=true'],
        ['MAIL_MAILER=log', 'MAIL_MAILER=smtp'],
        ['SESSION_DOMAIN=null', 'SESSION_DOMAIN=.ucn-fabmanlab.com'],
        ['PAYMONGO_SECRET_KEY=', 'PAYMONGO_SECRET_KEY=fixture_not_a_key'],
    ] as [$from, $to]) {
        $invalid = str_replace($from, $to, $ready);
        file_put_contents($backend.'/.env', $invalid);
        $run(['pwa-hostinger-staging-setup.php'], false);
        $check(file_get_contents($backend.'/.env') === $invalid, 'Refused setup changed the environment.');
        $check(! is_file($backend.'/storage/app/private/staging-setup.json'), 'Refused setup recorded progress.');
    }
    $server->exec("CREATE TABLE `$database`.`retained_fixture` (id INT PRIMARY KEY)");
    $server->exec("INSERT INTO `$database`.`retained_fixture` VALUES (19)");
    file_put_contents($backend.'/.env', $ready);
    $check(str_contains($run(['pwa-hostinger-staging-setup.php'], false), 'new, empty staging database'), 'Nonempty database was not refused.');
    $check((int) $server->query("SELECT id FROM `$database`.`retained_fixture`")->fetchColumn() === 19, 'Existing data changed.');
    $server->exec("DROP TABLE `$database`.`retained_fixture`");

    $first = $run(['pwa-hostinger-staging-setup.php', 'migrate:fresh']);
    $check(str_contains($first, 'Staging setup completed.'), 'Fresh setup did not finish.');
    $check((int) $server->query("SELECT COUNT(*) FROM `$database`.`users`")->fetchColumn() === 3, 'Expected three unique test accounts.');
    $accounts = $server->query("SELECT username, role, password, has_custom_password, email_verified_at FROM `$database`.`users` ORDER BY role")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($accounts as $account) {
        $check($account['username'] === $account['role'].'_test' && password_verify($testPassword, $account['password'])
            && $account['has_custom_password'] && $account['email_verified_at'], 'Test account credentials or role are incorrect.');
    }
    $check((int) $server->query("SELECT COUNT(*) FROM `$database`.`services`")->fetchColumn() > 0, 'Public service defaults were not seeded.');
    $count = (int) $server->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=".$server->quote($database)." AND TABLE_NAME IN ('pwa_subscriptions','customer_notifications','customer_notification_reads','pwa_delivery_outbox','pwa_runtime')")->fetchColumn();
    $check($count === 5, 'PWA schema is incomplete.');
    $keysFile = $backend.'/storage/app/private/pwa-vapid.json';
    $keys = file_get_contents($keysFile);
    $parsedKeys = json_decode($keys, true, flags: JSON_THROW_ON_ERROR);
    $check(! str_contains($first, $parsedKeys['privateKey']), 'Setup output disclosed private VAPID credentials.');
    $envAfter = file_get_contents($backend.'/.env');
    $check(str_contains($envAfter, 'APP_KEY=base64:') && str_contains($envAfter, 'FMRC_STAGING_SETUP_ENABLED=false')
        && ! str_contains($envAfter, $testPassword) && str_contains($envAfter, 'PWA_PUSH_ENABLED=false'), 'Setup did not finalize its private configuration.');
    // Dispatch actual login requests using the packaged runtime, without dev dependencies.
    $loginProbe = <<<'PHP'
    require 'vendor/autoload.php';
    $app = require 'bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
    foreach (['admin', 'staff', 'customer'] as $role) {
        $route = $role === 'customer' ? '/api/customer/login' : '/api/login';
        $request = Illuminate\Http\Request::create('https://staging.ucn-fabmanlab.com'.$route, 'POST',
            ['login' => $role.'_test', 'password' => TEST_PASSWORD], [], [], ['HTTP_ACCEPT' => 'application/json', 'REMOTE_ADDR' => '127.0.0.1']);
        $response = $kernel->handle($request);
        $json = json_decode($response->getContent(), true);
        if ($response->getStatusCode() !== 200 || empty($json['access_token']) || ($json['user']['role'] ?? null) !== $role) {
            fwrite(STDERR, 'Login failed for staging '.$role.'.'); exit(1);
        }
        $kernel->terminate($request, $response);
    }
    echo 'Three staging roles signed in successfully.';
    PHP;
    $loginProbe = str_replace('TEST_PASSWORD', var_export($testPassword, true), $loginProbe);
    $check(str_contains($run(['-r', $loginProbe]), 'Three staging roles signed in'), 'Staging sign-in did not pass.');
    $server->exec("UPDATE `$database`.`users` SET name='Retained test operator' WHERE role='staff'");
    $second = $run(['pwa-hostinger-staging-setup.php']);
    $check(str_contains($second, 'already completed') && file_get_contents($keysFile) === $keys
        && file_get_contents($backend.'/.env') === $envAfter, 'Repeated setup changed keys or environment.');
    $check($server->query("SELECT name FROM `$database`.`users` WHERE role='staff'")->fetchColumn() === 'Retained test operator', 'Repeated setup reset an account.');
    $check(str_contains($run(['pwa-hostinger-cron.php']), 'FMRC notification cron completed.'), 'Staging notification cron did not finish.');
    echo "PASS: upload ZIP initialized all MySQL tables, unique test accounts and private keys; all three roles signed in; unsafe/disabled/nonempty setups refused; repeat preserved data; notification cron completed.\n";
    echo "Fixture: $fixture\n";
} finally {
    if ($createdDatabase && $database === 'u799987132_fmrc_staging') {
        $server->exec("DROP DATABASE `$database`");
    }
    if ($createdUser && $username === 'u799987132_fmrc_stage') {
        $server->exec('DROP USER '.$server->quote($username)."@'localhost'");
    }
}
