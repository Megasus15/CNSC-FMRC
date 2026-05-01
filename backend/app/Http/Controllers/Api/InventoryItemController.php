<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class InventoryItemController extends Controller
{
    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    private const CATEGORIES = [
        'Consumable Materials',
        'Office Supplies',
        'Inventory Tools',
        'Electronics and Electrical Equipments',
    ];

    /**
     * List all inventory items, with optional category/search filters.
     */
    public function index(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $query = InventoryItem::query()->orderByDesc('id');

        if ($category = $request->query('category')) {
            $query->where('category', $category);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('item_name', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%");
            });
        }

        $items = $query->get();

        // Summary counts per category
        $allItems = InventoryItem::query()->get();
        $summary = [
            'total_items'   => $allItems->count(),
            'good'          => $allItems->where('status', 'Good')->count(),
            'low_stock'     => $allItems->where('status', 'Low Stock')->count(),
            'out_of_stock'  => $allItems->where('status', 'Out of Stock')->count(),
            'categories'    => [],
        ];

        foreach (self::CATEGORIES as $cat) {
            $catItems = $allItems->where('category', $cat);
            $summary['categories'][] = [
                'name'  => $cat,
                'total' => $catItems->count(),
                'good'  => $catItems->where('status', 'Good')->count(),
                'low'   => $catItems->where('status', 'Low Stock')->count(),
                'out'   => $catItems->where('status', 'Out of Stock')->count(),
            ];
        }

        return response()->json([
            'data'    => $items->map(fn (InventoryItem $item) => $this->transformRow($item))->values(),
            'summary' => $summary,
        ]);
    }

    /**
     * Create a new inventory item.
     */
    public function store(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'category'    => 'required|string|max:100',
            'item_name'   => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
            'unit'        => 'required|string|max:50',
            'on_hand'     => 'required|integer|min:0',
            'remarks'     => 'nullable|string|max:200',
        ]);

        $onHand = (int) ($validated['on_hand'] ?? 0);
        $status = $this->computeStatus($onHand);

        $item = InventoryItem::query()->create([
            'category'           => trim($validated['category']),
            'item_name'          => trim($validated['item_name']),
            'description'        => trim($validated['description'] ?? ''),
            'unit'               => trim($validated['unit']),
            'last_invent'        => $onHand,
            'on_hand'            => $onHand,
            'status'             => $status,
            'remarks'            => trim($validated['remarks'] ?? ''),
            'created_by_user_id' => $request->user()?->id,
        ]);

        return response()->json([
            'message' => 'Inventory item added successfully.',
            'data'    => $this->transformRow($item),
        ], 201);
    }

    /**
     * Update an existing inventory item.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $item = InventoryItem::query()->find($id);
        if (!$item) {
            return response()->json(['message' => 'Inventory item not found.'], 404);
        }

        $validated = $request->validate([
            'category'    => 'required|string|max:100',
            'item_name'   => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
            'unit'        => 'required|string|max:50',
            'on_hand'     => 'nullable|integer|min:0',
            'remarks'     => 'nullable|string|max:200',
        ]);

        $onHand = isset($validated['on_hand']) ? (int) $validated['on_hand'] : (int) $item->on_hand;
        $status = $this->computeStatus($onHand);

        $item->update([
            'category'    => trim($validated['category']),
            'item_name'   => trim($validated['item_name']),
            'description' => trim($validated['description'] ?? ''),
            'unit'        => trim($validated['unit']),
            'last_invent' => $onHand,
            'on_hand'     => $onHand,
            'status'      => $status,
            'remarks'     => trim($validated['remarks'] ?? ''),
        ]);

        return response()->json([
            'message' => 'Inventory item updated successfully.',
            'data'    => $this->transformRow($item->refresh()),
        ]);
    }

    /**
     * Deduct stocks from an item.
     */
    public function deduct(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'deduct_amount' => 'required|integer|min:1',
            'name'          => 'nullable|string|max:255',
            'purpose'       => 'nullable|string|max:500',
            'remarks'       => 'nullable|string|max:500',
        ]);

        $item = DB::transaction(function () use ($id, $validated) {
            $lockedItem = InventoryItem::query()->whereKey($id)->lockForUpdate()->first();
            if (!$lockedItem) {
                return null;
            }

            $deduct = (int) $validated['deduct_amount'];
            if ($deduct > $lockedItem->on_hand) {
                return 'exceeds';
            }

            $lockedItem->on_hand = $lockedItem->on_hand - $deduct;
            $lockedItem->status = $this->computeStatus($lockedItem->on_hand);
            $lockedItem->save();

            return $lockedItem->refresh();
        });

        if ($item === null) {
            return response()->json(['message' => 'Inventory item not found.'], 404);
        }
        if ($item === 'exceeds') {
            return response()->json(['message' => 'Deduct amount cannot exceed current stocks on hand.'], 422);
        }

        // Note: name/purpose/remarks are not stored on the inventory row per requirements.

        return response()->json([
            'message' => 'Stocks deducted successfully.',
            'data'    => $this->transformRow($item->refresh()),
        ]);
    }

    /**
     * Delete an inventory item.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $item = InventoryItem::query()->find($id);
        if (!$item) {
            return response()->json(['message' => 'Inventory item not found.'], 404);
        }

        $item->delete();

        return response()->json([
            'message' => 'Inventory item deleted successfully.',
        ]);
    }

    // ─── Helpers ────────────────────────────────────────────────────────

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

    private function transformRow(InventoryItem $item): array
    {
        return [
            'id'          => (int) $item->id,
            'category'    => $item->category,
            'item_name'   => $item->item_name,
            'description' => $item->description,
            'unit'        => $item->unit,
            'last_invent' => (int) $item->last_invent,
            'on_hand'     => (int) $item->on_hand,
            'status'      => $item->status,
            'remarks'     => $item->remarks,
            'created_at'  => $item->created_at?->toIso8601String(),
            'updated_at'  => $item->updated_at?->toIso8601String(),
        ];
    }

    private function computeStatus(int $onHand): string
    {
        if ($onHand <= 0) return 'Out of Stock';
        if ($onHand <= 5) return 'Low Stock';
        return 'Good';
    }
}
