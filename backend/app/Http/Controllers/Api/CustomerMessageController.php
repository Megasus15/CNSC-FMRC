<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminNotification;
use App\Models\CustomerMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CustomerMessageController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $denied = $this->ensureCustomer($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'email' => 'required|string|email|max:190',
            'message' => 'required|string|max:3000',
        ]);

        $actor = $request->user();

        $message = CustomerMessage::create([
            'user_id' => $actor->id,
            'sender_name' => trim($validated['name']),
            'sender_email' => strtolower(trim($validated['email'])),
            'message' => trim($validated['message']),
            'status' => 'new',
            'is_read' => false,
        ]);

        $this->createAdminNotification($message);

        return response()->json([
            'message' => 'Your message has been sent successfully.',
            'data' => $this->transformMessage($message),
        ], 201);
    }

    public function index(Request $request): JsonResponse
    {
        $denied = $this->ensureAdminOrStaff($request);
        if ($denied) {
            return $denied;
        }

        $search = trim((string) $request->query('search', ''));
        $status = strtolower(trim((string) $request->query('status', 'all')));

        $query = CustomerMessage::query()->with(['customer:id,name,email', 'resolvedBy:id,name,email']);

        if ($search !== '') {
            $query->where(function ($inner) use ($search) {
                $inner->where('sender_name', 'like', "%{$search}%")
                    ->orWhere('sender_email', 'like', "%{$search}%")
                    ->orWhere('message', 'like', "%{$search}%");
            });
        }

        if ($status === 'new') {
            $query->where('status', 'new');
        } elseif ($status === 'resolved') {
            $query->where('status', 'resolved');
        } elseif ($status === 'unread') {
            $query->where('is_read', false);
        }

        $messages = $query->orderByDesc('created_at')->limit(500)->get();

        return response()->json([
            'data' => $messages->map(fn (CustomerMessage $msg) => $this->transformMessage($msg)),
            'summary' => [
                'total' => CustomerMessage::count(),
                'new' => CustomerMessage::where('status', 'new')->count(),
                'unread' => CustomerMessage::where('is_read', false)->count(),
                'resolved' => CustomerMessage::where('status', 'resolved')->count(),
            ],
        ]);
    }

    public function markRead(Request $request, CustomerMessage $customerMessage): JsonResponse
    {
        $denied = $this->ensureAdminOrStaff($request);
        if ($denied) {
            return $denied;
        }

        if (!$customerMessage->is_read) {
            $customerMessage->is_read = true;
            $customerMessage->read_at = now();
            $customerMessage->save();
        }

        return response()->json([
            'message' => 'Message marked as read.',
            'data' => $this->transformMessage($customerMessage->fresh(['customer:id,name,email', 'resolvedBy:id,name,email'])),
        ]);
    }

    public function resolve(Request $request, CustomerMessage $customerMessage): JsonResponse
    {
        $denied = $this->ensureAdminOrStaff($request);
        if ($denied) {
            return $denied;
        }

        $customerMessage->status = 'resolved';
        $customerMessage->is_read = true;
        $customerMessage->read_at = $customerMessage->read_at ?: now();
        $customerMessage->resolved_at = now();
        $customerMessage->resolved_by_user_id = $request->user()?->id;
        $customerMessage->save();

        return response()->json([
            'message' => 'Message marked as resolved.',
            'data' => $this->transformMessage($customerMessage->fresh(['customer:id,name,email', 'resolvedBy:id,name,email'])),
        ]);
    }

    public function destroy(Request $request, CustomerMessage $customerMessage): JsonResponse
    {
        $denied = $this->ensureAdminOrStaff($request);
        if ($denied) {
            return $denied;
        }

        $customerMessage->delete();

        return response()->json([
            'message' => 'Message deleted successfully.',
        ]);
    }

    public function deleteBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();

        $deletedIds = DB::transaction(function () use ($ids): array {
            $eligibleIds = CustomerMessage::query()
                ->whereIn('id', $ids)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($eligibleIds) {
                CustomerMessage::destroy($eligibleIds);
            }

            return $eligibleIds;
        });

        if (!$deletedIds) {
            return response()->json(['message' => 'No matching customer inquiries were found to delete.'], 404);
        }

        return response()->json([
            'action' => 'delete',
            'scope' => 'customer_messages',
            'processed_ids' => $deletedIds,
            'processed_count' => count($deletedIds),
            'skipped_ids' => array_values(array_diff($ids, $deletedIds)),
            'message' => count($deletedIds) . ' customer inquiry(s) deleted successfully.',
        ]);
    }

    private function ensureCustomer(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor || $actor->role !== 'customer') {
            return response()->json([
                'message' => 'Forbidden. Customer access is required.',
            ], 403);
        }

        return null;
    }

    public function summary(Request $request): JsonResponse
    {
        $denied = $this->ensureAdminOrStaff($request);
        if ($denied) {
            return $denied;
        }

        return response()->json([
            'total' => CustomerMessage::count(),
            'new' => CustomerMessage::where('status', 'new')->count(),
            'unread' => CustomerMessage::where('is_read', false)->count(),
            'resolved' => CustomerMessage::where('status', 'resolved')->count(),
        ]);
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor || !in_array($actor->role, ['admin', 'staff'], true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }

    private function createAdminNotification(CustomerMessage $message): void
    {
        try {
            AdminNotification::create([
                'type' => 'info',
                'title' => 'New Customer Inquiry',
                'message' => "{$message->sender_name} sent a new message from the Contact page.",
                'is_read' => false,
                'metadata' => [
                    'customer_message_id' => $message->id,
                    'sender_email' => $message->sender_email,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::warning('Could not create customer message notification: ' . $e->getMessage());
        }
    }

    private function transformMessage(CustomerMessage $message): array
    {
        return [
            'id' => $message->id,
            'user_id' => $message->user_id,
            'sender_name' => $message->sender_name,
            'sender_email' => $message->sender_email,
            'message' => $message->message,
            'is_read' => (bool) $message->is_read,
            'read_at' => optional($message->read_at)->toISOString(),
            'status' => $message->status,
            'resolved_at' => optional($message->resolved_at)->toISOString(),
            'resolved_by_name' => $message->resolvedBy?->name,
            'created_at' => optional($message->created_at)->toISOString(),
            'updated_at' => optional($message->updated_at)->toISOString(),
            'customer' => $message->customer ? [
                'id' => $message->customer->id,
                'name' => $message->customer->name,
                'email' => $message->customer->email,
            ] : null,
        ];
    }
}
