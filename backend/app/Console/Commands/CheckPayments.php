<?php

namespace App\Console\Commands;

use App\Services\PayMongoService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\{Cache, Schema};

/** Read-only checks. Never prints credentials or creates a payment. */
class CheckPayments extends Command
{
    protected $signature = 'payments:check {--provider : Check the selected method against PayMongo using a read-only request}';
    protected $description = 'Check online payment configuration, ledger, scheduler, and optional provider capability';

    public function handle(PayMongoService $provider): int
    {
        $failed = false;
        $check = function (string $label, bool $passed, string $detail) use (&$failed): void {
            $this->line(($passed ? 'PASS' : 'FAIL').' '.$label.': '.$detail);
            $failed = $failed || !$passed;
        };
        $method = $provider->checkoutMethod();
        $supported = PayMongoService::supportsMethod($method);
        $check('Payment gateway', config('payments.gateway') === 'paymongo', config('payments.gateway') === 'paymongo' ? 'PayMongo' : 'Set PAYMENT_GATEWAY=paymongo');
        $check('Checkout method', $supported, $supported ? $method : 'Set PAYMONGO_CHECKOUT_METHOD=qrph or gcash');
        $check('Private credentials', $provider->isConfigured(), $provider->isConfigured()
            ? ($provider->isLive() ? 'Live key and webhook secret configured' : 'Test key and webhook secret configured; test environment only')
            : 'Valid API key and webhook signing secret required; production requires a live key');
        $this->line(config('payments.paymongo.enabled') ? 'INFO New checkout switch: enabled' : 'INFO New checkout switch: disabled; existing payments can still be reconciled');
        foreach (['app.url' => 'APP_URL', 'app.frontend_url' => 'FRONTEND_URL'] as $key => $label) {
            $url = config($key) ?: ($key === 'app.frontend_url' ? config('app.url') : '');
            $valid = filter_var($url, FILTER_VALIDATE_URL) && parse_url($url, PHP_URL_SCHEME) === 'https';
            $check($label, (bool)$valid, $valid ? 'HTTPS configured' : 'Configure the public HTTPS origin');
        }
        try {
            $schema = Schema::hasColumn('payment_attempts', 'checkout_method')
                && Schema::hasColumn('payment_receipts', 'source_type')
                && Schema::hasTable('payment_submissions') && Schema::hasTable('payment_webhook_events')
                && Schema::hasTable('payment_refunds') && Schema::hasColumn('payments', 'gateway');
            $check('Payment ledger', $schema, $schema ? 'Required tables and QR Ph columns are present' : 'Apply the payment migrations, including 2027_01_07');
        } catch (\Throwable $e) {
            $check('Payment ledger', false, 'Database could not be checked; verify connection and migrations');
        }
        try {
            $heartbeat = Cache::get('payments:last_reconciled_at');
            $recent = $heartbeat && Carbon::parse($heartbeat)->between(now()->subMinutes(3), now());
            $check('Reconciliation scheduler', (bool)$recent, $recent ? 'Recent heartbeat found' : 'No recent heartbeat; configure the every-minute hosting cron');
        } catch (\Throwable $e) {
            $check('Reconciliation scheduler', false, 'Cache or heartbeat could not be checked');
        }
        if ($this->option('provider')) {
            if (!$provider->isConfigured() || !$supported) {
                $check('Provider capability', false, 'Fix private credentials and checkout method before checking');
            } else {
                $capabilities = $provider->request('GET', 'v1/merchants/capabilities/payment_methods');
                $valid = is_array($capabilities) && array_is_list($capabilities)
                    && count(array_filter($capabilities, 'is_string')) === count($capabilities);
                $active = $valid && in_array($method, $capabilities, true);
                $check('Provider capability', $active, !$valid ? 'Could not verify the response; no payment was created'
                    : ($active ? 'Selected method is available for this API key' : 'Selected method is unavailable for this API key'));
            }
        } else {
            $this->line('INFO Provider capability: not checked; use --provider for a read-only API check');
        }
        $this->line('INFO These checks do not prove webhook delivery, merchant ownership approval, or a real payment/refund.');
        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
