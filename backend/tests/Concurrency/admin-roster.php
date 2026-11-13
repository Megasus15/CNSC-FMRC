<?php

// Opt-in destructive fixture test. Use a disposable MySQL instance/database;
// the prefix/flag guards prevent accidental use against an application database.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function (Throwable $error): void { fwrite(STDERR, $error->getMessage()."\n"); exit(1); });

use App\Models\User;
use App\Support\AdminAccounts;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Symfony\Component\HttpKernel\Exception\HttpException;

if (getenv('FMRC_ISOLATED_MYSQL') !== '1' || DB::connection()->getDriverName() !== 'mysql'
    || !str_starts_with(DB::connection()->getDatabaseName(), 'fmrc_test_admin_')) {
    throw new RuntimeException('Requires FMRC_ISOLATED_MYSQL=1 and a disposable MySQL database named fmrc_test_admin_*.');
}

if (($argv[1] ?? '') === 'worker') {
    $actor = User::findOrFail((int) $argv[2]);
    $directory = $argv[4];
    file_put_contents($directory.'/'.$actor->id.'.ready', 'ready');
    $deadline = microtime(true) + 10;
    while (!is_file($directory.'/go') && microtime(true) < $deadline) usleep(10000);
    if (!is_file($directory.'/go')) throw new RuntimeException('Barrier timeout');
    try {
        AdminAccounts::delete($actor, [(int) $argv[3]]);
        echo json_encode(['status'=>200]);
    } catch (HttpException $error) {
        echo json_encode(['status'=>$error->getStatusCode()]);
    }
    exit;
}

if (User::count() !== 0) throw new RuntimeException('Run only after migrating an empty disposable test database.');
for ($round = 0; $round < 10; $round++) {
    $a = User::factory()->create(['role'=>'admin']);
    $b = User::factory()->create(['role'=>'admin']);
    $a->createToken('fixture-a'); $b->createToken('fixture-b');
    $directory = sys_get_temp_dir().'/fmrc-admin-race-'.bin2hex(random_bytes(6));
    mkdir($directory);
    $workers = [new Process([PHP_BINARY,__FILE__,'worker',(string) $a->id,(string) $b->id,$directory]),
        new Process([PHP_BINARY,__FILE__,'worker',(string) $b->id,(string) $a->id,$directory])];
    foreach ($workers as $worker) { $worker->setTimeout(20); $worker->start(); }
    $deadline = microtime(true) + 10;
    while (count(glob($directory.'/*.ready')) < 2 && microtime(true) < $deadline) usleep(10000);
    if (count(glob($directory.'/*.ready')) !== 2) throw new RuntimeException('Workers did not reach the barrier.');
    file_put_contents($directory.'/go', 'go');
    $statuses = [];
    foreach ($workers as $worker) {
        $worker->wait();
        if (!$worker->isSuccessful()) throw new RuntimeException($worker->getErrorOutput());
        $statuses[] = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR)['status'];
    }
    sort($statuses);
    if ($statuses !== [200,403] || User::where('role','admin')->count() !== 1) throw new RuntimeException('Competing decisions removed the final Admin.');
    $survivor = User::firstOrFail();
    if ($survivor->tokens()->count() !== 1) throw new RuntimeException('The surviving Admin lost its token.');
    $survivor->tokens()->delete(); $survivor->delete();
    foreach (glob($directory.'/*') as $file) unlink($file);
    rmdir($directory);
}
echo "Passed 10 simultaneous mutual-deletion races on MySQL; one Admin and its token survived each round.\n";
