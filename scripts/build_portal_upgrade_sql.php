<?php

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// Compile the actual migrations without connecting to or changing a database.
require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$connection = new class(
    fn () => throw new RuntimeException('SQL generation must not connect to a database.'),
    'u799987132_ucn_fmrc_db',
    '',
    ['driver' => 'mysql', 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'engine' => 'InnoDB', 'version' => '8.0.0']
) extends Illuminate\Database\MySqlConnection {
    public function isMaria() { return true; }
    public function getServerVersion(): string { return '11.8.9'; }
    public function logQuery($query, $bindings, $time = null)
    {
        $this->queryLog[] = compact('query', 'bindings', 'time');
    }
};
$connection->useDefaultSchemaGrammar();
$app['db']->extend('portal_sql_export', fn () => $connection);
config(['database.connections.portal_sql_export' => ['driver' => 'portal_sql_export'], 'database.default' => 'portal_sql_export']);
Illuminate\Support\Facades\Schema::clearResolvedInstance('db.schema');
$sql = "-- FMRC upgrade: generated from the four canonical Laravel migrations.\n";
$sql .= "-- For the verified missing-schema state only. Back up the database first.\n";
$sql .= "-- Import ONCE. If any statement fails, STOP and report the error; do not rerun blindly.\n";
$sql .= "-- DDL commits implicitly. This is not a transaction or a courier activation.\n";
$sql .= "USE `u799987132_ucn_fmrc_db`;\nSET time_zone = '+00:00';\n";
$sql .= "SET @portal_upgrade_batch = (SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations);\n\n";
foreach (glob(__DIR__.'/../backend/database/migrations/2026_11_02_00000*.php') as $file) {
    $name = basename($file, '.php');
    $sql .= '-- '.$name."\n";
    $queries = $connection->pretend(fn () => (require $file)->up());
    foreach ($queries as $entry) {
        $query = $entry['query'];
        foreach ($entry['bindings'] as $binding) {
            if ($binding instanceof DateTimeInterface) {
                $literal = 'CURRENT_TIMESTAMP';
            } elseif (is_int($binding)) {
                $literal = (string) $binding;
            } else {
                throw new RuntimeException('Unexpected binding: review the SQL generator.');
            }
            $query = preg_replace('/\?/', $literal, $query, 1);
        }
        $sql .= $query.";\n";
    }
    $sql .= "INSERT INTO migrations (migration, batch) SELECT '$name', @portal_upgrade_batch WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE migration = '$name');\n\n";
}
$sql .= "SELECT migration, batch FROM migrations WHERE migration LIKE '2026_11_02_00000%' ORDER BY migration;\n";
$sql .= "SELECT id, revision, published_version FROM shipping_settings;\n";
$sql .= "SELECT id, revision, published_version FROM commerce_policy_settings;\n";
$sql .= "SELECT id FROM appointment_schedule_locks;\n";
$target = __DIR__.'/../docs/HOSTINGER_PORTAL_UPGRADE.sql';
file_put_contents($target, $sql);
echo 'Generated '.$target.PHP_EOL;
