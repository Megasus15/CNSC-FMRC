<?php

namespace App\Services;

use App\Models\AdminNotification;
use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\Payment;
use App\Models\Promotion;
use App\Models\User;
use App\Support\Pwa;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PwaNotifications
{
    public function created(Model $model): void
    {
        $this->record($model, true);
    }

    public function updated(Model $model): void
    {
        if ($model instanceof User) {
            if ($model->wasChanged(['password', 'role', 'is_spectator', 'spectator_expires_at'])) {
                Pwa::revokeUser($model->id);
            }

            return;
        }
        $this->record($model, false);
    }

    public function deleting(Model $user): void
    {
        if ($user instanceof User) {
            Pwa::revokeUser($user->id);
        }
    }

    private function record(Model $model, bool $created): void
    {
        if (! Pwa::installed()) {
            return;
        }
        if ($model instanceof Announcement || $model instanceof Promotion) {
            if ($model->isLive()) {
                $type = $model instanceof Announcement ? 'announcement' : 'promotion';
                $this->publish(null, $type, $model->title, trim(strip_tags((string) ($model->message ?? 'A new update from FMRC.'))),
                    $type === 'promotion' ? '/products-page/product.html' : '/home-page/main.html?announcement='.$model->id, $type.':'.$model->id.':first-live');
            }

            return;
        }
        // Rows are written in the business transaction: rollback also removes alerts.
        if ($model instanceof AdminNotification) {
            if ($created) {
                $this->enqueue('team:'.$model->id, $model->type === 'account_request' ? 'admin' : 'team', null, [
                    'app' => 'team', 'kind' => $model->type === 'account_request' ? 'Account request' : 'Workspace update',
                    'id' => $model->id, 'url' => '/apps/team/?notification='.$model->id,
                ]);
            }

            return;
        }
        $kind = null;
        $owner = null;
        $message = '';
        $target = '/home-page/main.html';
        if ($model instanceof Order && ($created || $model->wasChanged(['lifecycle_status', 'customer_stage', 'cancel_state']))) {
            $owner = $model->customer_id;
            $kind = 'order';
            $message = $created ? 'Your order has been received.' : 'Your order status has been updated. Open My Orders to see the latest information.';
            $target .= '?orders=1&order_id='.$model->id;
        } elseif ($model instanceof Payment && (($created && in_array($model->status, ['paid', 'refunded'])) || $model->wasChanged(['status', 'submitted_at'])) && $model->order) {
            $owner = $model->order->customer_id;
            $kind = 'payment';
            $message = 'There is an update to your order payment. Open My Orders to review it.';
            $target .= '?orders=1&order_id='.$model->order_id;
        } elseif ($model instanceof OrderReturn && ($created || $model->wasChanged('status'))) {
            // The order owns the return; a submitted email or customer_id is never used to discover ownership.
            $owner = $model->order?->customer_id;
            $kind = 'return';
            $message = 'There is an update to your return request. Open My Orders to review it.';
            $target .= '?orders=1&order_id='.$model->order_id;
        } elseif ($model instanceof Appointment && ($created || $model->wasChanged('status'))) {
            $owner = $model->user_id;
            $kind = 'appointment';
            $message = $created ? 'Your appointment request has been received.' : 'Your appointment status has been updated.';
            $target .= '?appointment=1';
        }
        if ($kind && $owner && User::whereKey($owner)->where('role', 'customer')->exists()) {
            $this->publish($owner, $kind, ucfirst($kind).' update', $message, $target,
                $kind.':'.$model->id.':'.Str::uuid());
        }
    }

    public function publish(?int $owner, string $type, string $title, string $message, string $target, string $eventKey): int
    {
        return DB::transaction(function () use ($owner, $type, $title, $message, $target, $eventKey) {
            $inserted = DB::table('customer_notifications')->insertOrIgnore([
                'user_id' => $owner, 'type' => $type, 'title' => $title, 'message' => $message,
                'target' => $target, 'event_key' => $eventKey, 'published_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
            $id = DB::table('customer_notifications')->where('event_key', $eventKey)->value('id');
            if ($inserted) {
                $this->enqueue($eventKey, $owner ? 'account' : 'public', $owner, [
                    'app' => 'customer', 'kind' => ucfirst($type).' update', 'id' => $id,
                    'url' => '/apps/customer/?notification='.$id,
                ]);
            }

            return (int) $id;
        });
    }

    public function publishLiveCampaigns(): void
    {
        foreach ([Announcement::class => 'announcement', Promotion::class => 'promotion'] as $class => $type) {
            $class::query()->where('is_enabled', true)->where('is_archived', false)->chunkById(100, function ($records) use ($type) {
                foreach ($records as $record) {
                    if ($record->isLive()) {
                        $this->publish(null, $type, $record->title, trim(strip_tags((string) ($record->message ?? 'A new update from FMRC.'))),
                            $type === 'promotion' ? '/products-page/product.html' : '/home-page/main.html?announcement='.$record->id, $type.':'.$record->id.':first-live');
                    }
                }
            });
        }
    }

    private function enqueue(string $key, string $audience, ?int $owner, array $payload): void
    {
        // Setup does not create a backlog of phone alerts. Inbox records still persist.
        if (! Pwa::ready()) {
            return;
        }
        $query = DB::table('pwa_subscriptions');
        if ($audience === 'public') {
            $query->where('app', 'customer')->where('public_alerts', true);
        } elseif ($audience === 'account') {
            $query->where('app', 'customer')->where('account_alerts', true)->where('user_id', $owner);
        } else {
            $query->where('app', 'team')->where('account_alerts', true)->whereIn('role', $audience === 'admin' ? ['admin'] : ['admin', 'staff']);
        }
        $queued = false;
        $query->orderBy('id')->chunkById(100, function ($devices) use ($key, $audience, $owner, $payload, &$queued) {
            foreach ($devices as $device) {
                $inserted = DB::table('pwa_delivery_outbox')->insertOrIgnore([
                    'subscription_id' => $device->id, 'event_key' => $key, 'audience' => $audience,
                    'audience_user_id' => $owner ?? $device->user_id, 'payload' => json_encode($payload + ['public' => $audience === 'public', 'binding' => $audience === 'public' ? null : $device->user_id]),
                    'available_at' => now(), 'created_at' => now(), 'updated_at' => now(),
                ]);
                $queued = $queued || (bool) $inserted;
            }
        });
        if ($queued) {
            $request = app('request');
            DB::afterCommit(static function () use ($request, $key): void {
                $events = $request->attributes->get(PwaOutboxProcessor::REQUEST_EVENTS, []);
                $events[$key] = true;
                $request->attributes->set(PwaOutboxProcessor::REQUEST_EVENTS, $events);
            });
        }
    }
}
