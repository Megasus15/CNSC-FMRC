<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class InstallPortalUpgrade extends Command
{
    protected $signature = 'portal:upgrade {--check : Check installation without changing the database} {--force : Apply the upgrade in production after backing up the database}';

    protected $description = 'Install and verify the shipping, policy, courier storage and appointment upgrade together';

    private const MIGRATIONS = [
        '2026_11_02_000001_add_shipping_quotes_and_settings',
        '2026_11_02_000002_add_transaction_policy_snapshots',
        '2026_11_02_000003_add_courier_shipments',
        '2026_11_02_000004_extend_appointment_workflows',
    ];

    private const SCHEMA = [
        'shipping_settings' => ['revision', 'draft', 'published', 'published_version'],
        'commerce_policy_settings' => ['revision', 'draft', 'published_version'],
        'commerce_policies' => ['version', 'title', 'terms_text', 'refund_text'],
        'orders' => ['shipping_fee', 'shipping_quote', 'estimated_delivery_from', 'estimated_delivery_to', 'accepted_policy_version', 'accepted_policy_text', 'policy_accepted_at', 'courier_history_version'],
        'courier_shipments' => ['reference', 'status', 'booking_payload'],
        'shipment_booking_attempts' => ['request_key', 'status'],
        'courier_webhook_events' => ['event_key', 'status'],
        'appointments' => ['appointment_method', 'appointment_starts_at', 'meeting_platform', 'meeting_url', 'schedule_version'],
        'appointment_schedule_locks' => ['id'],
        'appointment_attachments' => ['appointment_id', 'path'],
        'appointment_schedule_history' => ['appointment_id', 'previous_date', 'appointment_date'],
    ];

    public function handle(): int
    {
        if (! $this->option('check')) {
            if (app()->isProduction() && ! $this->option('force')) {
                $this->error('Back up the database, then run php artisan portal:upgrade --force. Use --check for a read-only check.');

                return self::FAILURE;
            }
            // Only these four additive migrations belong to this release.
            // Laravel skips recorded migrations; do not reset, seed or roll back existing data.
            foreach (self::MIGRATIONS as $migration) {
                if ($this->call('migrate', ['--path' => 'database/migrations/'.$migration.'.php', '--force' => true]) !== self::SUCCESS) {
                    $this->error('Upgrade stopped. Resolve the migration error before retrying; do not reset the database.');

                    return self::FAILURE;
                }
            }
        }

        $missing = [];
        foreach (self::SCHEMA as $table => $columns) {
            if (! Schema::hasTable($table) || ! Schema::hasColumns($table, $columns)) {
                $missing[] = $table;
            }
        }
        foreach (['shipping_settings', 'commerce_policy_settings', 'appointment_schedule_locks'] as $table) {
            if (Schema::hasTable($table) && ! DB::table($table)->where('id', 1)->exists()) {
                $missing[] = $table.' initial record';
            }
        }
        if ($missing) {
            $this->error('Upgrade incomplete: '.implode(', ', $missing).'.');
            $this->line('Run php artisan portal:upgrade --force in the backend directory used by the live website.');

            return self::FAILURE;
        }

        $this->info('All four portal upgrade schemas and initial records are installed.');
        $this->line(DB::table('shipping_settings')->where('id', 1)->value('published_version')
            ? 'Shipping: published settings exist; verify checkout on the website.'
            : 'Shipping: Admin must review and publish approved rates to offer delivery. Pickup has no shipping fee.');
        $this->line(DB::table('commerce_policy_settings')->where('id', 1)->value('published_version')
            ? 'Policy: a published version exists; verify the customer acceptance page.'
            : 'Policy: Admin must review and publish approved wording before customers can place orders.');
        $this->line(config('ninjavan.enabled')
            ? 'Courier API is enabled in configuration. This check does NOT verify provider approval, booking or real delivery.'
            : 'Courier API is disabled. No live courier booking or delivery has been verified.');
        $this->line('Database installation only: verify live sign-in, saves, uploads, checkout and appointments separately.');

        return self::SUCCESS;
    }
}
