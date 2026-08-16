<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\OrderItem;
use App\Http\Controllers\Api\OrderController;

$controller = new OrderController();
$reflection = new ReflectionClass($controller);

$decodeMethod = $reflection->getMethod('decodeStoredProductImage');
$decodeMethod->setAccessible(true);

$failedCount = 0;
$total = OrderItem::count();

foreach (OrderItem::all() as $item) {
    $decoded = $decodeMethod->invoke($controller, $item->product_image);
    if (!$decoded) {
        $failedCount++;
        echo "FAILED Item #{$item->id} Order #{$item->order_id} Name: '{$item->product_name}' product_image: '" . substr((string)$item->product_image, 0, 40) . "'" . PHP_EOL;
    }
}

echo "Total items: {$total}, Failed decode count: {$failedCount}" . PHP_EOL;
