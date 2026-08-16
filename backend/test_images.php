<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "ORDER ITEMS COUNT: " . App\Models\OrderItem::count() . PHP_EOL;
foreach (App\Models\OrderItem::take(10)->get() as $item) {
    $img = $item->product_image;
    $prod = $item->product;
    $prodImg = $prod ? ($prod->image_data ?? $prod->image_url ?? null) : null;
    echo "Item #{$item->id} Name: {$item->product_name}" . PHP_EOL;
    echo "  OrderItem product_image len: " . strlen((string)$img) . " sample: " . substr((string)$img, 0, 60) . PHP_EOL;
    echo "  Product image len: " . strlen((string)$prodImg) . " sample: " . substr((string)$prodImg, 0, 60) . PHP_EOL;
}
