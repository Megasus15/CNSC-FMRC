<?php
// Diagnostic tool for checking Hostinger backend health
error_reporting(E_ALL);
ini_set('display_errors', 1);

header('Content-Type: text/plain');

echo "=== CNSC-FMRC Hostinger Backend Diagnostic ===\n\n";

echo "1. PHP Version: " . phpversion() . "\n";

$vendorPath = __DIR__ . '/backend/vendor/autoload.php';
echo "2. Vendor Autoload: " . (file_exists($vendorPath) ? "FOUND ✅" : "MISSING ❌ ($vendorPath)") . "\n";

$envPath = __DIR__ . '/backend/.env';
echo "3. .env File: " . (file_exists($envPath) ? "FOUND ✅" : "MISSING ❌ ($envPath)") . "\n";

$bootstrapPath = __DIR__ . '/backend/bootstrap/app.php';
echo "4. Bootstrap app.php: " . (file_exists($bootstrapPath) ? "FOUND ✅" : "MISSING ❌") . "\n";

$storagePath = __DIR__ . '/backend/storage';
echo "5. Storage Writable: " . (is_writable($storagePath) ? "YES ✅" : "NO ❌ (check permissions)") . "\n";

$cachePath = __DIR__ . '/backend/bootstrap/cache';
echo "6. Cache Writable: " . (is_writable($cachePath) ? "YES ✅" : "NO ❌ (check permissions)") . "\n";

if (file_exists($envPath)) {
    $envContent = file_get_contents($envPath);
    preg_match('/DB_DATABASE=(.*)/', $envContent, $dbMatch);
    preg_match('/DB_USERNAME=(.*)/', $envContent, $userMatch);
    preg_match('/DB_PASSWORD=(.*)/', $envContent, $passMatch);
    preg_match('/DB_HOST=(.*)/', $envContent, $hostMatch);
    
    $db = trim($dbMatch[1] ?? '');
    $user = trim($userMatch[1] ?? '');
    $pass = trim($passMatch[1] ?? '');
    $host = trim($hostMatch[1] ?? 'localhost');
    
    echo "\n--- Database Connection Test ---\n";
    echo "Host: $host | DB: $db | User: $user\n";
    
    try {
        $pdo = new PDO("mysql:host=$host;dbname=$db", $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 5
        ]);
        echo "Database Connection: SUCCESSFUL ✅\n";
        
        $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
        echo "Tables Count: " . count($tables) . "\n";
        echo "Tables found: " . implode(', ', array_slice($tables, 0, 10)) . "...\n";
    } catch (Exception $e) {
        echo "Database Connection FAILED ❌: " . $e->getMessage() . "\n";
    }
}

echo "\n--- Bootstrapping Laravel Test ---\n";
try {
    if (file_exists($vendorPath) && file_exists($bootstrapPath)) {
        require $vendorPath;
        $app = require_once $bootstrapPath;
        echo "Laravel Application Boot: SUCCESSFUL ✅\n";
    }
} catch (Throwable $e) {
    echo "Laravel Boot Error ❌: " . $e->getMessage() . "\n";
    echo "File: " . $e->getFile() . " on line " . $e->getLine() . "\n";
    echo "Trace:\n" . $e->getTraceAsString() . "\n";
}
