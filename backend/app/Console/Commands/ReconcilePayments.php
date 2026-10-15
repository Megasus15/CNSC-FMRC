<?php
namespace App\Console\Commands;
use App\Services\GatewayPayments;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\{DB, Cache, Log};

class ReconcilePayments extends Command {
    protected $signature = 'payments:reconcile';
    protected $description = 'Process durable payment events and reconcile unresolved online payments/refunds';
    public function handle(GatewayPayments $gateway): int {
        $lock = Cache::lock('payments:reconcile', 300);
        if (!$lock->get()) return self::SUCCESS;
        $deadline = microtime(true) + 40;
        try {
            foreach (DB::table('payment_webhook_events')->where('status', 'pending')->orderBy('tries')->limit(50)->get() as $event) {
                if (microtime(true) >= $deadline) break;
                try { $gateway->processEvent($event); } catch (\Throwable $e) { Log::warning('Payment event awaits reconciliation', ['event_id' => $event->id]); }
            }
            foreach (DB::table('payment_attempts')->whereNull('confirmed_at')->whereNotIn('status', ['expired','failed'])->orderBy('checked_at')->limit(50)->get() as $a) {
                if (microtime(true) >= $deadline) break;
                try { if ($a->checkout_id) $gateway->reconcile($a->id); else { $gateway->createSession($a); DB::table('payment_attempts')->where('id', $a->id)->update(['checked_at' => now()]); } }
                catch (\Throwable $e) { Log::warning('Payment attempt awaits reconciliation', ['attempt_id' => $a->id]); }
            }
            foreach (DB::table('payment_refunds')->whereIn('status', ['submitting','unknown','pending'])->orderBy('checked_at')->limit(50)->get() as $r) {
                if (microtime(true) >= $deadline) break;
                try { $gateway->reconcileRefund($r); } catch (\Throwable $e) { Log::warning('Refund awaits reconciliation', ['refund_id' => $r->id]); }
            }
            Cache::put('payments:last_reconciled_at', now()->toIso8601String(), now()->addDays(2));
        } finally { $lock->release(); }
        return self::SUCCESS;
    }
}
