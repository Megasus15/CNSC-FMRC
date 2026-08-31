<?php

namespace App\Http\Controllers\Api;

use App\Models\AdminNotification;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class NotificationController extends Controller
{
    /**
     * Notification types only an administrator may see. `account_request` carries an
     * applicant's full name and Gmail address, and the page that answers it
     * (Accounts Management) exists in the Admin portal only — so a staff session must
     * neither list one, count one in its badge, nor be able to read, clear or delete
     * one by guessing an id.
     *
     * Filtering has to happen here rather than in the browser: the bell badge is set
     * from this endpoint's `unread_count`, so a client-side row filter would leave the
     * badge counting rows the feed no longer shows.
     */
    private const ADMIN_ONLY_TYPES = ['account_request'];

    /**
     * Admin: Get all notifications (latest first) + unread count in ONE query.
     */
    public function index(Request $request): JsonResponse
    {
        return $this->respondWithNotifications($request);
    }

    /**
     * Admin: Mark a specific notification as read — returns updated list instantly.
     */
    public function markRead(Request $request, AdminNotification $notification): JsonResponse
    {
        if (! $this->isVisibleTo($request, $notification)) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        $notification->update(['is_read' => true]);

        return response()->json([
            'message' => 'Notification marked as read.',
        ]);
    }

    /**
     * Admin: Mark ALL notifications as read — returns updated list instantly.
     */
    public function markAllRead(Request $request): JsonResponse
    {
        $this->visibleNotifications($request)
            ->where('is_read', false)
            ->update(['is_read' => true]);

        return response()->json([
            'message' => 'All notifications marked as read.',
        ]);
    }

    /**
     * Admin: Delete a notification — returns updated list instantly.
     */
    public function destroy(Request $request, AdminNotification $notification): JsonResponse
    {
        if (! $this->isVisibleTo($request, $notification)) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        $notification->delete();

        return response()->json([
            'message' => 'Notification deleted.',
        ]);
    }

    /**
     * Admin: Clear all notifications.
     */
    public function clearAll(Request $request): JsonResponse
    {
        $this->visibleNotifications($request)->delete();

        return response()->json([
            'message' => 'All notifications cleared.',
        ]);
    }

    /**
     * Admin: Get only the unread count (lightweight poll endpoint).
     */
    public function unreadCount(Request $request): JsonResponse
    {
        $count = $this->visibleNotifications($request)
            ->where('is_read', false)
            ->count();

        return response()->json(['unread_count' => $count]);
    }

    /**
     * Every query in this controller starts here, so the admin-only scope can never be
     * forgotten on one endpoint and leak through it. Administrators get everything;
     * any other signed-in role (staff today) gets everything except the admin-only
     * types. `admin_notifications.type` is NOT NULL with a default, so a plain
     * `whereNotIn` cannot silently drop rows.
     */
    private function visibleNotifications(Request $request): Builder
    {
        $query = AdminNotification::query();

        if ($request->user()?->role !== 'admin') {
            $query->whereNotIn('type', self::ADMIN_ONLY_TYPES);
        }

        return $query;
    }

    /**
     * Guard for the two endpoints that receive a bound model instead of running a
     * query: a staff session asking for an admin-only row is told it does not exist,
     * which is also what it looks like in that session's own notification feed.
     */
    private function isVisibleTo(Request $request, AdminNotification $notification): bool
    {
        if ($request->user()?->role === 'admin') {
            return true;
        }

        return ! in_array($notification->type, self::ADMIN_ONLY_TYPES, true);
    }

    /**
     * Single helper: fetch latest 50 notifications + unread count.
     * Every mutation endpoint returns this so the frontend always has fresh data.
     */
    private function respondWithNotifications(Request $request, ?string $message = null): JsonResponse
    {
        $notifications = $this->visibleNotifications($request)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        $unreadCount = $notifications->where('is_read', false)->count();

        $payload = [
            'data'         => $notifications,
            'unread_count' => $unreadCount,
        ];

        if ($message) {
            $payload['message'] = $message;
        }

        return response()->json($payload);
    }
}
