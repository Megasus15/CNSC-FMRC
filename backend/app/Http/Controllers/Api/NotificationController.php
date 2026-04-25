<?php

namespace App\Http\Controllers\Api;

use App\Models\AdminNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class NotificationController extends Controller
{
    /**
     * Admin: Get all notifications (latest first).
     */
    public function index(): JsonResponse
    {
        $notifications = AdminNotification::orderByDesc('created_at')
            ->limit(50)
            ->get();

        $unreadCount = AdminNotification::where('is_read', false)->count();

        return response()->json([
            'data'         => $notifications,
            'unread_count' => $unreadCount,
        ]);
    }

    /**
     * Admin: Mark a specific notification as read.
     */
    public function markRead(AdminNotification $notification): JsonResponse
    {
        $notification->update(['is_read' => true]);

        return response()->json(['message' => 'Notification marked as read.']);
    }

    /**
     * Admin: Mark ALL notifications as read.
     */
    public function markAllRead(): JsonResponse
    {
        AdminNotification::where('is_read', false)->update(['is_read' => true]);

        return response()->json(['message' => 'All notifications marked as read.']);
    }

    /**
     * Admin: Delete a notification.
     */
    public function destroy(AdminNotification $notification): JsonResponse
    {
        $notification->delete();

        return response()->json(['message' => 'Notification deleted.']);
    }

    /**
     * Admin: Get only the unread count (lightweight poll endpoint).
     */
    public function unreadCount(): JsonResponse
    {
        $count = AdminNotification::where('is_read', false)->count();

        return response()->json(['unread_count' => $count]);
    }
}
