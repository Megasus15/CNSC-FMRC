<?php

namespace App\Services;

use App\Models\{CustomProductRequest, CustomProductQuote, Order, OrderItem, OrderTrackingEvent, Payment, Service};
use App\Support\{OrderNotifier, PaymentMethodAvailability, Pwa};
use Illuminate\Support\Facades\{DB, Storage, Validator};
use Illuminate\Support\Str;

/** The request owns the conversation; an immutable quote owns each payable order. */
final class CustomProducts
{
    public const LABELS = ['draft'=>'Draft', 'submitted'=>'Submitted', 'under_review'=>'Under Review', 'needs_information'=>'Needs Information',
        'quoted'=>'Quotation Ready', 'ordered'=>'Ordered', 'declined'=>'Declined', 'cancelled'=>'Cancelled', 'expired'=>'Quotation Expired', 'payment_review'=>'Payment Review'];

    public static function specs(array $data, bool $complete = false): array
    {
        $rules = [];
        foreach (['title'=>180, 'description'=>3000, 'intended_use'=>1000, 'size'=>500, 'material'=>500, 'colors'=>500, 'finish'=>500,
            'personalization'=>1500, 'notes'=>2000, 'contact_name'=>160, 'contact_phone'=>40, 'delivery_recipient_name'=>160,
            'delivery_contact_no'=>40, 'delivery_street'=>255, 'delivery_barangay'=>120, 'delivery_city'=>120,
            'delivery_province'=>120, 'delivery_postal_code'=>4, 'delivery_landmark'=>255] as $field=>$max) $rules[$field] = "nullable|string|max:$max";
        $rules += ['quantity'=>'nullable|integer|min:1|max:999', 'budget'=>'nullable|numeric|min:0|max:100000',
            'preferred_date'=>'nullable|date_format:Y-m-d', 'fulfillment_type'=>'nullable|in:pickup,delivery',
            'advice_fields'=>'sometimes|array|max:5', 'advice_fields.*'=>'in:size,material,colors,finish,design'];
        if ($complete) {
            foreach (['title', 'description', 'contact_name', 'contact_phone'] as $field) $rules[$field] = str_replace('nullable', 'required', $rules[$field]);
            $rules['quantity'] = 'required|integer|min:1|max:999';
            $rules['fulfillment_type'] = 'required|in:pickup,delivery';
            foreach (['delivery_recipient_name', 'delivery_contact_no', 'delivery_street', 'delivery_barangay', 'delivery_city', 'delivery_province', 'delivery_postal_code'] as $field) {
                $rules[$field] = 'required_if:fulfillment_type,delivery|'.$rules[$field];
            }
            $rules['delivery_postal_code'] .= '|regex:/^\d{4}$/';
        }
        return Validator::make($data, $rules)->validate();
    }

    public static function activeOrder(CustomProductRequest $request): ?Order
    {
        return Order::whereIn('custom_product_quote_id', $request->quotes()->select('id'))
            ->whereNotIn('lifecycle_status', ['cancelled', 'rejected'])->latest('id')->first();
    }

    public static function archiveError(CustomProductRequest $request): ?string
    {
        if (!\App\Support\CustomProductSchema::archivingReady()) return 'Custom request archiving needs the latest database update.';
        if ($request->is_archived) return 'This request is already archived.';
        if (!in_array($request->status, ['cancelled', 'declined', 'ordered'], true)) return 'Close the request or complete its order before archiving.';
        $orders = Order::with('payment')->whereIn('custom_product_quote_id', $request->quotes()->select('id'))->get();
        if ($request->status === 'ordered' && $orders->isEmpty()) return 'Review the linked order before archiving.';
        foreach ($orders as $order) {
            if (!in_array($order->lifecycle_status, ['completed', 'cancelled', 'rejected'], true) || $order->cancel_state === 'requested') return 'Resolve the linked order before archiving.';
            $payment = $order->payment;
            if ($order->lifecycle_status !== 'completed' && $payment?->status === 'paid') return 'Resolve the paid order and refund before archiving.';
            if (DB::table('payment_attempts')->where('payment_id', $payment?->id)->whereNotIn('status', ['paid', 'expired', 'failed'])->exists()) return 'Wait for checkout reconciliation before archiving.';
            if (DB::table('payment_refunds')->where('payment_id', $payment?->id)->whereNotIn('status', ['succeeded', 'rejected'])->exists()) return 'Resolve the pending refund before archiving.';
        }
        return null;
    }

