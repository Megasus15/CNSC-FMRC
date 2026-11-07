<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\Pwa;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CustomerNotificationController extends Controller
{
    private function owned(Request $request)
    {
        abort_unless(Pwa::installed(), 503, 'Notifications are not available yet.');
        $user = $request->user('sanctum');
        abort_unless($user, 401);
        abort_unless($user->role === 'customer', 403);

        return DB::table('customer_notifications')->where('user_id', $user->id)->where('published_at', '<=', now());
    }

    public function destroy(Request $request, int $id)
    {
        abort_unless($this->owned($request)->where('id', $id)->delete(), 404, 'Notification not found.');

        return response()->json(['message' => 'Notification deleted.'])->header('Cache-Control', 'private, no-store');
    }

    public function clearAll(Request $request)
    {
        $data = $request->validate(['through' => 'required|integer|min:1']);
        $count = $this->owned($request)->where('id', '<=', $data['through'])->delete();

        return response()->json(['message' => 'Notifications deleted.', 'deleted_count' => $count])->header('Cache-Control', 'private, no-store');
    }

    private function visible(Request $request)
    {
        abort_unless(Pwa::installed(), 503, 'Notifications are not available yet.');
        $user = $request->user('sanctum');
        abort_if($user && $user->role !== 'customer', 403);

        $scope = $request->validate(['scope' => 'sometimes|in:all,personal'])['scope'] ?? 'all';
        abort_if($scope === 'personal' && ! $user, 401);

        return DB::table('customer_notifications as n')->where('n.published_at', '<=', now())
            ->when($scope === 'personal', fn ($query) => $query->where('n.user_id', $user->id))
            ->where(fn ($q) => $q->whereNull('n.user_id')->when($user, fn ($q) => $q->orWhere('n.user_id', $user->id)));
    }

    public function index(Request $request)
    {
        $user = $request->user('sanctum');
        $query = $this->visible($request);
        if ($user) {
            $query->leftJoin('customer_notification_reads as r', fn ($join) => $join->on('r.notification_id', '=', 'n.id')->where('r.user_id', $user->id));
            $query->select('n.id', 'n.type', 'n.title', 'n.message', 'n.target', 'n.published_at', 'r.read_at');
        } else {
            $query->select('n.id', 'n.type', 'n.title', 'n.message', 'n.target', 'n.published_at');
        }
        $rows = $query->orderByDesc('n.id')->paginate(30);

        return response()->json($rows)->header('Cache-Control', 'no-store');
    }

    public function unread(Request $request)
    {
        $query = $this->visible($request);
        if ($user = $request->user('sanctum')) {
            $query->whereNotExists(fn ($q) => $q->selectRaw('1')->from('customer_notification_reads as r')->whereColumn('r.notification_id', 'n.id')->where('r.user_id', $user->id));
        } else {
            $data = $request->validate(['after' => 'sometimes|integer|min:0', 'read_ids' => ['nullable', 'string', 'max:4000', 'regex:/^\d+(,\d+){0,199}$/']]);
            $ids = filled($data['read_ids'] ?? '') ? array_map('intval', explode(',', $data['read_ids'])) : [];
            $query->where('n.id', '>', (int) ($data['after'] ?? 0))->whereNotIn('n.id', $ids);
        }

        return response()->json(['unread_count' => $query->count()])->header('Cache-Control', 'no-store');
    }

    public function show(Request $request, int $id)
    {
        // Phone taps and the shared customer bell use the same ownership rules.
        $record = $this->visible($request)->where('n.id', $id)->first(['n.id', 'n.type', 'n.target']);
        abort_unless($record, 404);

        return response()->json($record)->header('Cache-Control', 'no-store');
    }

    public function read(Request $request, int $id)
    {
        $record = $this->visible($request)->where('n.id', $id)->first();
        abort_unless($record, 404);
        $user = $request->user('sanctum');
        abort_unless($user, 401);
        DB::table('customer_notification_reads')->upsert([['user_id' => $user->id, 'notification_id' => $id, 'read_at' => now()]], ['user_id', 'notification_id'], ['read_at']);

        return response()->json(['read' => true]);
    }

    public function readAll(Request $request)
    {
        $user = $request->user('sanctum');
        abort_unless($user, 401);
        $data = $request->validate(['through' => 'sometimes|integer|min:1']);
        $this->visible($request)->when(isset($data['through']), fn ($query) => $query->where('n.id', '<=', $data['through']))->select('n.id')->orderBy('n.id')->chunk(100, function ($records) use ($user) {
            DB::table('customer_notification_reads')->insertOrIgnore($records->map(fn ($record) => ['user_id' => $user->id, 'notification_id' => $record->id, 'read_at' => now()])->all());
        });

        return response()->json(['read' => true]);
    }
}
