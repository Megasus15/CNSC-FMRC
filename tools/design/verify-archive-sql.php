<?php
// Local-only verification of the Hostinger SQL patch in a disposable database.
require __DIR__.'/../../backend/vendor/autoload.php';
$app=require __DIR__.'/../../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$source=Illuminate\Support\Facades\DB::connection();
if (!app()->environment('local') || $source->getDriverName() !== 'mysql'
    || !in_array($source->getConfig('host'), ['127.0.0.1','localhost','::1'], true)) {
    throw new RuntimeException('This check requires a local MySQL connection.');
}
$database='fmrc_archive_sql_'.bin2hex(random_bytes(6));
if (!preg_match('/^fmrc_archive_sql_[a-f0-9]{12}$/D',$database) || $database === $source->getDatabaseName()) {
    throw new RuntimeException('Invalid scratch database.');
}
$created=false;
$failure=null;
$originalConnection=Illuminate\Support\Facades\DB::getDefaultConnection();
$admin=$source->getPdo();
try {
    $admin->exec('CREATE DATABASE `'.$database.'`'); $created=true;
    config(['database.connections.archive_sql_check'=>array_merge($source->getConfig(),['url'=>null,'database'=>$database])]);
    $pdo=Illuminate\Support\Facades\DB::connection('archive_sql_check')->getPdo();
    Illuminate\Support\Facades\DB::setDefaultConnection('archive_sql_check');
    config(['cache.default'=>'array']);
    $script=file_get_contents(__DIR__.'/../../docs/sql/ENABLE_ONLINE_REFUND_ARCHIVES.sql');
    $script=str_replace("\r\n","\n",$script);
    $script=preg_replace('/^\s*--[^\r\n]*$/m','',$script);
    $statements=array_filter(array_map('trim',explode(';',$script)));
    foreach (['runtime','sql'] as $mode) foreach (['none','date_only','actor_only','both'] as $case) {
        $pdo->exec('DROP TABLE IF EXISTS payments'); $pdo->exec('DROP TABLE IF EXISTS users');
        $pdo->exec('CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB');
        $pdo->exec('CREATE TABLE payments (id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(10,2), status VARCHAR(30)) ENGINE=InnoDB');
        $pdo->exec("INSERT INTO users VALUES (1)");
        $pdo->exec("INSERT INTO payments VALUES (1,1.00,'refunded')");
        if (in_array($case,['date_only','both'],true)) $pdo->exec('ALTER TABLE payments ADD online_refund_archived_at TIMESTAMP NULL DEFAULT NULL');
        if (in_array($case,['actor_only','both'],true)) $pdo->exec('ALTER TABLE payments ADD online_refund_archived_by BIGINT UNSIGNED NULL DEFAULT NULL');
        $before=$pdo->query('SELECT id,amount,status FROM payments')->fetchAll(PDO::FETCH_ASSOC);
        if ($mode === 'runtime' && (!App\Support\OnlineRefundArchive::prepareStorage() || !App\Support\OnlineRefundArchive::prepareStorage())) {
            throw new RuntimeException('Archive setup failed: '.$case);
        }
        for ($run=0; $run<2; $run++) foreach ($statements as $statement) {
            $result=$pdo->query($statement);
            if ($result->columnCount()) $result->fetchAll();
            $result->closeCursor();
        }
        $columns=$pdo->query("SELECT COLUMN_NAME,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME IN ('online_refund_archived_at','online_refund_archived_by')")->fetchAll(PDO::FETCH_KEY_PAIR);
        if (count($columns)!==2 || array_unique(array_values($columns))!==['YES']) throw new RuntimeException('Missing nullable archive columns: '.$case);
        if ($before!==$pdo->query('SELECT id,amount,status FROM payments')->fetchAll(PDO::FETCH_ASSOC)) throw new RuntimeException('Financial fields changed: '.$case);
        $pdo->exec('UPDATE payments SET online_refund_archived_by=1');
        $pdo->exec('DELETE FROM users WHERE id=1');
        if ($pdo->query('SELECT online_refund_archived_by FROM payments')->fetchColumn()!==null) throw new RuntimeException('Archive actor reference did not clear: '.$case);
        echo 'PASS: '.$mode.' / '.$case.' schema, repeated setup/imports, preserved amounts/status, actor reference.' . PHP_EOL;
    }
} catch (Throwable $error) {
    $failure=$error;
} finally {
    Illuminate\Support\Facades\DB::setDefaultConnection($originalConnection);
    Illuminate\Support\Facades\DB::disconnect('archive_sql_check');
    if ($created) $admin->exec('DROP DATABASE `'.$database.'`');
}
if ($failure) {
    fwrite(STDERR,'FAIL: '.$failure->getMessage().PHP_EOL);
    exit(1);
}