    public static function mutate(CustomProductRequest $request, int $actor, string $role, string $action, array $data, array $files): CustomProductRequest
    {
        Validator::make($data, ['expected_revision'=>'required|integer|min:0', 'request_key'=>'required|uuid'])->validate();
        $hashData = $data; unset($hashData['request_key']);
        $hash = hash('sha256', json_encode($hashData).implode('', array_map(fn ($file)=>hash_file('sha256', $file->getRealPath()), $files)));
        $paths = [];
        try {
            return DB::transaction(function () use ($request, $actor, $role, $action, $data, $files, $hash, &$paths) {
                $r = CustomProductRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
                $old = DB::table('custom_product_events')->where('custom_product_request_id', $r->id)->where('request_key', $data['request_key'])->first();
                if ($old) {
                    abort_unless($old->actor_id === $actor && $old->action === $action && hash_equals($old->payload_hash, $hash), 409, 'This action key was already used. Refresh and try again.');
                    return $r;
                }
                // A retried acceptance, even from another tab, returns its one existing order.
                if ($action === 'accept' && $role === 'customer') {
                    $accepted = $r->quotes()->whereKey($data['quote_id'] ?? 0)->where('status', 'accepted')->first();
                    if ($accepted?->order && !in_array($accepted->order->lifecycle_status, ['cancelled','rejected'], true)) return $r;
                }
                abort_unless($r->revision === (int) $data['expected_revision'], 409, 'This request changed elsewhere. Review the latest version before saving. Your edits have been kept.');
                $customer = $role === 'customer';
                abort_if(!$customer && $r->is_archived, 409, 'Restore this request from Archives before updating it.');
                $active = self::activeOrder($r);
                $messageId = null;
                $description = '';
                switch ($action) {
                    case 'save': case 'submit':
                        abort_unless($customer && in_array($r->status, ['draft', 'submitted', 'needs_information'], true) && !$active, 422, 'Request a revision before changing these specifications.');
                        $spec = self::specs($data['specifications'] ?? [], $action === 'submit');
                        $service = Service::find($data['service_id'] ?? 0);
                        abort_unless($service && ($service->accepts_custom_requests || ($r->submitted_at && $r->service_id === $service->id)), 422, 'Select a service that accepts custom product requests.');
                        $r->specifications = $spec;
                        $r->service_id = $service->id;
                        $r->service_snapshot = ['id'=>$service->id, 'title'=>$service->title, 'category'=>$service->category];
                        if ($action === 'submit') { $r->status = 'submitted'; $r->submitted_at ??= now(); }
                        $remove = Validator::make($data, ['remove_attachment_ids'=>'sometimes|array|max:5', 'remove_attachment_ids.*'=>'integer|distinct'])->validate()['remove_attachment_ids'] ?? [];
                        if ($remove) {
                            $attachments = DB::table('custom_product_attachments')->where('custom_product_request_id', $r->id)->whereNull('message_id')->where('author_id',$actor)->whereIn('id',$remove)->get();
                            abort_unless($attachments->count() === count($remove),422,'Only your request attachments can be removed.');
                            foreach ($r->quotes()->get() as $quote) abort_if(array_intersect($remove,$quote->snapshot['proof_ids'] ?? []),422,'Keep files referenced by quotation history. Send a revised design in the conversation.');
                            DB::table('custom_product_attachments')->whereIn('id',$remove)->delete();
                            DB::afterCommit(fn()=>Storage::disk('local')->delete($attachments->pluck('path')->all()));
                        }
                        $description = $action === 'submit' ? 'Request submitted for FMRC review.' : 'Request draft saved.';
                        break;
                    case 'message':
                        abort_if($r->status === 'draft', 422, 'Submit the request before starting a conversation.');
                        $input = Validator::make($data, ['body'=>'required|string|max:3000'])->validate();
                        $messageId = DB::table('custom_product_messages')->insertGetId(['custom_product_request_id'=>$r->id, 'author_id'=>$actor,
                            'body'=>trim($input['body']), 'created_at'=>now(), 'updated_at'=>now()]);
                        $description = $customer ? 'Customer sent a message.' : 'FMRC sent a message.';
                        break;
                    case 'review': case 'clarify': case 'decline':
                        abort_unless(!$customer && in_array($r->status, ['submitted', 'under_review', 'needs_information', 'expired'], true) && !$active, 422, 'This request cannot be reviewed in its current state.');
                        $note = Validator::make($data, ['note'=>($action === 'review' ? 'nullable' : 'required').'|string|max:1000'])->validate()['note'] ?? '';
                        $r->status = ['review'=>'under_review', 'clarify'=>'needs_information', 'decline'=>'declined'][$action];
                        $description = trim(self::LABELS[$r->status].'. '.$note);
                        break;
                    case 'save_quote': case 'send_quote':
                        abort_unless(!$customer && in_array($r->status, ['submitted', 'under_review', 'needs_information', 'expired'], true) && !$active, 422, 'Withdraw the current quotation before preparing a revision.');
                        self::assertOldCheckoutsClosed($r);
                        $send = $action === 'send_quote';
                        $input = Validator::make($data, ['specifications'=>'required|array', 'unit_price'=>($send?'required|numeric|min:0.01':'nullable|numeric|min:0').'|max:100000',
                            'shipping_fee'=>'nullable|numeric|min:0|max:100000', 'production_days'=>($send?'required':'nullable').'|integer|min:1|max:365',
                            'transit_min_days'=>'nullable|integer|min:1|max:90', 'transit_max_days'=>'nullable|integer|min:1|max:90|gte:transit_min_days',
                            'proof_ids'=>'sometimes|array|max:5', 'proof_ids.*'=>'integer|distinct', 'specifications_confirmed'=>$send?'required|accepted':'nullable|boolean',
                            'delivery_confirmed'=>'nullable|boolean', 'quote_note'=>'nullable|string|max:2000'])->validate();
                        $spec = self::specs($input['specifications'], $send);
                        if ($send) {
                            foreach (['size', 'material', 'colors', 'finish'] as $field) abort_if(blank($spec[$field] ?? ''), 422, 'Confirm size, material, colors and finish, using “Not applicable” where appropriate.');
                            abort_if(!empty($spec['advice_fields']), 422, 'Resolve the requested design advice before quoting.');
                        }
                        $proofs = $input['proof_ids'] ?? [];
                        abort_unless(DB::table('custom_product_attachments')->where('custom_product_request_id', $r->id)->whereIn('id', $proofs)->count() === count($proofs), 422, 'Choose design proofs from this request.');
                        $shipping = ($spec['fulfillment_type'] ?? 'pickup') === 'pickup' ? 0 : GatewayPayments::centavos($input['shipping_fee'] ?? 0);
                        if ($send && $spec['fulfillment_type'] === 'delivery') abort_unless(!empty($input['delivery_confirmed']) && !empty($input['transit_min_days']) && !empty($input['transit_max_days']) && isset($input['shipping_fee']), 422, 'Confirm delivery eligibility, the shipping fee and transit estimates.');
                        $unit = GatewayPayments::centavos($input['unit_price'] ?? 0); $subtotal = $unit * ($spec['quantity'] ?? 0);
                        abort_if($send && ($subtotal + $shipping < 100 || $subtotal + $shipping > 10000000), 422, 'The total must be between ₱1 and ₱100,000 for online payment.');
                        $quote = $r->quotes()->where('status', 'draft')->first() ?? new CustomProductQuote(['custom_product_request_id'=>$r->id, 'version'=>1 + (int) $r->quotes()->max('version')]);
                        $quote->fill(['author_id'=>$actor, 'snapshot'=>['specifications'=>$spec, 'service'=>$r->service_snapshot, 'proof_ids'=>$proofs,
                            'production_days'=>$input['production_days'] ?? null, 'transit_min_days'=>$input['transit_min_days'] ?? null, 'transit_max_days'=>$input['transit_max_days'] ?? null,
                            'quote_note'=>$input['quote_note'] ?? '', 'delivery_confirmed'=>!empty($input['delivery_confirmed'])],
                            'unit_price_centavos'=>$unit, 'subtotal_centavos'=>$subtotal, 'shipping_centavos'=>$shipping, 'total_centavos'=>$subtotal + $shipping]);
                        if ($action === 'send_quote') { $quote->status = 'sent'; $quote->sent_at = now(); $quote->expires_at = now()->addDays(7); $r->status = 'quoted'; }
                        $quote->save();
                        $description = $action === 'send_quote' ? 'Quotation '.$quote->version.' is ready for review and payment within seven days.' : 'Quotation draft saved.';
                        break;
                    case 'archive':
                        abort_if($customer, 403);
                        abort_unless(\App\Support\CustomProductSchema::archivingReady(), 503, 'Custom request archiving needs the latest database update.');
                        $archiveError = self::archiveError($r);
                        abort_if($archiveError !== null, 422, $archiveError ?? 'This request cannot be archived yet.');
                        $r->fill(['is_archived' => true, 'archived_at' => now(), 'archived_by' => $actor]);
                        $description = 'Request archived.';
                        break;
                    case 'revision': case 'withdraw': case 'cancel':
                        abort_unless($action !== 'withdraw' || !$customer, 403);
                        abort_unless($action !== 'revision' || $customer, 403);
                        abort_if($active, 422, 'Cancel the linked order through My Orders before requesting changes. Paid cancellations require review.');
                        abort_if(in_array($r->status, ['cancelled', 'declined'], true), 422, 'This request is already closed.');
                        self::assertOldCheckoutsClosed($r);
                        $note = Validator::make($data, ['note'=>'required|string|max:1000'])->validate()['note'];
                        $r->quotes()->whereIn('status', ['sent', 'draft', 'accepted'])->update(['status'=>'withdrawn', 'updated_at'=>now()]);
                        $r->status = $action === 'cancel' ? 'cancelled' : ($customer ? 'needs_information' : 'under_review');
                        $description = ($action === 'cancel' ? 'Request cancelled. ' : 'Quotation revision requested. ').$note;
                        break;
                    case 'accept':
                        abort_unless($customer, 403);
                        $q = $r->quotes()->whereKey($data['quote_id'] ?? 0)->lockForUpdate()->firstOrFail();
                        if ($q->order) { abort_unless($q->status === 'accepted', 409, 'This quotation is no longer payable.'); break; }
                        abort_unless($r->status === 'quoted' && $q->status === 'sent' && $q->expires_at?->isFuture() && !$active, 409, 'This quotation changed or expired. Ask FMRC for an updated quotation.');
                        abort_unless(PaymentMethodAvailability::isEnabled('GCash') && app(PayMongoService::class)->acceptsNewPayments(), 422, 'Online payment is temporarily unavailable. Your quotation has been kept.');
                        Validator::make($data, ['design_accepted'=>'required|accepted'])->validate();
                        $policy = CommercePolicy::accept($data);
                        self::makeOrder($r, $q, $policy);
                        $q->update(['status'=>'accepted', 'accepted_at'=>now()]); $r->status = 'ordered';
                        $description = 'Quotation '.$q->version.' accepted. Full payment is required before production.';
                        break;
                    default: abort(404);
                }
                if ($files) {
                    abort_unless(in_array($action, ['save', 'submit', 'message'], true), 422, 'Send design proofs through the conversation before selecting them in a quotation.');
                    if ($action !== 'message') {
                        $existing = DB::table('custom_product_attachments')->where('custom_product_request_id', $r->id)->whereNull('message_id');
                        abort_if((clone $existing)->count() + count($files) > 5 || (clone $existing)->sum('size') + array_sum(array_map(fn ($f)=>$f->getSize(), $files)) > 50*1024*1024, 422, 'The request supports up to five files totaling 50 MB. Send further designs through the conversation.');
                    }
                    CustomProductFiles::store($files, $r->id, $actor, $messageId, $paths);
                }
                $r->revision++; $r->save();
                DB::table('custom_product_events')->insert(['custom_product_request_id'=>$r->id, 'actor_id'=>$actor, 'request_key'=>$data['request_key'],
                    'action'=>$action, 'payload_hash'=>$hash, 'description'=>$description ?: 'Quotation accepted.', 'created_at'=>now(), 'updated_at'=>now()]);
                if (!in_array($action, ['save', 'save_quote', 'archive'], true)) self::notify($r, $description, $customer);
                return $r;
            });
        } catch (\Throwable $error) {
            foreach ($paths as $path) Storage::disk('local')->delete($path);
            throw $error;
        }
    }

