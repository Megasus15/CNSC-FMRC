<?php

namespace App\Support;

use App\Models\AppointmentProductJob;
use App\Services\AppointmentProducts;
use App\Services\GatewayPayments;
use App\Services\PayMongoService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Period activity selects requests; their workflow details are current snapshots. */
final class CustomProductReport
{
    public static function build(array $period): array
    {
        abort_unless(AppointmentProducts::installed(), 503, 'Custom Products reporting is unavailable until the appointment-product tables are installed.');
        $range = fn ($query, $column) => $query->where($column, '>=', $period['start_utc'])->where($column, '<', $period['end_utc']);
        $inPeriod = fn ($value) => $value && Carbon::parse($value, 'UTC')->gte($period['start_utc']) && Carbon::parse($value, 'UTC')->lt($period['end_utc']);
        $activities = [];
        $add = static function ($job, $at) use (&$activities, $inPeriod): void {
            if ($inPeriod($at)) {
                $activities[(int) $job][] = Carbon::parse($at, 'UTC');
            }
        };

        $events = $range(DB::table('appointment_product_events')->where('action', '!=', 'message'), 'created_at')
            ->get(['job_id', 'action', 'created_at']);
        foreach ($events as $event) {
            $add($event->job_id, $event->created_at);
        }
        // Creation time is the booking time even when the brief began as an older draft.
        $bookings = $range(DB::table('appointments')->join('appointment_product_jobs as job', 'job.appointment_id', '=', 'appointments.id'), 'appointments.created_at')
            ->get(['job.id as job_id', 'appointments.created_at']);
        foreach ($bookings as $booking) {
            $add($booking->job_id, $booking->created_at);
        }
        $consultations = $range(DB::table('appointments')->whereNotNull('product_job_id')
            ->whereIn('status', ['Completed', 'Archived']), 'appointment_starts_at')->get(['product_job_id', 'appointment_starts_at']);
        foreach ($consultations as $consultation) {
            $add($consultation->product_job_id, $consultation->appointment_starts_at);
        }

        $quoteActivity = DB::table('appointment_product_quotes')->where(function ($query) use ($range) {
            $query->where(fn ($q) => $range($q, 'sent_at'))
                ->orWhere(fn ($q) => $range($q, 'accepted_at'))
                ->orWhere(fn ($q) => $range($q->where('state', 'expired'), 'expires_at'));
        })->get(['id', 'job_id', 'sent_at', 'accepted_at', 'expires_at', 'state']);
        foreach ($quoteActivity as $quote) {
            foreach (['sent_at', 'accepted_at'] as $date) {
                $add($quote->job_id, $quote->$date);
            }
            if ($quote->state === 'expired') {
                $add($quote->job_id, $quote->expires_at);
            }
        }
        $orderDates = ['created_at', 'approved_at', 'pickup_ready_at', 'picked_up_at', 'completed_at', 'cancel_requested_at', 'cancelled_at', 'rejected_at'];
        $orderActivity = DB::table('orders')->whereNotNull('appointment_product_job_id')->where('is_archived', false)
            ->where(function ($query) use ($range, $orderDates) {
                foreach ($orderDates as $date) {
                    $query->orWhere(fn ($q) => $range($q, $date));
                }
            })->get(array_merge(['id', 'appointment_product_job_id'], $orderDates));
        foreach ($orderActivity as $order) {
            foreach ($orderDates as $date) {
                $add($order->appointment_product_job_id, $order->$date);
            }
        }
        $tracking = $range(DB::table('order_tracking_events')->join('orders', 'orders.id', '=', 'order_tracking_events.order_id')
            ->whereNotNull('orders.appointment_product_job_id')->where('orders.is_archived', false), 'order_tracking_events.occurred_at')
            ->get(['orders.appointment_product_job_id', 'order_tracking_events.occurred_at']);
        foreach ($tracking as $event) {
            $add($event->appointment_product_job_id, $event->occurred_at);
        }
        $returns = $range(DB::table('order_return_events')->join('order_returns', 'order_returns.id', '=', 'order_return_events.order_return_id')
            ->join('orders', 'orders.id', '=', 'order_returns.order_id')->whereNotNull('orders.appointment_product_job_id')
            ->where('orders.is_archived', false), 'order_return_events.occurred_at')
            ->get(['orders.appointment_product_job_id', 'order_return_events.occurred_at']);
        foreach ($returns as $event) {
            $add($event->appointment_product_job_id, $event->occurred_at);
        }

        $ledger = [];
        foreach (['receipts', 'refunds'] as $kind) {
            $table = 'payment_'.$kind;
            $query = $kind === 'receipts' ? GatewayFinancials::receipts() : GatewayFinancials::refunds();
            $source = 'payment_receipts.source_type';
            if ($kind === 'refunds') {
                $query->leftJoin('payment_receipts as original_receipt', function ($join) {
                    $join->on('original_receipt.provider_payment_id', '=', 'payment_refunds.provider_payment_id')
                        ->on('original_receipt.payment_id', '=', 'payment_refunds.payment_id');
                });
                $source = 'original_receipt.source_type';
            }
            $entries = $range($query->whereNotNull('orders.appointment_product_job_id')->where('orders.is_archived', false), $table.'.confirmed_at')
                ->get([$table.'.id', $table.'.confirmed_at', $table.'.amount_centavos', 'orders.id as order_id', 'orders.order_no',
                    'orders.appointment_product_job_id as job_id', $source.' as source_type', $table.'.provider_'.($kind === 'receipts' ? 'payment' : 'refund').'_id as reference']);
            foreach ($entries as $entry) {
                $ledger[] = ['entry' => ($kind === 'receipts' ? 'PAY-' : 'REF-').$entry->id,
                    'job_id' => (int) $entry->job_id, 'order_no' => $entry->order_no, 'method' => PayMongoService::methodLabel($entry->source_type ?? 'gcash'),
                    'kind' => $kind === 'receipts' ? 'Collection' : 'Refund', 'reference' => $entry->reference,
                    'at' => $entry->confirmed_at, 'cents' => (int) $entry->amount_centavos * ($kind === 'receipts' ? 1 : -1)];
                $add($entry->job_id, $entry->confirmed_at);
            }
        }
        foreach ($range(AppointmentProductMetrics::cash(false)->where('orders.is_archived', false), 'appointment_cash_entries.confirmed_at')
            ->get(['appointment_cash_entries.*', 'orders.appointment_product_job_id as job_id', 'orders.order_no']) as $entry) {
            $ledger[] = ['entry' => 'CASH-'.$entry->id, 'job_id' => (int) $entry->job_id, 'order_no' => $entry->order_no,
                'method' => 'Cash at FMRC', 'kind' => match ($entry->kind) {'receipt' => 'Collection', 'reversal' => 'Receipt reversal', default => 'Refund'},
                'reference' => $entry->receipt_reference, 'at' => $entry->confirmed_at,
                'cents' => (int) $entry->amount_centavos * ($entry->kind === 'receipt' ? 1 : -1)];
            $add($entry->job_id, $entry->confirmed_at);
        }

        $jobs = AppointmentProductJob::with(['appointment', 'quotes', 'orders' => fn ($q) => $q->where('is_archived', false)->orderByDesc('id'), 'orders.payment', 'orders.items'])
            ->whereIn('id', array_keys($activities))->whereNotNull('appointment_id')->where('state', '!=', 'draft')->get()->keyBy('id');
        $ledger = array_values(array_filter($ledger, fn ($entry) => $jobs->has($entry['job_id'])));
        $paymentIds = $jobs->flatMap(fn ($job) => $job->orders->pluck('payment.id'))->filter()->unique();
        $receiptMethods = DB::table('payment_receipts')->whereIn('payment_id', $paymentIds)->where('livemode', true)
            ->orderByDesc('id')->get(['payment_id', 'provider_payment_id', 'source_type'])->groupBy('payment_id');
        $attemptMethods = DB::table('payment_attempts')->whereIn('payment_id', $paymentIds)->orderByDesc('id')
            ->get(['payment_id', 'checkout_method'])->groupBy('payment_id');
        $rows = $orderRows = [];
        $services = $stages = [];
        foreach ($jobs as $job) {
            $orders = $job->orders;
            $latestOrder = $orders->first();
            $stage = $latestOrder && ! in_array($latestOrder->lifecycle_status, ['cancelled', 'rejected'], true)
                ? AppointmentProducts::orderStage($latestOrder) : (AppointmentProducts::LABELS[$job->state] ?? 'Reviewing requirements');
            $latestQuote = $job->quotes->sortByDesc('version')->first();
            $lastActivity = collect($activities[$job->id])->sortDesc()->first();
            $reference = 'CP-'.str_pad((string) $job->id, 5, '0', STR_PAD_LEFT);
            $rows[] = ['request' => $reference."\n".$job->appointment?->reference_no,
                'customer' => trim($job->appointment?->first_name.' '.$job->appointment?->last_name) ?: 'Customer',
                'product' => $job->service_name."\n".($job->requirements['name'] ?? 'Custom product'),
                'quotation' => $latestQuote ? 'v'.$latestQuote->version.' · '.ucfirst($latestQuote->state) : 'Not yet quoted',
                'quotation_total' => $latestQuote ? $latestQuote->total_centavos / 100 : null,
                'stage' => $stage, 'orders' => $orders->pluck('order_no')->implode(', ') ?: 'Not yet ordered',
                'last_activity' => $lastActivity?->timezone('Asia/Manila')->toIso8601String()];
            $services[$job->service_name] = ($services[$job->service_name] ?? 0) + 1;
            $stages[$stage] = ($stages[$stage] ?? 0) + 1;
            foreach ($orders as $order) {
                $payment = $order->payment;
                $receipts = $receiptMethods->get($payment?->id, collect());
                $receipt = $receipts->firstWhere('provider_payment_id', $payment?->paymongo_payment_id) ?? $receipts->first();
                $method = $receipt?->source_type ?? $attemptMethods->get($payment?->id)?->first()?->checkout_method;
                $methodLabel = GatewayPayments::managed($payment) && $method ? PayMongoService::methodLabel($method)
                    : ($payment?->method ?: $order->payment_method);
                $orderRows[] = ['request' => $reference, 'order_no' => $order->order_no,
                    'quantity' => (int) $order->quantity, 'product_value' => (float) $order->subtotal,
                    'shipping' => (float) $order->shipping_fee, 'total' => (float) $order->total,
                    'payment' => $methodLabel.' · '.ucfirst($payment?->status ?? 'pending'),
                    'stage' => AppointmentProducts::orderStage($order),
                    'fulfillment' => $order->isPickup() ? 'Pickup at FMRC' : 'J&T delivery'];
            }
        }
        usort($rows, fn ($a, $b) => strcmp($b['last_activity'] ?? '', $a['last_activity'] ?? ''));
        usort($ledger, fn ($a, $b) => strcmp($b['at'], $a['at']) ?: strcmp($a['entry'], $b['entry']));
        $online = $cash = $refunds = 0;
        foreach ($ledger as $entry) {
            if ($entry['kind'] === 'Refund') {
                $refunds -= $entry['cents'];
            } elseif ($entry['method'] === 'Cash at FMRC') {
                $cash += $entry['cents'];
            } else {
                $online += $entry['cents'];
            }
        }
        $financialRows = array_map(fn ($entry) => [
            'entry' => $entry['entry'], 'at' => Carbon::parse($entry['at'], 'UTC')->timezone('Asia/Manila')->toIso8601String(),
            'order_no' => $entry['order_no'], 'method' => $entry['method'], 'kind' => $entry['kind'],
            'reference' => $entry['reference'], 'amount' => $entry['cents'] / 100,
        ], $ledger);

        $labels = $keys = [];
        for ($cursor = $period['start_local']->copy(); $cursor->lt($period['end_local']); $period['period'] === 'monthly' ? $cursor->addDay() : $cursor->addMonth()) {
            $labels[] = $cursor->format($period['period'] === 'monthly' ? 'M j' : 'M');
            $keys[] = $cursor->format($period['period'] === 'monthly' ? 'Y-m-d' : 'Y-m');
        }
        $quotes = $quoteActivity->filter(fn ($q) => $jobs->has($q->job_id) && $inPeriod($q->sent_at));
        $production = $orderActivity->filter(fn ($o) => $jobs->has($o->appointment_product_job_id) && $inPeriod($o->approved_at));
        $completed = $orderActivity->filter(fn ($o) => $jobs->has($o->appointment_product_job_id) && $inPeriod($o->completed_at));
        $newBookings = $bookings->filter(fn ($b) => $jobs->has($b->job_id))->keyBy('job_id');
        // Later opt-ins are new requests on an older appointment, not new consultations.
        foreach ($events->where('action', 'requested') as $event) {
            if ($jobs->has($event->job_id) && ! $newBookings->has($event->job_id)) {
                $newBookings->put($event->job_id, $event);
            }
        }
        $series = [];
        foreach ([['Requests booked', $newBookings, 'created_at'], ['Quotations sent', $quotes, 'sent_at'],
            ['Production started', $production, 'approved_at'], ['Orders completed', $completed, 'completed_at']] as [$name, $items, $field]) {
            $values = array_fill(0, count($keys), 0);
            foreach ($items as $item) {
                $key = Carbon::parse($item->$field, 'UTC')->timezone('Asia/Manila')->format($period['period'] === 'monthly' ? 'Y-m-d' : 'Y-m');
                $index = array_search($key, $keys, true);
                if ($index !== false) {
                    $values[$index]++;
                }
            }
            $series[] = compact('name', 'values');
        }
        $metric = fn ($key, $label, $value, $format = 'integer') => compact('key', 'label', 'value', 'format');
        $column = fn ($key, $label, $type = 'text') => compact('key', 'label', 'type');

        return [
            'metrics' => [$metric('active_requests', 'Requests with activity', $jobs->count()),
                $metric('quotations_sent', 'Quotations sent', $quotes->count()), $metric('production_started', 'Production started', $production->count()),
                $metric('completed_orders', 'Orders completed', $completed->count()),
                $metric('online_collections', 'Online collections', $online / 100, 'currency'),
                $metric('cash_collections', 'Cash collections (net reversals)', $cash / 100, 'currency'),
                $metric('refunds', 'Confirmed refunds', $refunds / 100, 'currency'),
                $metric('net_collections', 'Net collections', ($online + $cash - $refunds) / 100, 'currency')],
            'chart' => ['title' => 'Custom Product Activity in Period', 'value_type' => 'integer', 'labels' => $labels, 'series' => $series],
            'breakdown' => ['title' => 'Requests by Service and Current Stage', 'value_type' => 'integer', 'items' => array_merge(
                collect($services)->map(fn ($value, $label) => ['label' => 'Service · '.$label, 'value' => $value])->values()->all(),
                collect($stages)->map(fn ($value, $label) => ['label' => 'Stage · '.$label, 'value' => $value])->values()->all())],
            'table' => ['title' => 'Custom Requests — Current Status at Generation', 'columns' => [
                $column('request', 'Request / Appointment'), $column('customer', 'Customer'), $column('product', 'Service / Product'),
                $column('quotation', 'Latest Quotation'), $column('quotation_total', 'Quoted Value', 'currency'), $column('stage', 'Current Stage', 'status'),
                $column('orders', 'Linked Orders'), $column('last_activity', 'Latest Period Activity', 'datetime')], 'rows' => $rows],
            'additional_tables' => [
                ['title' => 'Linked Custom Orders — Current Status at Generation', 'columns' => [
                    $column('request', 'Request'), $column('order_no', 'Order No.'), $column('quantity', 'Quantity', 'integer'),
                    $column('product_value', 'Product Value', 'currency'), $column('shipping', 'Shipping', 'currency'), $column('total', 'Total', 'currency'),
                    $column('payment', 'Payment'), $column('stage', 'Production / Stage', 'status'), $column('fulfillment', 'Fulfillment')], 'rows' => $orderRows],
                ['title' => 'Confirmed Financial Activity in Period', 'columns' => [
                    $column('entry', 'Entry'), $column('at', 'Confirmed', 'datetime'), $column('order_no', 'Order No.'), $column('method', 'Method'),
                    $column('kind', 'Entry Type'), $column('reference', 'Reference'), $column('amount', 'Amount', 'currency')], 'rows' => $financialRows],
            ],
        ];
    }
}
