<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Schedule::command('pwa:process')->everyMinute()->withoutOverlapping(5);

Artisan::command('products:clean-media-drafts', function () {
    $this->info(\App\Services\ProductMedia::cleanExpired().' expired product upload(s) removed.');
})->purpose('Remove unpublished product media after 24 hours; retain published order image references');
Schedule::command('products:clean-media-drafts')->hourly()->withoutOverlapping(10);

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('payments:reconcile')->everyMinute()->withoutOverlapping(5);
// Run inside the scheduler's bootstrapped app on shared hosting. A separate PHP
// child can be skipped or fail before the worker heartbeat is written.
// The command owns its 120-second lock; a second scheduler lock hides skips.
Schedule::call(function () {
    $status = Artisan::call('shipments:process', ['--verbose' => true]);
    echo Artisan::output();
    if ($status !== 0) {
        throw new RuntimeException('Shipment processing failed; check the protected application log.');
    }
})->name('fmrc-shipments-'.substr(hash('sha256', base_path()), 0, 8))->everyMinute();
Artisan::command('appointments:expire-quotes', function () {
    $count=app(\App\Http\Controllers\Api\AppointmentProductController::class)->expire();
    $this->info($count.' appointment quotation(s) closed.');
})->purpose('Reconcile and close unpaid appointment quotations past their deadline');
Schedule::command('appointments:expire-quotes')->everyMinute()->withoutOverlapping(5);
Artisan::command('appointments:product-status', function () {
    $ready=\App\Services\AppointmentProducts::installed();
    $this->info('Schema: '.($ready?'ready':'pending migration'));
    $this->info('New intake: '.(\App\Services\AppointmentProducts::enabled()?'enabled':'disabled'));
    $this->info('Private storage: '.(is_writable(storage_path('app/private'))?'writable':'check permissions'));
    $this->info('Online checkout: '.(app(\App\Services\PayMongoService::class)->acceptsNewPayments()?'configured':'unavailable'));
    $this->line('Verify the scheduler, email delivery, provider test transactions and courier activation separately. No secrets are displayed.');
})->purpose('Read-only readiness check for optional appointment products');
