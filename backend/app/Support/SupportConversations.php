<?php

namespace App\Support;

use App\Models\AdminNotification;
use App\Models\CustomerMessage;
use App\Models\User;
use App\Services\PwaNotifications;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SupportConversations
{
    public static function create(User $actor, array $data): CustomerMessage
    {
        return DB::transaction(function () use ($actor, $data) {
            // Serialize retries for the same account, including first messages.
            User::whereKey($actor->id)->lockForUpdate()->firstOrFail();
            $key = $data['request_key'] ?? null;
            if ($key && $existing = CustomerMessage::where('user_id', $actor->id)->where('request_key', $key)->first()) {
                return $existing;
            }
            $root = CustomerMessage::create([
                'user_id' => $actor->id, 'sender_name' => trim($data['name']),
                'sender_email' => strtolower(trim($data['email'])), 'message' => trim($data['message']),
                'source' => $data['source'] ?? 'contact', 'request_key' => $key,
                'status' => 'new', 'is_read' => false, 'last_entry_at' => now(),
            ]);
            $id = self::insert($root, $actor, trim($data['message']), $key, $root->sender_name);
            $root->update(['customer_last_read_entry_id' => $id]);
            self::notify($root, $actor, $id, true);
            return $root->fresh();
        });
    }

    public static function send(CustomerMessage $root, User $actor, string $body, string $key): array
    {
        return DB::transaction(function () use ($root, $actor, $body, $key) {
            $root = CustomerMessage::whereKey($root->id)->lockForUpdate()->firstOrFail();
            $existing = DB::table('customer_message_entries')->where('customer_message_id', $root->id)
                ->where('sender_id', $actor->id)->where('request_key', $key)->first();
            if ($existing) return ['entry' => self::entry($existing), 'conversation' => self::present($root)];
            abort_if($root->status === 'resolved', 409, 'This chat has ended. Reopen it before sending another message.');
            abort_if($root->customer_hidden_at, 409, 'The customer removed this chat from their history. Please use a new inquiry.');
            $id = self::insert($root, $actor, $body, $key);
            $root->fill(['last_entry_at' => now(), 'status' => 'new', 'resolved_at' => null, 'resolved_by_user_id' => null]);
            if ($actor->role === 'customer') $root->fill(['is_read' => false, 'read_at' => null]);
            $root->save();
            self::notify($root, $actor, $id);
            return ['entry' => self::entry(DB::table('customer_message_entries')->find($id)), 'conversation' => self::present($root)];
        });
    }

    private static function insert(CustomerMessage $root, User $actor, string $body, ?string $key, ?string $name = null): int
    {
        return DB::table('customer_message_entries')->insertGetId([
            'customer_message_id' => $root->id, 'sender_id' => $actor->id, 'sender_role' => $actor->role,
            'sender_name' => mb_substr($name ?: ($actor->name ?: ($actor->role === 'customer' ? 'Customer' : 'FMRC team')), 0, 190),
            'body' => $body, 'request_key' => $key, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public static function present(CustomerMessage $root): array
    {
        $query = DB::table('customer_message_entries')->where('customer_message_id', $root->id);
        $latest = (clone $query)->orderByDesc('id')->first();
        return [
            'id' => $root->id, 'sender_name' => $root->sender_name, 'sender_email' => $root->sender_email,
            'message' => $root->message, 'source' => $root->source, 'status' => $root->status,
            'created_at' => $root->created_at?->toISOString(), 'resolved_at' => $root->resolved_at?->toISOString(),
            'last_entry_at' => $root->last_entry_at?->toISOString(), 'last_entry_id' => $latest?->id ?? 0,
            'last_message' => $latest?->body ?? $root->message,
            'waiting_for' => $root->status === 'resolved' ? null : ($latest?->sender_role === 'customer' ? 'team' : 'customer'),
            'customer_unread' => (clone $query)->where('id', '>', $root->customer_last_read_entry_id)->whereIn('sender_role', ['admin', 'staff'])->count(),
            'last_team_entry_id' => (int) (clone $query)->whereIn('sender_role', ['admin', 'staff'])->max('id'),
            'team_unread' => (clone $query)->where('id', '>', $root->team_last_read_entry_id)->where('sender_role', 'customer')->count(),
            'customer_last_read_entry_id' => (int) $root->customer_last_read_entry_id,
            'team_last_read_entry_id' => (int) $root->team_last_read_entry_id,
            'can_reply' => $root->user_id !== null && $root->customer_hidden_at === null,
            'closed_by_role' => $root->closed_by_role,
            'removed_from_customer_history' => $root->customer_hidden_at !== null,
        ];
    }

    public static function entries(CustomerMessage $root, array $cursor): array
    {
        $query = DB::table('customer_message_entries')->where('customer_message_id', $root->id);
        if (isset($cursor['after'])) $query->where('id', '>', $cursor['after']);
        if (isset($cursor['before'])) $query->where('id', '<', $cursor['before']);
        $forward = isset($cursor['after']);
        $rows = $query->orderBy('id', $forward ? 'asc' : 'desc')->limit(51)->get();
        $more = $rows->count() > 50;
        $rows = $rows->take(50);
        if (! $forward) $rows = $rows->reverse();
        return ['data' => $rows->map(fn ($row) => self::entry($row))->values(), 'has_more' => $more,
            'conversation' => self::present($root->fresh())];
    }

    public static function read(CustomerMessage $root, string $role, int $through): void
    {
        DB::transaction(function () use ($root, $role, $through) {
            $root = CustomerMessage::whereKey($root->id)->lockForUpdate()->firstOrFail();
            $maximum = (int) DB::table('customer_message_entries')->where('customer_message_id', $root->id)->max('id');
            $column = $role === 'customer' ? 'customer_last_read_entry_id' : 'team_last_read_entry_id';
            $root->$column = max((int) $root->$column, min($through, $maximum));
            if ($role !== 'customer') {
                $root->is_read = ! DB::table('customer_message_entries')->where('customer_message_id', $root->id)
                    ->where('sender_role', 'customer')->where('id', '>', $root->$column)->exists();
                if ($root->is_read) $root->read_at = now();
            }
            $root->save();
        });
    }

    private static function entry(object $row): array
    {
        return ['id' => (int) $row->id, 'sender_role' => $row->sender_role, 'sender_name' => $row->sender_name,
            'body' => $row->body, 'event' => $row->event ?? null, 'created_at' => $row->created_at ? \Illuminate\Support\Carbon::parse($row->created_at)->toISOString() : null];
    }

    public static function changeState(CustomerMessage $root, User $actor, bool $end, int $through): array
    {
        return DB::transaction(function () use ($root, $actor, $end, $through) {
            $root = CustomerMessage::whereKey($root->id)->lockForUpdate()->firstOrFail();
            abort_if($root->customer_hidden_at, 409, 'The customer removed this chat from their history. Please use a new inquiry.');
            if (($end && $root->status === 'resolved') || (! $end && $root->status !== 'resolved')) return self::present($root);
            $latest = (int) DB::table('customer_message_entries')->where('customer_message_id', $root->id)->max('id');
            abort_if($end && $through < $latest, 409, 'A new message arrived. Read it before ending this chat.');
            $id = DB::table('customer_message_entries')->insertGetId([
                'customer_message_id' => $root->id, 'sender_id' => $actor->id, 'sender_role' => 'system',
                'sender_name' => 'FMRC Support', 'body' => $end ? 'Chat ended by the customer.' : 'Chat reopened.',
                'event' => $end ? 'ended' : 'reopened', 'created_at' => now(), 'updated_at' => now(),
            ]);
            $root->fill(['status' => $end ? 'resolved' : 'new', 'closed_by_role' => $end ? $actor->role : null,
                'resolved_at' => $end ? now() : null, 'resolved_by_user_id' => $end ? $actor->id : null,
                'last_entry_at' => now()]);
            if ($actor->role === 'customer') $root->fill(['customer_last_read_entry_id' => $id, 'is_read' => false, 'read_at' => null]);
            $root->save();
            self::notify($root, $actor, $id);
            return self::present($root);
        });
    }

    private static function notify(CustomerMessage $root, User $actor, int $id, bool $initial = false): void
    {
        // Notification failure never loses an accepted support message.
        try {
            if ($actor->role === 'customer') {
                AdminNotification::create(['type' => 'info', 'title' => 'New Customer Inquiry',
                    'message' => $initial ? $root->sender_name.' started a support conversation.' : $root->sender_name.' added a support message.',
                    'is_read' => false, 'metadata' => ['customer_message_id' => $root->id, 'support_entry_id' => $id]]);
            } elseif ($root->user_id && Pwa::installed()) {
                app(PwaNotifications::class)->publish($root->user_id, 'support', 'FMRC replied to your inquiry',
                    'Open your support conversation to read the reply.', '/home-page/?support=1&conversation='.$root->id, 'support:'.$id);
            }
        } catch (\Throwable $error) {
            Log::warning('Support notification unavailable.', ['conversation' => $root->id, 'error' => $error->getMessage()]);
        }
    }
}
