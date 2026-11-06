<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Schedule::command('pwa:process')->everyMinute()->withoutOverlapping(5);

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('payments:reconcile')->everyMinute()->withoutOverlapping(5);
Schedule::command('shipments:process')->everyMinute()->withoutOverlapping(5);
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
