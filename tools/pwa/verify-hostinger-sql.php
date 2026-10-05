<?php

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// Local-only verification: compare the phpMyAdmin installer against the migration.
// Both schemas live in fresh scratch databases; no FMRC account/order tables change.
$root = dirname(__DIR__, 2);
require $root.'/backend/vendor/autoload.php';
$app = require $root.'/backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$source = config('database.connections.mysql');
if (! app()->environment('local') || ! in_array($source['host'], ['127.0.0.1', 'localhost']) || ! empty($source['url'])) {
    throw new RuntimeException('Run this verification only against the local development MySQL server.');
}
$server = Illuminate\Support\Facades\DB::connection('mysql')->getPdo();
$created = [];
$tables = ['pwa_subscriptions', 'customer_notifications', 'customer_notification_reads', 'pwa_delivery_outbox', 'pwa_runtime'];
$nonce = bin2hex(random_bytes(5));
$manual = 'fmrc_pwa_verify_manual_'.$nonce;
$migration = 'fmrc_pwa_verify_migration_'.$nonce;
try {
    foreach ([$manual, $migration] as $name) {
        $server->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $created[] = $name;
        $server->exec("CREATE TABLE `$name`.`users` (id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(255)) ENGINE=InnoDB");
        $server->exec("INSERT INTO `$name`.`users` VALUES (1, 'Retained account')");
        $server->exec("CREATE TABLE `$name`.`migrations` (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, migration VARCHAR(255), batch INT) ENGINE=InnoDB");
        $server->exec("INSERT INTO `$name`.`migrations` (migration, batch) VALUES ('existing_migration', 1)");
    }
    $sql = file_get_contents($root.'/backend/database/manual/2026_10_05_install_pwa_notifications.sql');
    $sql = str_replace('u799987132_ucn_fmrc_db', $manual, $sql);
    $sql = preg_replace('/^--.*$/m', '', $sql);
    $statements = array_filter(array_map('trim', explode(';', $sql)));
    for ($run = 0; $run < 2; $run++) {
        foreach ($statements as $statement) {
            $cursor = $server->query($statement);
            $cursor->closeCursor();
        }
    }
    config(['database.connections.pwa_verify' => array_replace($source, ['database' => $migration, 'url' => null,
        'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])]);
    Illuminate\Support\Facades\DB::setDefaultConnection('pwa_verify');
    $installer = require $root.'/backend/database/migrations/2026_10_05_000001_create_pwa_notifications.php';
    $installer->up();

    $metadata = function (string $database, string $table) use ($server): array {
        $details = [];
        foreach ([
            'columns' => "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
            'indexes' => "SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            'foreign_keys' => "SELECT r.CONSTRAINT_NAME, r.DELETE_RULE, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS r JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME=r.CONSTRAINT_NAME AND k.TABLE_NAME=r.TABLE_NAME WHERE r.CONSTRAINT_SCHEMA=? AND r.TABLE_NAME=? ORDER BY r.CONSTRAINT_NAME",
        ] as $type => $query) {
            $statement = $server->prepare($query);
            $statement->execute([$database, $table]);
            $details[$type] = $statement->fetchAll(PDO::FETCH_ASSOC);
        }

        return $details;
    };
    foreach ($tables as $table) {
        if ($metadata($manual, $table) !== $metadata($migration, $table)) {
            throw new RuntimeException('Installer differs from migration: '.$table);
        }
    }
    $count = $server->query("SELECT COUNT(*) FROM `$manual`.`migrations` WHERE migration='2026_10_05_000001_create_pwa_notifications'")->fetchColumn();
    $account = $server->query("SELECT name FROM `$manual`.`users` WHERE id=1")->fetchColumn();
    if ((int) $count !== 1 || $account !== 'Retained account') {
        throw new RuntimeException('Repeated installation changed an account or duplicated the migration record.');
    }
    $server->exec("INSERT INTO `$manual`.`customer_notifications` (user_id,type,title,message,target,event_key,published_at) VALUES (1,'order','Private','Details','/home-page/main.html','private-check',NOW()),(NULL,'announcement','Public','Details','/home-page/main.html','public-check',NOW())");
    $server->exec("DELETE FROM `$manual`.`users` WHERE id=1");
    $remaining = $server->query("SELECT event_key FROM `$manual`.`customer_notifications`")->fetchAll(PDO::FETCH_COLUMN);
    if ($remaining !== ['public-check']) {
        throw new RuntimeException('Account deletion must delete private notifications and retain public records.');
    }
    echo "PASS: five schemas match; repeated import is safe; account deletion does not expose private records.\n";
} finally {
    foreach ($created as $name) {
        if (! preg_match('/^fmrc_pwa_verify_(manual|migration)_[a-f0-9]{10}$/', $name)) {
            throw new RuntimeException('Unexpected scratch database name.');
        }
        $server->exec("DROP DATABASE `$name`");
    }
}
