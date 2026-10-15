<?php
// Private CLI-only cron entry point. Configure PHP 8.3+ to run this every minute.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
chdir(__DIR__);
require __DIR__.'/vendor/autoload.php';
$app = require __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
try {
    $status = $kernel->call('payments:reconcile');
    echo $kernel->output();
    exit($status);
} catch (Throwable $e) {
    if ($app->bound('log')) $app->make('log')->error('Payment reconciliation command failed.', ['exception' => $e]);
    fwrite(STDERR, "Payment reconciliation failed. Check the protected application log.\n");
    exit(1);
}
