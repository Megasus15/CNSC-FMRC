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

    echo "\n--- Mail Configuration in .env ---\n";
    preg_match('/MAIL_MAILER=(.*)/', $envContent, $mailerMatch);
    preg_match('/MAIL_HOST=(.*)/', $envContent, $mailHostMatch);
    preg_match('/MAIL_PORT=(.*)/', $envContent, $mailPortMatch);
    preg_match('/MAIL_USERNAME=(.*)/', $envContent, $mailUserMatch);
    preg_match('/MAIL_PASSWORD=(.*)/', $envContent, $mailPassMatch);
    preg_match('/MAIL_ENCRYPTION=(.*)/', $envContent, $mailEncMatch);
    preg_match('/MAIL_FROM_ADDRESS=(.*)/', $envContent, $mailFromMatch);

    $mailer = trim($mailerMatch[1] ?? 'NOT SET (defaults to log)');
    $mHost = trim($mailHostMatch[1] ?? 'NOT SET');
    $mPort = trim($mailPortMatch[1] ?? 'NOT SET');
    $mUser = trim($mailUserMatch[1] ?? 'NOT SET');
    $mPass = trim($mailPassMatch[1] ?? '');
    $mEnc = trim($mailEncMatch[1] ?? 'NOT SET');
    $mFrom = trim($mailFromMatch[1] ?? 'NOT SET');

    echo "MAIL_MAILER: $mailer\n";
    echo "MAIL_HOST: $mHost\n";
    echo "MAIL_PORT: $mPort\n";
    echo "MAIL_ENCRYPTION: $mEnc\n";
    echo "MAIL_USERNAME: $mUser\n";
    echo "MAIL_PASSWORD: " . (empty($mPass) ? "NOT SET ❌" : "SET (" . strlen($mPass) . " chars) ✅") . "\n";
    echo "MAIL_FROM_ADDRESS: $mFrom\n";
}

echo "\n--- Bootstrapping Laravel Test ---\n";
try {
    if (file_exists($vendorPath) && file_exists($bootstrapPath)) {
        require $vendorPath;
        $app = require_once $bootstrapPath;
        echo "Laravel Application Boot: SUCCESSFUL ✅\n";

        // Test sending email if requested
        $testTarget = trim($_GET['test_mail'] ?? '');
        if ($testTarget && filter_var($testTarget, FILTER_VALIDATE_EMAIL)) {
            echo "\n--- Sending Test Email to $testTarget ---\n";
            try {
                $kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);
                $response = $kernel->handle(
                    \Illuminate\Http\Request::capture()
                );

                \Illuminate\Support\Facades\Mail::raw(
                    "This is a test notification from UCN-FMRC on Hostinger at " . date('Y-m-d H:i:s'),
                    function ($message) use ($testTarget) {
                        $from = config('mail.from.address') ?: 'cnscfmrc@gmail.com';
                        $fromName = config('mail.from.name') ?: 'UCN-FMRC';
                        $message->to($testTarget)
                            ->subject('UCN-FMRC Live Mail Test')
                            ->from($from, $fromName);
                    }
                );
                echo "Test Email Result: SUCCESS ✅ Email was accepted by SMTP server for delivery to $testTarget\n";
            } catch (Throwable $mailEx) {
                echo "Test Email Result: FAILED ❌\n";
                echo "Error: " . $mailEx->getMessage() . "\n";
                echo "File: " . $mailEx->getFile() . " on line " . $mailEx->getLine() . "\n";
            }
        } else {
            echo "\n(Tip: Visit api_check.php?test_mail=YOUR_EMAIL@gmail.com to test live email delivery)\n";
        }
    }
} catch (Throwable $e) {
    echo "Laravel Boot Error ❌: " . $e->getMessage() . "\n";
    echo "File: " . $e->getFile() . " on line " . $e->getLine() . "\n";
    echo "Trace:\n" . $e->getTraceAsString() . "\n";
}
