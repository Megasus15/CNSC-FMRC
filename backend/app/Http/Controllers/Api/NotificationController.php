<?php

namespace App\Http\Controllers\Api;

use App\Models\AdminNotification;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class NotificationController extends Controller
{
    private const ADMIN_ONLY_TYPES = ['account_request'];
    private const STATES = 'admin_notification_states';

    public function index(Request $request): JsonResponse
    {
        return $this->respondWithNotifications($request);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return $this->response($request, ['unread_count' => $this->unread($request)]);
    }

    public function markRead(Request $request, AdminNotification $notification): JsonResponse
    {
        $this->requireVisible($request, $notification);
        $this->writeStates($request, [(int) $notification->id], 'read_at');
        return $this->response($request, ['message' => 'Notification marked as read.']);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $this->writeAll($request, 'read_at');
        return $this->response($request, ['message' => 'Your notifications are marked as read.']);
    }

    public function destroy(Request $request, AdminNotification $notification): JsonResponse
    {
        $this->requireVisible($request, $notification);
        $this->writeStates($request, [(int) $notification->id], 'dismissed_at');
        return $this->response($request, ['message' => 'Notification removed from your feed.']);
    }

    public function clearAll(Request $request): JsonResponse
    {
        $this->writeAll($request, 'dismissed_at');
        return $this->response($request, ['message' => 'Your notifications are cleared.']);
    }

    private function authorize(Request $request): void
    {
        abort_unless(in_array($request->user()?->role, ['admin', 'staff'], true), 403, 'Admin or Staff access is required.');
        abort_unless(Schema::hasTable(self::STATES), 503, 'Personal notifications are not installed. Run the notification-state migration to enable this feature.');
    }

    private function visibleNotifications(Request $request): Builder
    {
        $this->authorize($request);
        $query = AdminNotification::query()->leftJoin(self::STATES.' as personal_state', function ($join) use ($request) {
            $join->on('personal_state.notification_id', '=', 'admin_notifications.id')
                ->where('personal_state.user_id', (int) $request->user()->id);
        })->whereNull('personal_state.dismissed_at');
        if ($request->user()->role !== 'admin') $query->whereNotIn('admin_notifications.type', self::ADMIN_ONLY_TYPES);
        return $query;
    }

    private function requireVisible(Request $request, AdminNotification $notification): void
    {
        abort_unless($this->visibleNotifications($request)->where('admin_notifications.id', $notification->id)->exists(), 404, 'Notification not found.');
    }

    private function unread(Request $request): int
    {
        return $this->visibleNotifications($request)->where('admin_notifications.is_read', false)
            ->whereNull('personal_state.read_at')->count('admin_notifications.id');
    }

    private function writeStates(Request $request, array $ids, string $column): void
    {
        if (! $ids) return;
        $at = now();
        $rows = array_map(fn ($id) => ['user_id' => (int) $request->user()->id, 'notification_id' => $id, $column => $at], $ids);
        // Only update the requested timestamp: a concurrent mark-read must never
        // erase a dismissal, and clearing a feed must not alter another account.
        DB::table(self::STATES)->upsert($rows, ['user_id', 'notification_id'], [$column]);
    }

    private function writeAll(Request $request, string $column): void
    {
        // Capture the IDs first so later arrivals (including a transaction that
        // allocated an earlier ID) are never accidentally included by batching.
        $ids = $this->visibleNotifications($request)->pluck('admin_notifications.id')->all();
        DB::transaction(function () use ($request, $ids, $column) {
            foreach (array_chunk($ids, 500) as $chunk) $this->writeStates($request, $chunk, $column);
        });
    }

    private function respondWithNotifications(Request $request): JsonResponse
    {
        $notifications = $this->visibleNotifications($request)->select('admin_notifications.*')
            ->selectRaw('(admin_notifications.is_read OR personal_state.read_at IS NOT NULL) as is_read')
            ->orderByDesc('admin_notifications.created_at')->orderByDesc('admin_notifications.id')->limit(50)->get();
        return $this->response($request, ['data' => $notifications, 'unread_count' => $this->unread($request)]);
    }

    private function response(Request $request, array $payload): JsonResponse
    {
        return response()->json(['user_id' => (int) $request->user()->id, ...$payload])->header('Cache-Control', 'private, no-store');
    }
}
