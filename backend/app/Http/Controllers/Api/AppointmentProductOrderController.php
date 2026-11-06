<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AppointmentProductJob;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\OrderTrackingEvent;
use App\Models\Payment;
use App\Services\AppointmentProducts as Products;
use App\Services\GatewayPayments;
use App\Services\PayMongoService;
use App\Support\OrderNotifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AppointmentProductOrderController extends Controller
{
    public function action(Request $r, Order $order)
    {
        abort_unless(in_array($r->user()?->role, ['admin', 'staff'], true), 403);
        abort_unless(Products::custom($order) && Products::installed(), 404);
        $v = $r->validate(['action' => 'required|in:cash_receipt,cash_refund,cash_reverse,start,ready,collect',
            'expected_revision' => 'required|integer|min:0', 'request_key' => 'required|string|max:80|regex:/^[A-Za-z0-9-]+$/',
            'receipt_reference' => 'required_if:action,cash_receipt,cash_refund,cash_reverse|nullable|string|max:100',
            'amount' => 'required_if:action,cash_receipt,cash_refund|nullable|numeric|decimal:0,2|min:0.01',
            'confirmed_received' => 'required_if:action,cash_receipt|accepted_if:action,cash_receipt',
            'refund_released' => 'required_if:action,cash_refund|accepted_if:action,cash_refund',
            'note' => 'required_if:action,cash_refund,cash_reverse|nullable|string|max:1000', 'pickup_code' => 'required_if:action,collect|nullable|string|max:20',
            'return_id' => 'nullable|integer']);
        $action = $v['action'];
        if (in_array($action, ['cash_refund', 'cash_reverse'], true)) {
            abort_unless($r->user()->role === 'admin', 403, 'Only Admin can issue refunds or correct a receipt.');
        }
        DB::transaction(function () use ($r, $order, $v, $action) {
            $o = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $p = Payment::where('order_id', $o->id)->lockForUpdate()->firstOrFail();
            $o->setRelation('payment', $p);
            if ($entry = DB::table('appointment_cash_entries')->where('request_key', $v['request_key'])->first()) {
                abort_unless((int) $entry->payment_id === (int) $p->id && $entry->kind === match ($action) {
                    'cash_receipt' => 'receipt','cash_refund' => 'refund','cash_reverse' => 'reversal',default => ''
                }
                    && $entry->receipt_reference === trim($v['receipt_reference'] ?? '') && ($action === 'cash_reverse' || (int) $entry->amount_centavos === GatewayPayments::centavos($v['amount'] ?? 0)), 409, 'This action key was used for different receipt details. Review the recorded receipt before continuing.');

                return;
            }
            if (($action === 'start' && $o->appointment_production_status === 'in_production') || ($action === 'ready' && $o->appointment_production_status === 'ready') || ($action === 'collect' && $o->picked_up_at)) {
                return;
            }
            abort_unless((int) $o->production_revision === (int) $v['expected_revision'], 409, 'This order changed. Review its latest payment and production details before continuing.');
            $title = '';
            if (str_starts_with($action, 'cash_')) {
                abort_unless($p->method === 'Cash at FMRC' && ! GatewayPayments::managed($p), 422, 'This order does not use advance cash payment.');
                $held = Products::cashHeld($p);
                $total = GatewayPayments::centavos($o->total);
                $amount = GatewayPayments::centavos($v['amount'] ?? 0);
                if ($action === 'cash_receipt') {
                    Products::assertPayable($o);
                    abort_unless($p->status === 'pending' && $held === 0 && $amount === $total, 422, 'Record the exact full quotation total once, after actually receiving the cash.');
                    $kind = 'receipt';
                    $p->status = 'paid';
                    $p->paid_at = now();
                    $p->reference = $v['receipt_reference'];
                    $o->payment_reference = $v['receipt_reference'];
                    $title = 'Full advance cash payment received';
                } elseif ($action === 'cash_reverse') {
                    abort_unless($held > 0 && ! $o->approved_at && $o->lifecycle_status === 'incoming', 422, 'A receipt can only be corrected before production. Use the refund process after that.');
                    $kind = 'reversal';
                    $amount = $held;
                    $p->status = 'pending';
                    $p->paid_at = null;
                    $title = 'Cash receipt corrected';
                } else {
                    $return = null;
                    if (! empty($v['return_id'])) {
                        $return = OrderReturn::where('order_id', $o->id)->whereKey($v['return_id'])->lockForUpdate()->firstOrFail();
                        abort_unless($return->resolution === 'refund' && in_array($return->status, ['approved', 'item_received', 'refund_processing'], true), 422, 'Approve and receive the return before recording its refund.');
                    }
                    abort_unless(in_array($o->lifecycle_status, ['cancelled', 'rejected'], true) || $return, 422, 'Approve the cancellation or return before issuing a refund.');
                    abort_unless($amount > 0 && $amount <= $held, 422, 'The refund exceeds the remaining received cash.');
                    if ($return) {
                        abort_unless($amount <= GatewayPayments::centavos($return->approved_amount), 422, 'The refund exceeds the approved return amount.');
                    }
                    $kind = 'refund';
                    $title = 'Cash refund released';
                    if ($amount === $held) {
                        $p->status = 'refunded';
                        $p->refunded_at = now();
                        $p->refund_reference = $v['receipt_reference'];
                        $o->cancel_refund_due = false;
                    }
                    if ($return) {
                        $return->forceFill(['status' => 'refunded', 'refund_method' => 'cash', 'refund_reference' => $v['receipt_reference'], 'refunded_amount' => $amount / 100, 'refunded_at' => now()])->save();
                    }
                }
                abort_if(DB::table('appointment_cash_entries')->where('kind', $kind)->where('receipt_reference', trim($v['receipt_reference']))->exists(), 422, 'This receipt reference is already recorded. Check the existing receipt before trying again.');
                DB::table('appointment_cash_entries')->insert(['payment_id' => $p->id, 'kind' => $kind, 'amount_centavos' => $amount,
                    'receipt_reference' => trim($v['receipt_reference']), 'request_key' => $v['request_key'], 'actor_id' => $r->user()->id, 'note' => $v['note'] ?? null, 'confirmed_at' => now(), 'created_at' => now()]);
                $p->save();
            } else {
                Products::assertProduction($o, $action === 'collect');
                if ($action === 'start') {
                    abort_unless($o->lifecycle_status === 'incoming', 422, 'This order has already left the production queue.');
                    $o->forceFill(['appointment_production_status' => 'in_production', 'lifecycle_status' => 'pending', 'approved_at' => now(), 'customer_stage' => 'to_ship']);
                    $title = 'Production started';
                } elseif ($action === 'ready') {
                    abort_unless($o->appointment_production_status === 'in_production', 422, 'Start production before marking this custom product ready.');
                    $o->appointment_production_status = 'ready';
                    $o->customer_stage = $o->isPickup() ? 'to_receive' : 'to_ship';
                    if ($o->isPickup()) {
                        $o->pickup_ready_at = now();
                    }$title = 'Custom product ready';
                } else {
                    abort_unless($o->isPickup() && hash_equals((string) $o->pickup_code, strtoupper(trim($v['pickup_code']))), 422, 'Check the pickup code shown in the customer’s order.');
                    $o->forceFill(['picked_up_at' => now(), 'completed_at' => now(), 'customer_stage' => 'completed', 'lifecycle_status' => 'completed']);
                    $title = 'Custom product collected';
                }
            }
            $o->production_revision++;
            $o->save();
            OrderTrackingEvent::create(['order_id' => $o->id, 'created_by_user_id' => $r->user()->id, 'stage' => $o->customer_stage, 'event_type' => 'admin_update',
                'title' => $title, 'description' => $v['note'] ?? $title, 'occurred_at' => now()]);
            $job = AppointmentProductJob::findOrFail($o->appointment_product_job_id);
            Products::event($job, $action, $title, $r->user()->id, ['order_id' => $o->id]);
            OrderNotifier::notifyAdmins('order', $title, $o->order_no, ['order_id' => $o->id, 'appointment_id' => $job->appointment_id]);
            OrderNotifier::emailCustomer($o, $title, OrderNotifier::buildEmailHtml($o, $title, $title));
        });

        return app(OrderController::class)->adminShow($r, $order->fresh());
    }

    public function switchPayment(Request $r, Order $order)
    {
        abort_unless($r->user() && ($r->user()->id === $order->customer_id || in_array($r->user()->role, ['admin', 'staff'], true)), 404);
        abort_unless(Products::custom($order), 404);
        $v = $r->validate(['payment_method' => 'required|in:online,cash', 'expected_revision' => 'required|integer|min:0']);
        $hold = 'switch:'.$v['payment_method'];
        DB::transaction(function () use ($order, $v, $hold) {
            $o = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            abort_unless((int) $o->production_revision === (int) $v['expected_revision'], 409, 'This order changed. Review it before switching payment methods.');
            abort_if($o->collection_hold && $o->collection_hold !== $hold, 409, 'Finish reconciling the previous payment action first.');
            if (! $o->collection_hold) {
                Products::assertPayable($o);
            }
            abort_unless($o->payment?->status === 'pending' && Products::moneyHeld($o) === 0, 422, 'This order already has a received payment.');
            $o->forceFill(['collection_hold' => $hold])->save();
        });
        try {
            Products::closeCheckout($order->fresh());
        } catch (\Throwable $e) {
            if (Products::moneyHeld($order->fresh()) > 0) {
                $order->forceFill(['collection_hold' => null])->save();
            }
            throw $e;
        }
        DB::transaction(function () use ($order, $v) {
            $o = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $p = Payment::where('order_id', $o->id)->lockForUpdate()->firstOrFail();
            $o->setRelation('payment', $p);
            $o->collection_hold = null;
            Products::assertPayable($o);
            abort_unless($p->status === 'pending' && Products::moneyHeld($o) === 0, 422, 'A payment arrived. Review it before changing collection methods.');
            abort_unless((int) $o->production_revision === (int) $v['expected_revision'], 409, 'This order changed. Refresh it before changing payment methods.');
            $online = $v['payment_method'] === 'online';
            if ($online) {
                abort_unless(app(PayMongoService::class)->acceptsNewPayments(), 422, 'Online payment is unavailable.');
            }
            $o->payment_method = $online ? 'GCash' : 'Cash at FMRC';
            $o->production_revision++;
            $o->save();
            $p->forceFill(['method' => $o->payment_method, 'gateway' => $online ? 'paymongo' : null, 'paymongo_checkout_id' => null, 'paymongo_payment_id' => null])->save();
        });

        return response()->json(['message' => 'Payment method changed.', 'data' => Products::orderData($order->fresh())]);
    }
}