    private static function makeOrder(CustomProductRequest $r, CustomProductQuote $q, array $policy): Order
    {
        $s = $q->snapshot['specifications']; $pickup = $s['fulfillment_type'] === 'pickup';
        $customer = $r->customer;
        $attributes = ['custom_product_quote_id'=>$q->id, 'production_status'=>'not_started', 'customer_id'=>$r->customer_id,
            'customer_name'=>$s['contact_name'], 'customer_contact'=>$customer->email, 'quantity'=>$s['quantity'],
            'subtotal'=>$q->subtotal_centavos/100, 'total'=>$q->total_centavos/100, 'shipping_fee'=>$q->shipping_centavos/100,
            'shipping_quote'=>['available'=>true, 'source'=>'custom_quotation', 'quote_id'=>$q->id, 'item_subtotal'=>$q->subtotal_centavos/100,
                'shipping_fee'=>$q->shipping_centavos/100, 'payable_total'=>$q->total_centavos/100, 'fulfillment_type'=>$s['fulfillment_type'],
                'production_days'=>$q->snapshot['production_days'], 'transit_min_days'=>$q->snapshot['transit_min_days'], 'transit_max_days'=>$q->snapshot['transit_max_days']],
            'accepted_policy_version'=>$policy['version'], 'accepted_policy_text'=>array_intersect_key($policy, array_flip(['version','title','terms_text','refund_text','published_at'])), 'policy_accepted_at'=>now(),
            'payment_method'=>'GCash', 'payment_reference'=>'Awaiting secure online payment', 'payment_due_at'=>$q->expires_at,
            'fulfillment_type'=>$s['fulfillment_type'], 'lifecycle_status'=>'incoming', 'customer_stage'=>'to_pay',
            'courier_name'=>$pickup ? null : 'J&T Express', 'shipment_tracking_mode'=>$pickup ? null : 'jnt_dropoff',
            'pickup_code'=>$pickup ? strtoupper(Str::random(8)) : null,
            'location_name'=>$pickup ? 'FMRC Office, University of Camarines Norte, Daet' : implode(', ', array_filter(array_intersect_key($s, array_flip(['delivery_street','delivery_barangay','delivery_city','delivery_province','delivery_postal_code'])))),
            'notes'=>'Custom product '.$r->reference().', quotation '.$q->version.'.'];
        foreach (['delivery_recipient_name','delivery_contact_no','delivery_street','delivery_barangay','delivery_city','delivery_province','delivery_postal_code','delivery_landmark'] as $key) $attributes[$key] = $pickup ? null : ($s[$key] ?? null);
        $order = Order::create($attributes);
        if ((int) $order->custom_product_quote_id !== (int) $q->id) {
            throw new \RuntimeException('Custom order schema changed during creation.');
        }
        $order->update(['order_no'=>'ORD-'.now('Asia/Manila')->format('Ymd').'-'.str_pad((string)$order->id, 6, '0', STR_PAD_LEFT)]);
        OrderItem::create(['order_id'=>$order->id, 'product_id'=>null, 'product_name'=>$s['title'], 'unit_price'=>$q->unit_price_centavos/100,
            'quantity'=>$s['quantity'], 'line_total'=>$q->subtotal_centavos/100]);
        Payment::create(['order_id'=>$order->id, 'payment_no'=>'PAY-CUS-'.$order->id, 'method'=>'GCash', 'gateway'=>'paymongo',
            'reference'=>'Awaiting secure online payment', 'amount'=>$q->total_centavos/100, 'status'=>'pending']);
        OrderTrackingEvent::create(['order_id'=>$order->id, 'stage'=>'to_pay', 'event_type'=>'system', 'title'=>'Custom quotation accepted',
            'description'=>'Your specifications and quotation are recorded. Complete payment before the quotation expires.', 'occurred_at'=>now()]);
        return $order;
    }

