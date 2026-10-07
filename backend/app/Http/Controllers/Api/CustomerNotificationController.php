<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\Pwa;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CustomerNotificationController extends Controller
{
    private function visible(Request $request)
    {
        abort_unless(Pwa::installed(), 503, 'Notifications are not available yet.');
        $user = $request->user('sanctum');
        abort_if($user && $user->role !== 'customer', 403);

        return DB::table('customer_notifications as n')->where('n.published_at', '<=', now())
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
        // A phone tap resolves its destination without rebuilding the removed
        // inbox UI. The same visibility rules protect private account targets.
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
        $this->visible($request)->select('n.id')->orderBy('n.id')->chunk(100, function ($records) use ($user) {
            DB::table('customer_notification_reads')->insertOrIgnore($records->map(fn ($record) => ['user_id' => $user->id, 'notification_id' => $record->id, 'read_at' => now()])->all());
        });

        return response()->json(['read' => true]);
    }
}
