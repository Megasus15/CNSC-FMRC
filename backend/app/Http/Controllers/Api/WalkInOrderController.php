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

    private const ALLOWED_CLIENT_TYPES = [
        'MSME/ENTREP',
        'STUDENT',
        'EDUCATOR',
        'RESEARCHER',
        'COOPERATIVE',
        'ASSOCIATION',
        'OTHERS (SPECIFY)',
    ];

    private const ALLOWED_PROJECT_DESCRIPTIONS = [
        'PRODUCT LABELING AND DESIGNING',
        '3D PRINTING',
        '3D SCANNING',
        'LASER-CUTTING/ENGRAVING',
        'LARGE FORMAT PRINTING AND CUTTING',
        'CNC MILLING',
        'DIGITAL EMBROIDERY',
        'HEAT PRESS',
        'TRAINING/WORKSHOP/TOUR',
        'PARTNERSHIP',
        'OTHERS (SPECIFY)',
    ];

    private const WALKIN_PAYMENT_METHOD = 'WALKIN VIA CASHIER';

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

        $validated = $this->validatePayload($request);

        $walkInOrder = WalkInOrder::query()->create([
            'order_no' => trim((string) $validated['order_no']),
            'customer_name' => trim((string) $validated['customer_name']),
            'address' => trim((string) $validated['address']),
            'contact_number' => trim((string) $validated['contact_number']),
            'client_type' => trim((string) $validated['client_type']),
            'client_type_other' => $this->normalizeOtherField($validated['client_type'] ?? '', $validated['client_type_other'] ?? null),
            'agency_organization' => trim((string) $validated['agency_organization']),
            'project_description' => trim((string) $validated['project_description']),
            'project_description_other' => $this->normalizeOtherField($validated['project_description'] ?? '', $validated['project_description_other'] ?? null),
            'item_detail' => trim((string) $validated['item_detail']),
            'unit' => trim((string) $validated['unit']),
            'subtotal_cost' => (float) $validated['subtotal_cost'],
            'order_item' => trim((string) $validated['item_detail']),
            'order_date' => isset($validated['order_date'])
                ? Carbon::parse($validated['order_date'], self::PH_TIME_ZONE)
                : now(self::PH_TIME_ZONE),
            'customer' => trim((string) $validated['customer_name']),
            'payment_method' => self::WALKIN_PAYMENT_METHOD,
            'total' => (float) $validated['total'],
            'status' => trim((string) ($validated['status'] ?? 'Pending')),
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

        $validated = $this->validatePayload($request, $walkInOrder->id);

        $walkInOrder->update([
            'order_no' => trim((string) $validated['order_no']),
            'customer_name' => trim((string) $validated['customer_name']),
            'address' => trim((string) $validated['address']),
            'contact_number' => trim((string) $validated['contact_number']),
            'client_type' => trim((string) $validated['client_type']),
            'client_type_other' => $this->normalizeOtherField($validated['client_type'] ?? '', $validated['client_type_other'] ?? null),
            'agency_organization' => trim((string) $validated['agency_organization']),
            'project_description' => trim((string) $validated['project_description']),
            'project_description_other' => $this->normalizeOtherField($validated['project_description'] ?? '', $validated['project_description_other'] ?? null),
            'item_detail' => trim((string) $validated['item_detail']),
            'unit' => trim((string) $validated['unit']),
            'subtotal_cost' => (float) $validated['subtotal_cost'],
            'order_item' => trim((string) $validated['item_detail']),
            'order_date' => isset($validated['order_date'])
                ? Carbon::parse($validated['order_date'], self::PH_TIME_ZONE)
                : ($walkInOrder->order_date ?? now(self::PH_TIME_ZONE)),
            'customer' => trim((string) $validated['customer_name']),
            'payment_method' => self::WALKIN_PAYMENT_METHOD,
            'total' => (float) $validated['total'],
            'status' => trim((string) ($validated['status'] ?? ($walkInOrder->status ?: 'Pending'))),
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
        $customerName = $order->customer_name ?: $order->customer ?: 'Walk-in Customer';
        $itemDetail = $order->item_detail ?: $order->order_item;
        $subtotalCost = (float) ($order->subtotal_cost ?? $order->total ?? 0);

        return [
            'id' => (int) $order->id,
            'order_no' => $order->order_no,
            'name' => $customerName,
            'customer_name' => $customerName,
            'address' => $order->address,
            'contact_number' => $order->contact_number,
            'client_type' => $order->client_type,
            'client_type_other' => $order->client_type_other,
            'agency_organization' => $order->agency_organization,
            'project_description' => $order->project_description,
            'project_description_other' => $order->project_description_other,
            'item_detail' => $itemDetail,
            'order_item' => $itemDetail,
            'unit' => $order->unit,
            'subtotal_cost' => $subtotalCost,
            'subtotal_cost_label' => $this->formatMoney($subtotalCost),
            'order_date' => $this->formatPhilippineIso($order->order_date),
            'order_date_label' => $this->formatPhilippineLabel($order->order_date),
            'customer' => $customerName,
            'payment' => self::WALKIN_PAYMENT_METHOD,
            'payment_method' => self::WALKIN_PAYMENT_METHOD,
            'total' => (float) $order->total,
            'total_label' => $this->formatMoney((float) $order->total),
            'status' => $order->status,
            'created_at' => $this->formatPhilippineIso($order->created_at),
        ];
    }

    private function validatePayload(Request $request, ?int $walkInOrderId = null): array
    {
        $orderNoRule = 'required|string|max:80|unique:walk_in_orders,order_no';
        if (!is_null($walkInOrderId)) {
            $orderNoRule .= ',' . $walkInOrderId;
        }

        return $request->validate([
            'order_no' => $orderNoRule,
            'customer_name' => 'required|string|max:160',
            'address' => 'required|string|max:255',
            'contact_number' => 'required|string|max:40',
            'client_type' => 'required|in:' . implode(',', self::ALLOWED_CLIENT_TYPES),
            'client_type_other' => 'nullable|string|max:180|required_if:client_type,OTHERS (SPECIFY)',
            'agency_organization' => 'required|string|max:180',
            'project_description' => 'required|in:' . implode(',', self::ALLOWED_PROJECT_DESCRIPTIONS),
            'project_description_other' => 'nullable|string|max:180|required_if:project_description,OTHERS (SPECIFY)',
            'item_detail' => 'required|string|max:300',
            'unit' => 'required|string|max:50',
            'subtotal_cost' => 'required|numeric|min:0|max:9999999.99',
            'total' => 'required|numeric|min:0|max:9999999.99',
            'order_date' => 'nullable|date',
            'status' => 'nullable|string|max:40',
        ]);
    }

    private function normalizeOtherField(string $selected, ?string $otherText): ?string
    {
        if (strtoupper(trim($selected)) !== 'OTHERS (SPECIFY)') {
            return null;
        }

        $normalized = trim((string) $otherText);
        return $normalized === '' ? null : $normalized;
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