    public static function payable(Order $order): bool
    {
        if (!$order->custom_product_quote_id) return true;
        if (!\App\Support\CustomProductSchema::ready()) return false;
        $q = $order->customQuote;
        return $q && $q->status === 'accepted' && $q->expires_at?->isFuture() && $q->request->status === 'ordered'
            && !in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true);
    }

    public static function productionError(Order $order, bool $ready = false): ?string
    {
        if (!$order->custom_product_quote_id) return null;
        if (!\App\Support\CustomProductSchema::ready()) return \App\Support\CustomProductSchema::MESSAGE;
        $q = $order->customQuote; $payment = $order->payment;
        if (!$q || $q->status !== 'accepted' || $q->request->status !== 'ordered') return 'Review the current accepted custom quotation before production.';
        if (!$payment || $payment->status !== 'paid' || !GatewayPayments::managed($payment)) return 'Full online payment must be confirmed before production.';
        $receipt = DB::table('payment_receipts')->where('payment_id', $payment->id)->where('provider_payment_id', $payment->paymongo_payment_id)->whereNotNull('confirmed_at')->first();
        if (!$receipt || (int)$receipt->amount_centavos !== (int)$q->total_centavos || (app()->environment('production') && !$receipt->livemode)) return 'A verified payment for the complete quotation is required.';
        if ($order->hasPendingCancellation() || in_array($order->lifecycle_status, ['cancelled','rejected'], true)
            || DB::table('payment_refunds')->where('payment_id', $payment->id)->whereNotIn('status', ['failed','rejected'])->exists()) return 'Resolve the cancellation or refund before production or fulfillment.';
        if ($ready && $order->production_status !== 'ready') return 'Mark custom production ready before pickup, shipment or completion.';
        return null;
    }

    public static function production(Order $order, string $action, int $actor, ?int $revision = null, ?string $key = null): Order
    {
        abort_unless(\App\Support\CustomProductSchema::ready(), 503, \App\Support\CustomProductSchema::MESSAGE);
        return DB::transaction(function () use ($order, $action, $actor, $revision, $key) {
            $o = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            abort_unless($o->custom_product_quote_id, 422, 'This action applies to custom orders.');
            $r = CustomProductRequest::whereKey($o->customQuote->custom_product_request_id)->lockForUpdate()->firstOrFail();
            $hash = hash('sha256', json_encode([$o->id, $action, $revision]));
            if ($key) {
                $event = DB::table('custom_product_events')->where('custom_product_request_id', $r->id)->where('request_key', $key)->first();
                if ($event) {
                    abort_unless((int)$event->actor_id === $actor && $event->action === 'production' && hash_equals($event->payload_hash, $hash), 409, 'This action key was already used. Refresh the request.');
                    return $o;
                }
            }
            abort_if($revision !== null && $r->revision !== $revision, 409, 'This request changed elsewhere. Refresh before updating production.');
            if ($error = self::productionError($o)) abort(422, $error);
            if ($action === 'start') {
                if (in_array($o->production_status, ['in_production','ready'], true)) return $o;
                abort_unless($o->lifecycle_status === 'incoming', 409, 'Refresh the current production status.');
                $o->fill(['production_status'=>'in_production', 'production_started_at'=>now(), 'approved_at'=>now(), 'lifecycle_status'=>'pending', 'customer_stage'=>'to_ship']);
                $title = 'Custom product in production';
            } else {
                if ($o->production_status === 'ready') return $o;
                abort_unless($o->production_status === 'in_production' && $o->lifecycle_status === 'pending', 422, 'Start production before marking it ready.');
                $o->fill(['production_status'=>'ready', 'production_ready_at'=>now()]);
                if ($o->isPickup()) $o->fill(['customer_stage'=>'to_receive', 'pickup_ready_at'=>now()]);
                $title = $o->isPickup() ? 'Custom product ready for pickup' : 'Custom product ready for J&T handover';
            }
            $o->save();
            OrderTrackingEvent::create(['order_id'=>$o->id, 'created_by_user_id'=>$actor, 'stage'=>$o->customer_stage, 'event_type'=>'admin_update', 'title'=>$title, 'occurred_at'=>now()]);
            $r->increment('revision');
            DB::table('custom_product_events')->insert(['custom_product_request_id'=>$r->id, 'actor_id'=>$actor, 'request_key'=>$key ?: (string)Str::uuid(), 'action'=>'production', 'payload_hash'=>$hash, 'description'=>$title, 'created_at'=>now(), 'updated_at'=>now()]);
            self::notify($r, $title, false);
            return $o;
        });
    }

    public static function complete(Order $order, int $actor, bool $customer): Order
    {
        return DB::transaction(function () use ($order, $actor, $customer) {
            $o = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($o->lifecycle_status === 'completed') return $o;
            if ($error = self::productionError($o, true)) abort(422, $error);
            abort_unless($o->lifecycle_status === 'pending' && $o->customer_stage === 'to_receive', 422, 'This custom order is not ready for receipt confirmation.');
            abort_unless($o->isPickup() || $customer, 422, 'The customer confirms delivery through My Orders.');
            $o->fill(['lifecycle_status'=>'completed', 'customer_stage'=>'completed', 'completed_at'=>now()]);
            if ($o->isPickup()) $o->picked_up_at ??= now();
            $o->save();
            $title = $o->isPickup() ? 'Custom product collected' : 'Custom product received';
            OrderTrackingEvent::create(['order_id'=>$o->id, 'created_by_user_id'=>$actor, 'stage'=>'completed', 'event_type'=>'system', 'title'=>$title, 'occurred_at'=>now()]);
            $r = $o->customQuote->request; $r->increment('revision'); self::notify($r, $title, $customer);
            return $o;
        });
    }

    public static function statusLabel(Order $order): string
    {
        if (in_array($order->lifecycle_status, ['cancelled','rejected','completed'], true)) return ucfirst($order->lifecycle_status);
        if ($order->customer_stage === 'to_receive') return $order->isPickup() ? 'Ready for Pickup' : 'In Transit';
        if ($order->production_status === 'ready') return 'Ready for Shipping';
        if ($order->production_status === 'in_production') return 'In Production';
        return $order->payment?->status === 'paid' ? 'Paid—Awaiting Production' : 'Awaiting Payment';
    }

    public static function orderFields(Order $order): array
    {
        if (!$order->custom_product_quote_id) return ['order_type'=>'regular'];
        $q = \App\Support\CustomProductSchema::hasQuoteDetails() ? $order->customQuote : null;
        return ['order_type'=>'custom', 'custom_request_id'=>$q?->custom_product_request_id, 'custom_request_reference'=>$q?->request?->reference(),
            'custom_quote_version'=>$q?->version, 'production_status'=>$order->production_status, 'custom_status_label'=>self::statusLabel($order),
            'can_rate'=>false, 'custom_actions'=>['start'=> $order->lifecycle_status === 'incoming' && !self::productionError($order),
                'ready'=>$order->production_status === 'in_production' && !self::productionError($order)],
            'custom_specifications'=>$q?->snapshot['specifications'] ?? []];
    }

    public static function present(CustomProductRequest $r, bool $operator): array
    {
        $quotes = $r->quotes()->when(!$operator, fn ($q)=>$q->where('status', '!=', 'draft'))->orderByDesc('version')->get();
        $orders = Order::with('payment', 'customQuote.request')->whereIn('custom_product_quote_id', $r->quotes()->select('id'))->orderByDesc('id')->get();
        $active = $orders->first(fn ($o)=>!in_array($o->lifecycle_status, ['cancelled','rejected'], true));
        $status = $r->status;
        $current = $quotes->first(fn ($q)=>in_array($q->status, ['sent','accepted'], true));
        if ($status !== 'payment_review' && $current && $current->expires_at?->isPast() && (!$active || $active->payment?->status !== 'paid')) $status = 'expired';
        $editable = !$active && in_array($r->status, ['draft','submitted','needs_information'], true);
        return ['id'=>$r->id, 'reference'=>$r->reference(), 'revision'=>$r->revision, 'status'=>$status, 'is_archived'=>(bool)$r->is_archived,
            'status_label'=>$active && !in_array($status,['expired','payment_review'],true) ? self::statusLabel($active) : (self::LABELS[$status] ?? $status),
            'service_id'=>$r->service_id, 'service'=>$r->service_snapshot, 'specifications'=>$r->specifications,
            'customer_name'=>$r->customer?->name, 'updated_at'=>$r->updated_at?->toIso8601String(),
            'quotes'=>$quotes->map(fn ($q)=>['id'=>$q->id, 'version'=>$q->version, 'status'=>$q->status, 'snapshot'=>$q->snapshot,
                'unit_price'=>$q->unit_price_centavos/100, 'subtotal'=>$q->subtotal_centavos/100, 'shipping_fee'=>$q->shipping_centavos/100,
                'total'=>$q->total_centavos/100, 'expires_at'=>$q->expires_at?->toIso8601String(), 'sent_at'=>$q->sent_at?->toIso8601String(),
                'can_accept'=>!$operator && !$active && $r->status === 'quoted' && $q->status === 'sent' && $q->expires_at?->isFuture()])->values(),
            'attachments'=>DB::table('custom_product_attachments')->where('custom_product_request_id', $r->id)->orderBy('id')->get(['id','message_id','name','mime','size','author_id']),
            'messages'=>DB::table('custom_product_messages as m')->join('users as u','u.id','=','m.author_id')->where('m.custom_product_request_id',$r->id)->orderBy('m.id')->get(['m.id','m.body','m.created_at','u.name as author','u.role']),
            'events'=>DB::table('custom_product_events')->where('custom_product_request_id',$r->id)->when(!$operator,fn ($q)=>$q->whereNotIn('action',['save_quote','archive']))->orderByDesc('id')->limit(100)->get(['id','description','created_at']),
            'orders'=>$orders->map(fn ($o)=>['id'=>$o->id,'order_no'=>$o->order_no,'quote_id'=>$o->custom_product_quote_id,'payment_status'=>$o->payment?->status,
                'total'=>(float)$o->total,'status_label'=>self::statusLabel($o), 'lifecycle_status'=>$o->lifecycle_status,
                'can_pay'=>$o->payment?->status === 'pending' && self::payable($o), 'cancellation'=>$o->cancellationAvailability(),
                'tracking'=>ShipmentTracking::present($o,$operator,true)] + self::orderFields($o))->values(),
            'actions'=>['edit'=>$editable, 'submit'=>$editable, 'message'=>$r->status !== 'draft' && (!$operator || !$r->is_archived),
                'review'=>$operator && !$active && in_array($r->status,['submitted','needs_information','under_review','expired'],true),
                'quote'=>$operator && !$active && in_array($r->status,['submitted','under_review','needs_information','expired'],true),
                'revision'=>!$active && in_array($r->status,['quoted','ordered','expired','under_review','submitted'],true),
                'cancel'=>!$active && !in_array($r->status,['cancelled','declined'],true)]];
    }

    public static function notify(CustomProductRequest $r, string $message, bool $fromCustomer): void
    {
        DB::afterCommit(function () use ($r, $message, $fromCustomer) {
            if ($fromCustomer) OrderNotifier::notifyAdmins('custom_request', $r->reference().' — Custom product update', $message, ['custom_request_id'=>$r->id, 'custom_request_reference'=>$r->reference()]);
            elseif (Pwa::installed()) app(PwaNotifications::class)->publish($r->customer_id, 'custom_request', $r->reference().' — Custom product update', $message,
                '/products-page/product.html?custom_requests=1&request='.$r->id, 'custom:'.$r->id.':'.$r->revision.':'.hash('sha256',$message));
        });
    }

    public static function assertOldCheckoutsClosed(CustomProductRequest $r): void
    {
        $orders = Order::whereIn('custom_product_quote_id', $r->quotes()->select('id'))->with('payment')->get();
        foreach ($orders as $o) {
            if (!in_array($o->lifecycle_status,['cancelled','rejected'],true)) abort(409,'Resolve the current order before preparing a new quotation.');
            $attempts = DB::table('payment_attempts')->where('payment_id',$o->payment?->id)->get();
            foreach ($attempts as $a) {
                if (!in_array($a->status,['expired','failed','paid'],true)) abort(409,'A previous checkout is still being reconciled. Try again after its payment status is confirmed.');
            }
            if ($o->payment?->status === 'paid') abort(409,'Resolve the paid order and its refund before issuing a replacement quotation.');
        }
    }
}
