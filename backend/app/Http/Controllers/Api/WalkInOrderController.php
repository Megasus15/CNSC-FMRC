<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WalkInOrder;
use DateTimeInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class WalkInOrderController extends Controller
{
    private const PH_TIME_ZONE = 'Asia/Manila';

    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    public function index(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $rows = WalkInOrder::query()
            ->orderByDesc('order_date')
            ->orderByDesc('id')
            ->get();

        return response()->json([
            'data' => $rows->map(fn (WalkInOrder $order) => $this->transformRow($order))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'order_no' => 'required|string|max:80|unique:walk_in_orders,order_no',
            'order_item' => 'required|string|max:180',
            'order_date' => 'required|date',
            'customer' => 'required|string|max:160',
            'payment_method' => 'required|string|max:30',
            'total' => 'required|numeric|min:0|max:9999999.99',
            'status' => 'required|string|max:40',
        ]);

        $walkInOrder = WalkInOrder::query()->create([
            'order_no' => trim((string) $validated['order_no']),
            'order_item' => trim((string) $validated['order_item']),
            'order_date' => Carbon::parse($validated['order_date'], self::PH_TIME_ZONE),
            'customer' => trim((string) $validated['customer']),
            'payment_method' => trim((string) $validated['payment_method']),
            'total' => (float) $validated['total'],
            'status' => trim((string) $validated['status']),
            'created_by_user_id' => $request->user()?->id,
        ]);

        return response()->json([
            'message' => 'Walk-in order added successfully.',
            'data' => $this->transformRow($walkInOrder),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $walkInOrder = WalkInOrder::query()->find($id);
        if (!$walkInOrder) {
            return response()->json(['message' => 'Walk-in order not found.'], 404);
        }

        $validated = $request->validate([
            'order_no' => 'required|string|max:80|unique:walk_in_orders,order_no,' . $walkInOrder->id,
            'order_item' => 'required|string|max:180',
            'order_date' => 'required|date',
            'customer' => 'required|string|max:160',
            'payment_method' => 'required|string|max:30',
            'total' => 'required|numeric|min:0|max:9999999.99',
            'status' => 'required|string|max:40',
        ]);

        $walkInOrder->update([
            'order_no' => trim((string) $validated['order_no']),
            'order_item' => trim((string) $validated['order_item']),
            'order_date' => Carbon::parse($validated['order_date'], self::PH_TIME_ZONE),
            'customer' => trim((string) $validated['customer']),
            'payment_method' => trim((string) $validated['payment_method']),
            'total' => (float) $validated['total'],
            'status' => trim((string) $validated['status']),
        ]);

        return response()->json([
            'message' => 'Walk-in order updated successfully.',
            'data' => $this->transformRow($walkInOrder->refresh()),
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $walkInOrder = WalkInOrder::query()->find($id);
        if (!$walkInOrder) {
            return response()->json(['message' => 'Walk-in order not found.'], 404);
        }

        $walkInOrder->delete();

        return response()->json([
            'message' => 'Walk-in order deleted successfully.',
        ]);
    }

    private function ensureAdmin(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json([
                'message' => 'Forbidden. Admin or staff access is required.',
            ], 403);
        }

        return null;
    }

    private function transformRow(WalkInOrder $order): array
    {
        return [
            'id' => (int) $order->id,
            'order_no' => $order->order_no,
            'order_item' => $order->order_item,
            'order_date' => $this->formatPhilippineIso($order->order_date),
            'order_date_label' => $this->formatPhilippineLabel($order->order_date),
            'customer' => $order->customer,
            'payment_method' => $order->payment_method,
            'total' => (float) $order->total,
            'total_label' => $this->formatMoney((float) $order->total),
            'status' => $order->status,
            'created_at' => $this->formatPhilippineIso($order->created_at),
        ];
    }

    private function formatPhilippineIso(?DateTimeInterface $dateTime): ?string
    {
        if (!$dateTime) {
            return null;
        }

        return Carbon::instance($dateTime)->timezone(self::PH_TIME_ZONE)->toIso8601String();
    }

    private function formatPhilippineLabel(?DateTimeInterface $dateTime): ?string
    {
        if (!$dateTime) {
            return null;
        }

        return Carbon::instance($dateTime)
            ->timezone(self::PH_TIME_ZONE)
            ->format('M d, Y h:i A');
    }

    private function formatMoney(float $amount): string
    {
        return '₱ ' . number_format($amount, 2, '.', ',');
    }
}
