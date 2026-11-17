<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomerMessage;
use App\Support\CustomerSupport;
use App\Support\SupportConversations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CustomerSupportController extends Controller
{
    public function assistant(Request $request)
    {
        $payload = ['data' => CustomerSupport::pack()];
        $etag = '"'.hash('sha256', json_encode($payload)).'"';
        $headers = ['ETag' => $etag, 'Cache-Control' => 'public, no-cache, must-revalidate'];
        return trim((string) $request->header('If-None-Match')) === $etag
            ? response('', 304, $headers) : response()->json($payload)->withHeaders($headers);
    }

    public function availability()
    {
        return response()->json(['installed' => CustomerSupport::installed(), 'available' => CustomerSupport::installed() && CustomerSupport::available()])->header('Cache-Control', 'no-store');
    }

    public function settings(Request $request)
    {
        abort_unless($request->user()?->role === 'admin', 403);
        return response()->json(['data' => CustomerSupport::pack(true), 'defaults' => CustomerSupport::defaults()])->header('Cache-Control', 'private, no-store');
    }

    public function saveSettings(Request $request)
    {
        abort_unless($request->user()?->role === 'admin', 403);
        return response()->json(['message' => 'Support settings saved.', 'data' => CustomerSupport::save($request->all())])->header('Cache-Control', 'private, no-store');
    }

    public function presence(Request $request)
    {
        $this->operator($request);
        $token = $request->user()->currentAccessToken();
        // Actual portal tokens own short leases. Background requests do not
        // call the session activity endpoint and cannot prolong idle sessions.
        abort_unless($token instanceof \Laravel\Sanctum\PersonalAccessToken, 403, 'A signed-in portal session is required.');
        if ($request->isMethod('post')) {
            $data = $request->validate(['available' => 'required|boolean']);
            if ($data['available']) {
                DB::table('support_operator_presence')->updateOrInsert(['token_id' => $token->id], ['user_id' => $request->user()->id, 'expires_at' => now()->addSeconds(60)]);
            } else {
                DB::table('support_operator_presence')->where('token_id', $token->id)->delete();
            }
        }
        return response()->json(['available' => DB::table('support_operator_presence')->where('token_id', $token->id)->where('expires_at', '>', now())->exists()])->header('Cache-Control', 'private, no-store');
    }

    public function index(Request $request)
    {
        abort_unless($request->user()?->role === 'customer', 403);
        $this->ready();
        $data = $request->validate(['page' => 'sometimes|integer|min:1']);
        $rows = CustomerMessage::where('user_id', $request->user()->id)->whereNull('customer_hidden_at')->orderByDesc('last_entry_at')->orderByDesc('id')->paginate(15);
        return response()->json(['data' => $rows->getCollection()->map(fn ($root) => SupportConversations::present($root)),
            'meta' => ['page' => $rows->currentPage(), 'last_page' => $rows->lastPage(), 'total' => $rows->total()],
            'unread_count' => DB::table('customer_message_entries as e')->join('customer_messages as c', 'c.id', '=', 'e.customer_message_id')
                ->where('c.user_id', $request->user()->id)->whereNull('c.customer_hidden_at')->whereIn('e.sender_role', ['admin', 'staff'])->whereColumn('e.id', '>', 'c.customer_last_read_entry_id')->count(),
        ])->header('Cache-Control', 'private, no-store');
    }

    public function show(Request $request, CustomerMessage $customerMessage)
    {
        $this->access($request, $customerMessage);
        return response()->json(['data' => SupportConversations::present($customerMessage)])->header('Cache-Control', 'private, no-store');
    }

    public function entries(Request $request, CustomerMessage $customerMessage)
    {
        $this->access($request, $customerMessage);
        $cursor = $request->validate(['after' => 'sometimes|integer|min:0|prohibits:before', 'before' => 'sometimes|integer|min:1|prohibits:after']);
        return response()->json(SupportConversations::entries($customerMessage, $cursor))->header('Cache-Control', 'private, no-store');
    }

    public function send(Request $request, CustomerMessage $customerMessage)
    {
        $this->access($request, $customerMessage);
        abort_unless($customerMessage->user_id, 409, 'This historical inquiry has no linked customer account and cannot receive private replies.');
        $data = $request->validate(['body' => 'required|string|max:3000', 'request_key' => 'required|uuid']);
        return response()->json(['message' => 'Message sent.', ...SupportConversations::send($customerMessage, $request->user(), trim($data['body']), $data['request_key'])])->header('Cache-Control', 'private, no-store');
    }

    public function read(Request $request, CustomerMessage $customerMessage)
    {
        $this->access($request, $customerMessage);
        $data = $request->validate(['through' => 'required|integer|min:0']);
        SupportConversations::read($customerMessage, $request->user()->role, $data['through']);
        return response()->json(['message' => 'Conversation marked as read.'])->header('Cache-Control', 'private, no-store');
    }

    public function end(Request $request, CustomerMessage $customerMessage)
    {
        abort_unless($request->user()?->role === 'customer', 403);
        $this->access($request, $customerMessage);
        $data = $request->validate(['through' => 'required|integer|min:0']);
        return response()->json(['message' => 'Chat ended. Your conversation history is still available.',
            'data' => SupportConversations::changeState($customerMessage, $request->user(), true, $data['through'])])->header('Cache-Control', 'private, no-store');
    }

    public function reopen(Request $request, CustomerMessage $customerMessage)
    {
        $this->access($request, $customerMessage);
        abort_unless($customerMessage->user_id, 409, 'This historical inquiry has no linked customer account.');
        return response()->json(['message' => 'Chat reopened.', 'data' => SupportConversations::changeState($customerMessage, $request->user(), false, 0)])->header('Cache-Control', 'private, no-store');
    }

    public function deleteHistory(Request $request, ?CustomerMessage $customerMessage = null)
    {
        abort_unless($request->user()?->role === 'customer', 403);
        $this->ready();
        $ids = $customerMessage ? [$customerMessage->id] : $request->validate([
            'ids' => 'required|array|min:1|max:100', 'ids.*' => 'required|integer|min:1|distinct',
        ])['ids'];
        $result = DB::transaction(function () use ($request, $ids) {
            $rows = CustomerMessage::where('user_id', $request->user()->id)->whereNull('customer_hidden_at')
                ->whereIn('id', $ids)->lockForUpdate()->get();
            $eligible = $rows->where('status', 'resolved')->pluck('id')->all();
            if ($eligible) {
                CustomerMessage::whereIn('id', $eligible)->update(['customer_hidden_at' => now()]);
                if (\Illuminate\Support\Facades\Schema::hasTable('customer_notifications')) {
                    DB::table('customer_notifications')->where('user_id', $request->user()->id)->where('type', 'support')
                        ->whereIn('target', array_map(fn ($id) => '/home-page/?support=1&conversation='.$id, $eligible))->delete();
                }
            }
            return ['processed_ids' => $eligible, 'skipped_ids' => array_values(array_diff($ids, $eligible))];
        });
        if ($customerMessage && ! $result['processed_ids']) {
            abort_unless($customerMessage->user_id === $request->user()->id && ! $customerMessage->customer_hidden_at, 404);
            abort(409, 'End this chat before deleting it from your history.');
        }
        return response()->json(['message' => count($result['processed_ids']).' conversation(s) removed from your history. FMRC keeps its inquiry records.', ...$result])->header('Cache-Control', 'private, no-store');
    }

    private function ready(): void
    {
        abort_unless(CustomerSupport::installed(), 503, 'Live messaging setup is not complete yet. You can still use the Contact form.');
    }

    private function operator(Request $request): void
    {
        abort_unless(in_array($request->user()?->role, ['admin', 'staff'], true), 403);
        $this->ready();
    }

    private function access(Request $request, CustomerMessage $root): void
    {
        $this->ready();
        if (str_starts_with($request->path(), 'api/admin/')) {
            $this->operator($request);
        } else {
            abort_unless($request->user()?->role === 'customer', 403);
            abort_unless($root->user_id !== null && (int) $root->user_id === (int) $request->user()->id && $root->customer_hidden_at === null, 404);
        }
    }
}
