<?php

namespace App\Http\Controllers\Api;

use App\Models\AdminNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class NotificationController extends Controller
{
    /**
     * Admin: Get all notifications (latest first) + unread count in ONE query.
     */
    public function index(): JsonResponse
    {
        return $this->respondWithNotifications();
    }

    /**
     * Admin: Mark a specific notification as read — returns updated list instantly.
     */
    public function markRead(AdminNotification $notification): JsonResponse
    {
        $notification->update(['is_read' => true]);

        return $this->respondWithNotifications('Notification marked as read.');
    }

    /**
     * Admin: Mark ALL notifications as read — returns updated list instantly.
     */
    public function markAllRead(): JsonResponse
    {
        AdminNotification::where('is_read', false)->update(['is_read' => true]);

        return $this->respondWithNotifications('All notifications marked as read.');
    }

    /**
     * Admin: Delete a notification — returns updated list instantly.
     */
    public function destroy(AdminNotification $notification): JsonResponse
    {
        $notification->delete();

        return $this->respondWithNotifications('Notification deleted.');
    }

    /**
     * Admin: Get only the unread count (lightweight poll endpoint).
     */
    public function unreadCount(): JsonResponse
    {
        $count = AdminNotification::where('is_read', false)->count();

        return response()->json(['unread_count' => $count]);
    }

    /**
     * Single helper: fetch latest 50 notifications + unread count.
     * Every mutation endpoint returns this so the frontend always has fresh data.
     */
    private function respondWithNotifications(?string $message = null): JsonResponse
    {
        $notifications = AdminNotification::orderByDesc('created_at')
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
