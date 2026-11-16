<?php
require __DIR__.'/../backend/vendor/autoload.php';
$app = require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$html = App\Support\EmailTemplate::previewDraft('order_received', [], [
    'facebook_url' => 'https://www.facebook.com/UCNFMRC',
    'website_url' => 'https://ucn-fabmanlab.com',
    'phone' => '0909-099-0000',
]);
file_put_contents(__DIR__.'/email-contact-preview.html', $html);
echo "Rendered local sample; no email sent.\n";
