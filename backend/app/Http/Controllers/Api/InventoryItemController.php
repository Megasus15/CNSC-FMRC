<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\SiteSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

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
     * Key used to persist the admin-managed stock level rules.
     */
    private const STOCK_RULES_KEY = 'inventory_stock_rules';

    private const STOCK_RULE_MODES = ['fixed', 'percent'];

    /**
     * Cached copy of the resolved stock rules for the current request.
     */
    private ?array $cachedStockRules = null;

    /**
     * List all inventory items, with optional category/search filters.
     */
    public function index(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $query = InventoryItem::query()->where('is_archived', false)->orderByDesc('id');

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
        $allItems = InventoryItem::query()->where('is_archived', false)->get();

        return response()->json([
            'data'    => $items->map(fn (InventoryItem $item) => $this->transformRow($item))->values(),
            'summary' => $this->buildSummary($allItems),
        ]);
    }

    /**
     * Return all archived inventory items.
     */
    public function archived(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $items = InventoryItem::query()
            ->where('is_archived', true)
            ->orderByDesc('archived_at')
            ->get();

        return response()->json([
            'data' => $items->map(fn (InventoryItem $item) => $this->transformRow($item))->values(),
        ]);
    }

    /**
     * Archive multiple active inventory items in one request.
     */
    public function archiveBulk(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'category' => ['required', 'string', Rule::in(self::CATEGORIES)],
            'ids'      => ['required', 'array', 'min:1'],
            'ids.*'    => ['integer', 'min:1', 'distinct'],
        ]);

        $category = $validated['category'];
        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $archivedAt = now();
        $archivedIds = DB::transaction(function () use ($category, $ids, $archivedAt): array {
            $activeIds = InventoryItem::query()
                ->whereIn('id', $ids)
                ->where('category', $category)
                ->where('is_archived', false)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if ($activeIds) {
                InventoryItem::query()
                    ->whereIn('id', $activeIds)
                    ->where('category', $category)
                    ->where('is_archived', false)
                    ->update([
                        'is_archived' => true,
                        'archived_at' => $archivedAt,
                        'updated_at'  => now(),
                    ]);
            }

            return $activeIds;
        });

        if (!$archivedIds) {
            return response()->json([
                'message' => 'No active inventory items were found to archive.',
            ], 404);
        }

        return response()->json([
            'message'       => count($archivedIds) . ' inventory item(s) archived successfully.',
            'category'      => $category,
            'archived_ids'  => $archivedIds,
            'archived_count'=> count($archivedIds),
            'skipped_ids'   => array_values(array_diff($ids, $archivedIds)),
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
            'category'              => 'required|string|max:100',
            'item_name'             => 'required|string|max:255',
            'description'           => 'nullable|string|max:500',
            'unit'                  => 'required|string|max:50',
            'on_hand'               => 'required|integer|min:0',
            'remarks'               => 'nullable|string|max:200',
            'variants'              => 'nullable|array',
            'variants.*.id'         => 'nullable|integer|min:1',
            'variants.*.name'       => 'required_with:variants|string|max:255',
            'variants.*.description'=> 'nullable|string|max:500',
            'variants.*.unit'       => 'required_with:variants|string|max:50',
            'variants.*.on_hand'    => 'required_with:variants|integer|min:0',
            'variants.*.remarks'    => 'nullable|string|max:200',
        ]);

        $category = trim($validated['category']);
        $itemName = trim($validated['item_name']);

        $exists = InventoryItem::query()
            ->where('category', $category)
            ->where('item_name', $itemName)
            ->exists();

        if ($exists) {
            return response()->json([
                'message' => "The item '{$itemName}' is already registered under the '{$category}' category. Please enter a unique item name to avoid duplicates.",
            ], 422);
        }

        $onHand = (int) ($validated['on_hand'] ?? 0);
        $variants = $this->normalizeVariants($validated['variants'] ?? []);

        $item = InventoryItem::query()->create([
            'category'           => trim($validated['category']),
            'item_name'          => trim($validated['item_name']),
            'description'        => trim($validated['description'] ?? ''),
            'unit'               => trim($validated['unit']),
            'last_invent'        => $onHand,
            'on_hand'            => $onHand,
            'status'             => $this->computeStatus($onHand, $category, 0, null, $onHand),
            'remarks'            => trim($validated['remarks'] ?? ''),
            'variants'           => $variants,
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
            'category'              => 'required|string|max:100',
            'item_name'             => 'required|string|max:255',
            'description'           => 'nullable|string|max:500',
            'unit'                  => 'required|string|max:50',
            'on_hand'               => 'nullable|integer|min:0',
            'remarks'               => 'nullable|string|max:200',
            'variants'              => 'nullable|array',
            'variants.*.id'         => 'nullable|integer|min:1',
            'variants.*.name'       => 'required_with:variants|string|max:255',
            'variants.*.description'=> 'nullable|string|max:500',
            'variants.*.unit'       => 'required_with:variants|string|max:50',
            'variants.*.on_hand'    => 'required_with:variants|integer|min:0',
            'variants.*.remarks'    => 'nullable|string|max:200',
        ]);

        $category = trim($validated['category']);
        $itemName = trim($validated['item_name']);

        $exists = InventoryItem::query()
            ->where('category', $category)
            ->where('item_name', $itemName)
            ->where('id', '!=', $id)
            ->exists();

        if ($exists) {
            return response()->json([
                'message' => "The item '{$itemName}' is already registered under the '{$category}' category. Please enter a unique item name to avoid duplicates.",
            ], 422);
        }

        $onHand = isset($validated['on_hand']) ? (int) $validated['on_hand'] : (int) $item->on_hand;
        $variants = array_key_exists('variants', $validated)
            ? $this->normalizeVariants($validated['variants'] ?? [], $item->variants ?? [])
            : $this->normalizeVariants($item->variants ?? []);

        $item->update([
            'category'    => trim($validated['category']),
            'item_name'   => trim($validated['item_name']),
            'description' => trim($validated['description'] ?? ''),
            'unit'        => trim($validated['unit']),
            'last_invent' => $onHand,
            'on_hand'     => $onHand,
            'status'      => $this->computeStatus($onHand, $category, (int) $item->id, null, $onHand),
            'remarks'     => trim($validated['remarks'] ?? ''),
            'variants'    => $variants,
        ]);

        return response()->json([
            'message' => 'Inventory item updated successfully.',
            'data'    => $this->transformRow($item->refresh()),
        ]);
    }

    /**
     * Deduct stocks from an item or variant.
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
            'variant_id'    => 'nullable|integer|min:1',
        ]);

        $result = DB::transaction(function () use ($id, $validated) {
            $lockedItem = InventoryItem::query()->whereKey($id)->lockForUpdate()->first();
            if (!$lockedItem) {
                return null;
            }

            $deduct = (int) $validated['deduct_amount'];
            $variantId = isset($validated['variant_id']) ? (int) $validated['variant_id'] : null;

            if ($variantId) {
                $variants = $this->normalizeVariants($lockedItem->variants ?? []);
                $variantIndex = null;
                foreach ($variants as $index => $variant) {
                    if ((int) ($variant['id'] ?? 0) === $variantId) {
                        $variantIndex = $index;
                        break;
                    }
                }

                if ($variantIndex === null) {
                    return 'variant_not_found';
                }

                $variantOnHand = (int) ($variants[$variantIndex]['on_hand'] ?? 0);
                if ($deduct > $variantOnHand) {
                    return 'exceeds';
                }

                $variants[$variantIndex]['on_hand'] = $variantOnHand - $deduct;
                $variants[$variantIndex]['status'] = $this->computeStatus(
                    (int) $variants[$variantIndex]['on_hand'],
                    $lockedItem->category,
                    (int) $lockedItem->id,
                    $variantId,
                    (int) ($variants[$variantIndex]['initial_on_hand'] ?? $variantOnHand)
                );
                $lockedItem->variants = $variants;
                $lockedItem->save();

                return $lockedItem->refresh();
            }

            if ($deduct > $lockedItem->on_hand) {
                return 'exceeds';
            }

            $lockedItem->on_hand = $lockedItem->on_hand - $deduct;
            $lockedItem->status = $this->computeStatus(
                (int) $lockedItem->on_hand,
                $lockedItem->category,
                (int) $lockedItem->id,
                null,
                (int) ($lockedItem->last_invent ?: $lockedItem->on_hand)
            );
            $lockedItem->save();

            return $lockedItem->refresh();
        });

        if ($result === null) {
            return response()->json(['message' => 'Inventory item not found.'], 404);
        }
        if ($result === 'exceeds') {
            return response()->json(['message' => 'Deduct amount cannot exceed current stocks on hand.'], 422);
        }
        if ($result === 'variant_not_found') {
            return response()->json(['message' => 'Inventory variant not found.'], 404);
        }

        return response()->json([
            'message' => 'Stocks deducted successfully.',
            'data'    => $this->transformRow($result),
        ]);
    }

    /**
     * Adjust stocks (add or deduct) — records inventory_transactions and updates item/variant.
     */
    public function adjust(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        $validated = $request->validate([
            'adjust_amount' => 'required|integer|not_in:0',
            'name'          => 'nullable|string|max:255',
            'purpose'       => 'nullable|string|max:500',
            'remarks'       => 'nullable|string|max:500',
            'variant_id'    => 'nullable|integer|min:1',
        ]);

        $result = DB::transaction(function () use ($id, $validated, $request) {
            $lockedItem = InventoryItem::whereKey($id)->lockForUpdate()->first();
            if (!$lockedItem) return null;

            $delta = (int) $validated['adjust_amount'];
            $variantId = isset($validated['variant_id']) ? (int) $validated['variant_id'] : null;
            $variants = $this->normalizeVariants($lockedItem->variants ?? []);
            $hasVariants = !empty($variants);

            if ($hasVariants && !$variantId) {
                return 'variant_required';
            }

            if (!$hasVariants && $variantId) {
                return 'variant_not_found';
            }

            if ($variantId) {
                $variantIndex = null;
                foreach ($variants as $index => $variant) {
                    if ((int) ($variant['id'] ?? 0) === $variantId) {
                        $variantIndex = $index; break;
                    }
                }

                if ($variantIndex === null) return 'variant_not_found';

                $current = (int) ($variants[$variantIndex]['on_hand'] ?? 0);
                $new = $current + $delta;
                if ($new < 0) return 'exceeds';

                $variants[$variantIndex]['on_hand'] = $new;
                $variants[$variantIndex]['status'] = $this->computeStatus(
                    $new,
                    $lockedItem->category,
                    (int) $lockedItem->id,
                    $variantId,
                    (int) ($variants[$variantIndex]['initial_on_hand'] ?? $new)
                );
                $lockedItem->variants = $variants;
                $lockedItem->save();

                // record transaction
                InventoryTransaction::create([
                    'inventory_item_id' => $lockedItem->id,
                    'variant_id' => $variantId,
                    'type' => $delta > 0 ? 'in' : 'out',
                    'amount' => abs($delta),
                    'name' => trim((string) ($validated['name'] ?? '')),
                    'purpose' => trim((string) ($validated['purpose'] ?? '')),
                    'remarks' => trim((string) ($validated['remarks'] ?? '')),
                    'created_by_user_id' => $request->user()?->id,
                ]);

                return $lockedItem->refresh();
            }

            $current = (int) $lockedItem->on_hand;
            $new = $current + $delta;
            if ($new < 0) return 'exceeds';

            $lockedItem->on_hand = $new;
            $lockedItem->status = $this->computeStatus(
                $new,
                $lockedItem->category,
                (int) $lockedItem->id,
                null,
                (int) ($lockedItem->last_invent ?: $new)
            );
            $lockedItem->save();

            InventoryTransaction::create([
                'inventory_item_id' => $lockedItem->id,
                'variant_id' => null,
                'type' => $delta > 0 ? 'in' : 'out',
                'amount' => abs($delta),
                'name' => trim((string) ($validated['name'] ?? '')),
                'purpose' => trim((string) ($validated['purpose'] ?? '')),
                'remarks' => trim((string) ($validated['remarks'] ?? '')),
                'created_by_user_id' => $request->user()?->id,
            ]);

            return $lockedItem->refresh();
        });

        if ($result === null) return response()->json(['message' => 'Inventory item not found.'], 404);
        if ($result === 'exceeds') return response()->json(['message' => 'Adjustment would result in negative stocks.'], 422);
    if ($result === 'variant_required') return response()->json(['message' => 'Please choose a variant to adjust for items with variants.'], 422);
        if ($result === 'variant_not_found') return response()->json(['message' => 'Inventory variant not found.'], 404);

        return response()->json([
            'message' => 'Stocks adjusted successfully.',
            'data' => $this->transformRow($result),
        ]);
    }

    /**
     * Export inventory transactions and balances as CSV for Excel.
     */
    public function exportCsv(Request $request)
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) return $denied;

        $inRows = InventoryTransaction::where('type', 'in')->orderBy('created_at')->get();
        $outRows = InventoryTransaction::where('type', 'out')->orderBy('created_at')->get();

        $items = InventoryItem::all();

        $lines = [];
        // Header for STOCK IN
        $lines[] = ['STOCK IN'];
        $lines[] = ['No', 'Date', 'Item Name', 'Description', 'Stock'];
        $no = 1;
        foreach ($inRows as $row) {
            $item = InventoryItem::find($row->inventory_item_id);
            $name = $item ? $item->item_name : '—';
            $desc = $item ? $item->description : '—';
            $lines[] = [$no++, $row->created_at->toDateString(), $name, $desc, $row->amount];
        }

        $lines[] = [];
        // Header for STOCK OUT
        $lines[] = ['STOCK OUT'];
        $lines[] = ['No', 'Date', 'Item Name', 'Description', 'Stock'];
        $no = 1;
        foreach ($outRows as $row) {
            $item = InventoryItem::find($row->inventory_item_id);
            $name = $item ? $item->item_name : '—';
            $desc = $item ? $item->description : '—';
            $lines[] = [$no++, $row->created_at->toDateString(), $name, $desc, $row->amount];
        }

        $lines[] = [];
        // Header for BALANCE STOCK
        $lines[] = ['BALANCE STOCK'];
        $lines[] = ['No', 'Date', 'Item Name', 'Description', 'Stock'];
        $no = 1;
        foreach ($items as $item) {
            // base item
            $lines[] = [$no++, $item->updated_at?->toDateString() ?? $item->created_at->toDateString(), $item->item_name, $item->description ?? '—', $item->on_hand];
            // variants
            foreach ($this->normalizeVariants($item->variants ?? []) as $variant) {
                $lines[] = ['', $item->updated_at?->toDateString() ?? $item->created_at->toDateString(), $item->item_name . ' — ' . $variant['name'], $variant['description'] ?? '—', $variant['on_hand']];
            }
        }

        $callback = function() use ($lines) {
            $out = fopen('php://output', 'w');
            foreach ($lines as $row) {
                fputcsv($out, $row);
            }
            fclose($out);
        };

        $filename = 'inventory_export_' . date('Ymd_His') . '.csv';
        return response()->stream($callback, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * Return stock adjustment transactions for real-time export builders.
     */
    public function transactions(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'item_id' => 'nullable|integer|min:1',
            'category' => 'nullable|string|max:100',
        ]);

        $itemId = isset($validated['item_id']) ? (int) $validated['item_id'] : null;
        $category = isset($validated['category']) ? trim((string) $validated['category']) : null;

        $query = InventoryTransaction::query()->orderBy('created_at');

        if ($itemId) {
            $query->where('inventory_item_id', $itemId);
        } elseif ($category) {
            $itemIds = InventoryItem::query()->where('category', $category)->pluck('id');
            $query->whereIn('inventory_item_id', $itemIds);
        }

        $rows = $query->get()->map(function (InventoryTransaction $tx) {
            $item = InventoryItem::query()->find($tx->inventory_item_id);
            if (!$item) {
                return null;
            }

            $itemName = $item->item_name;
            $description = $item->description ?: '—';

            if ($tx->variant_id) {
                $variant = collect($this->normalizeVariants($item->variants ?? []))
                    ->first(fn ($v) => (int) ($v['id'] ?? 0) === (int) $tx->variant_id);
                if ($variant) {
                    $itemName = $item->item_name . ' — ' . ($variant['name'] ?? 'Variant');
                    $description = $variant['description'] ?: '—';
                }
            }

            $amount = (int) $tx->amount;
            $signedAmount = $tx->type === 'out' ? -$amount : $amount;

            return [
                'id' => (int) $tx->id,
                'inventory_item_id' => (int) $tx->inventory_item_id,
                'variant_id' => $tx->variant_id ? (int) $tx->variant_id : null,
                'item_name' => $itemName,
                'description' => $description,
                'type' => $tx->type,
                'amount' => $amount,
                'signed_amount' => $signedAmount,
                'name' => $tx->name ?: '—',
                'purpose' => $tx->purpose ?: '—',
                'remarks' => $tx->remarks ?: '—',
                'created_at' => $tx->created_at?->toIso8601String(),
            ];
        })->filter()->values();

        return response()->json([
            'data' => $rows,
        ]);
    }

    /**
     * Archive an inventory item (soft-archive: hide from main list).
     */
    public function archive(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $item = InventoryItem::query()->find($id);
        if (!$item) {
            return response()->json(['message' => 'Inventory item not found.'], 404);
        }

        $item->is_archived = true;
        $item->archived_at = now();
        $item->save();

        return response()->json([
            'message' => 'Inventory item archived successfully.',
            'data'    => $this->transformRow($item),
        ]);
    }

    /**
     * Restore (un-archive) an inventory item.
     */
    public function unarchive(Request $request, int $id): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $item = InventoryItem::query()->find($id);
        if (!$item) {
            return response()->json(['message' => 'Inventory item not found.'], 404);
        }

        $item->is_archived = false;
        $item->archived_at = null;
        $item->save();

        return response()->json([
            'message' => 'Inventory item restored successfully.',
            'data'    => $this->transformRow($item),
        ]);
    }

    /**
     * Permanently delete an inventory item.
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
        $variants = $this->normalizeVariants($item->variants ?? []);
        $itemRule = $this->resolveStockRule($item->category, (int) $item->id, null);
        $itemBaseline = (int) ($item->last_invent ?: $item->on_hand);
        $itemThreshold = $this->resolveLowThreshold($itemRule, $itemBaseline);

        $variants = array_map(function (array $variant) use ($item) {
            $variantRule = $this->resolveStockRule(
                $item->category,
                (int) $item->id,
                (int) ($variant['id'] ?? 0)
            );
            $variantBaseline = (int) ($variant['initial_on_hand'] ?? $variant['on_hand'] ?? 0);
            $variant['status'] = $this->statusFor((int) ($variant['on_hand'] ?? 0), $variantBaseline, $variantRule);
            $variant['stock_rule'] = $variantRule;
            $variant['low_threshold'] = $this->resolveLowThreshold($variantRule, $variantBaseline);

            return $variant;
        }, $variants);

        return [
            'id'          => (int) $item->id,
            'category'    => $item->category,
            'item_name'   => $item->item_name,
            'description' => $item->description,
            'unit'        => $item->unit,
            'last_invent' => (int) $item->last_invent,
            'on_hand'     => (int) $item->on_hand,
            'status'      => $this->statusFor((int) $item->on_hand, $itemBaseline, $itemRule),
            'stock_rule'  => $itemRule,
            'low_threshold' => $itemThreshold,
            'remarks'     => $item->remarks,
            'variants'    => $variants,
            'has_variants'=> !empty($variants),
            'is_archived' => (bool) $item->is_archived,
            'archived_at' => $item->archived_at?->toIso8601String(),
            'created_at'  => $item->created_at?->toIso8601String(),
            'updated_at'  => $item->updated_at?->toIso8601String(),
        ];
    }

    private function buildSummary($items): array
    {
        $flattened = [];

        foreach ($items as $item) {
            $itemRule = $this->resolveStockRule($item->category, (int) $item->id, null);
            $flattened[] = [
                'status' => $this->statusFor(
                    (int) $item->on_hand,
                    (int) ($item->last_invent ?: $item->on_hand),
                    $itemRule
                ),
            ];

            foreach ($this->normalizeVariants($item->variants ?? []) as $variant) {
                $variantRule = $this->resolveStockRule(
                    $item->category,
                    (int) $item->id,
                    (int) ($variant['id'] ?? 0)
                );
                $flattened[] = [
                    'status' => $this->statusFor(
                        (int) ($variant['on_hand'] ?? 0),
                        (int) ($variant['initial_on_hand'] ?? $variant['on_hand'] ?? 0),
                        $variantRule
                    ),
                ];
            }
        }

        return [
            'total_items'  => count($items),
            'good'         => collect($flattened)->where('status', 'Good')->count(),
            'low_stock'    => collect($flattened)->where('status', 'Low Stock')->count(),
            'out_of_stock' => collect($flattened)->where('status', 'Out of Stock')->count(),
            'categories'   => [],
        ];
    }

    private function normalizeVariants(array $variants, array $existingVariants = []): array
    {
        $normalized = [];
        $nextId = 1;

        foreach ($existingVariants as $variant) {
            $existingId = (int) ($variant['id'] ?? 0);
            if ($existingId >= $nextId) {
                $nextId = $existingId + 1;
            }
        }

        foreach ($variants as $variant) {
            $id = (int) ($variant['id'] ?? 0);
            if ($id < 1) {
                $id = $nextId++;
            } elseif ($id >= $nextId) {
                $nextId = $id + 1;
            }

            $onHand = (int) ($variant['on_hand'] ?? 0);
            $initialOnHand = array_key_exists('initial_on_hand', $variant)
                ? (int) ($variant['initial_on_hand'] ?? $onHand)
                : $onHand;
            $normalized[] = [
                'id'          => $id,
                'name'        => trim((string) ($variant['name'] ?? '')),
                'description' => trim((string) ($variant['description'] ?? '')),
                'unit'        => trim((string) ($variant['unit'] ?? 'pcs')),
                'on_hand'     => $onHand,
                'initial_on_hand' => $initialOnHand,
                'status'      => $this->computeStatus($onHand),
                'remarks'     => trim((string) ($variant['remarks'] ?? '')),
            ];
        }

        return $normalized;
    }

    /**
     * Compute the stored status column value using the admin-managed rules.
     *
     * The extra arguments are optional so existing call sites keep working;
     * when they are supplied the resolution honours the variant → item →
     * category → global precedence.
     */
    private function computeStatus(
        int $onHand,
        ?string $category = null,
        int $itemId = 0,
        ?int $variantId = null,
        ?int $baseline = null
    ): string {
        $rule = $this->resolveStockRule($category, $itemId, $variantId);

        return $this->statusFor($onHand, $baseline ?? $onHand, $rule);
    }

    // ─── Stock level rules ───────────────────────────────────────────────

    /**
     * Default rule applied when no admin override exists.
     */
    private function defaultStockRule(): array
    {
        return [
            'mode'      => 'fixed',
            'threshold' => 5,
        ];
    }

    /**
     * Read (and normalize) the persisted stock rules payload.
     *
     * Shape:
     * [
     *   'global'     => ['mode' => 'fixed', 'threshold' => 5],
     *   'categories' => ['Office Supplies' => ['mode' => 'percent', 'threshold' => 20]],
     *   'items'      => ['12' => ['mode' => 'fixed', 'threshold' => 3]],
     *   'variants'   => ['12:2' => ['mode' => 'fixed', 'threshold' => 1]],
     * ]
     */
    private function stockRules(): array
    {
        if ($this->cachedStockRules !== null) {
            return $this->cachedStockRules;
        }

        $raw = SiteSetting::get(self::STOCK_RULES_KEY);
        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);
        if (!is_array($decoded)) {
            $decoded = [];
        }

        $this->cachedStockRules = [
            'global'     => $this->sanitizeRule($decoded['global'] ?? null) ?? $this->defaultStockRule(),
            'categories' => $this->sanitizeRuleMap($decoded['categories'] ?? []),
            'items'      => $this->sanitizeRuleMap($decoded['items'] ?? []),
            'variants'   => $this->sanitizeRuleMap($decoded['variants'] ?? []),
        ];

        return $this->cachedStockRules;
    }

    private function sanitizeRuleMap($map): array
    {
        if (!is_array($map)) {
            return [];
        }

        $clean = [];
        foreach ($map as $key => $value) {
            $rule = $this->sanitizeRule($value);
            if ($rule !== null) {
                $clean[(string) $key] = $rule;
            }
        }

        return $clean;
    }

    private function sanitizeRule($rule): ?array
    {
        if (!is_array($rule)) {
            return null;
        }

        $mode = strtolower(trim((string) ($rule['mode'] ?? 'fixed')));
        if (!in_array($mode, self::STOCK_RULE_MODES, true)) {
            $mode = 'fixed';
        }

        if (!array_key_exists('threshold', $rule) || $rule['threshold'] === null || $rule['threshold'] === '') {
            return null;
        }

        $threshold = (int) $rule['threshold'];
        if ($threshold < 0) {
            $threshold = 0;
        }
        if ($mode === 'percent' && $threshold > 100) {
            $threshold = 100;
        }

        return [
            'mode'      => $mode,
            'threshold' => $threshold,
        ];
    }

    /**
     * Resolve the effective rule for an item/variant using the precedence
     * variant → item → category → global.
     */
    private function resolveStockRule(?string $category, int $itemId, ?int $variantId): array
    {
        $rules = $this->stockRules();

        if ($variantId) {
            $variantKey = "{$itemId}:{$variantId}";
            if (isset($rules['variants'][$variantKey])) {
                return $rules['variants'][$variantKey] + ['scope' => 'variant'];
            }
        }

        if ($itemId && isset($rules['items'][(string) $itemId])) {
            return $rules['items'][(string) $itemId] + ['scope' => 'item'];
        }

        $categoryKey = trim((string) $category);
        if ($categoryKey !== '' && isset($rules['categories'][$categoryKey])) {
            return $rules['categories'][$categoryKey] + ['scope' => 'category'];
        }

        return $rules['global'] + ['scope' => 'global'];
    }

    /**
     * Turn a rule into an absolute "low stock at or below" quantity.
     */
    private function resolveLowThreshold(array $rule, int $baseline): int
    {
        $threshold = (int) ($rule['threshold'] ?? 0);

        if (($rule['mode'] ?? 'fixed') === 'percent') {
            $baseline = max(0, $baseline);

            return (int) floor(($baseline * $threshold) / 100);
        }

        return max(0, $threshold);
    }

    /**
     * Compute the stock status using the admin-managed rules.
     */
    private function statusFor(int $onHand, int $baseline, array $rule): string
    {
        if ($onHand <= 0) {
            return 'Out of Stock';
        }

        return $onHand <= $this->resolveLowThreshold($rule, $baseline)
            ? 'Low Stock'
            : 'Good';
    }

    /**
     * Return the current stock rules plus the option lists the modal needs.
     */
    public function stockRuleSettings(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $rules = $this->stockRules();

        $items = InventoryItem::query()
            ->where('is_archived', false)
            ->orderBy('category')
            ->orderBy('item_name')
            ->get()
            ->map(function (InventoryItem $item) {
                $variants = $this->normalizeVariants($item->variants ?? []);

                return [
                    'id'        => (int) $item->id,
                    'category'  => $item->category,
                    'item_name' => $item->item_name,
                    'unit'      => $item->unit,
                    'on_hand'   => (int) $item->on_hand,
                    'baseline'  => (int) ($item->last_invent ?: $item->on_hand),
                    'variants'  => array_map(fn (array $variant) => [
                        'id'       => (int) $variant['id'],
                        'name'     => $variant['name'],
                        'unit'     => $variant['unit'],
                        'on_hand'  => (int) $variant['on_hand'],
                        'baseline' => (int) ($variant['initial_on_hand'] ?? $variant['on_hand']),
                    ], $variants),
                ];
            })
            ->values();

        return response()->json([
            'data' => [
                'global'           => $rules['global'],
                'categories'       => $rules['categories'],
                'items'            => $rules['items'],
                'variants'         => $rules['variants'],
                'modes'            => self::STOCK_RULE_MODES,
                'category_options' => self::CATEGORIES,
                'items_index'      => $items,
            ],
        ]);
    }

    /**
     * Persist the stock rules. Omitting a threshold removes that override.
     */
    public function updateStockRuleSettings(Request $request): JsonResponse
    {
        $denied = $this->ensureAdmin($request);
        if ($denied) {
            return $denied;
        }

        $validated = $request->validate([
            'global'                 => ['required', 'array'],
            'global.mode'            => ['required', 'string', Rule::in(self::STOCK_RULE_MODES)],
            'global.threshold'       => ['required', 'integer', 'min:0', 'max:1000000'],
            'categories'             => ['nullable', 'array'],
            'categories.*.mode'      => ['nullable', 'string', Rule::in(self::STOCK_RULE_MODES)],
            'categories.*.threshold' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'items'                  => ['nullable', 'array'],
            'items.*.mode'           => ['nullable', 'string', Rule::in(self::STOCK_RULE_MODES)],
            'items.*.threshold'      => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'variants'               => ['nullable', 'array'],
            'variants.*.mode'        => ['nullable', 'string', Rule::in(self::STOCK_RULE_MODES)],
            'variants.*.threshold'   => ['nullable', 'integer', 'min:0', 'max:1000000'],
        ]);

        $global = $this->sanitizeRule($validated['global']) ?? $this->defaultStockRule();

        $payload = [
            'global'     => ['mode' => $global['mode'], 'threshold' => $global['threshold']],
            'categories' => $this->sanitizeRuleMap($validated['categories'] ?? []),
            'items'      => $this->sanitizeRuleMap($validated['items'] ?? []),
            'variants'   => $this->sanitizeRuleMap($validated['variants'] ?? []),
        ];

        // Keep only categories the system recognises.
        $payload['categories'] = array_filter(
            $payload['categories'],
            fn ($_, $category) => in_array($category, self::CATEGORIES, true),
            ARRAY_FILTER_USE_BOTH
        );

        SiteSetting::set(self::STOCK_RULES_KEY, json_encode($payload));
        $this->cachedStockRules = null;

        // Re-stamp the persisted status column so other modules stay in sync.
        InventoryItem::query()
            ->where('is_archived', false)
            ->get()
            ->each(function (InventoryItem $item) {
                $rule = $this->resolveStockRule($item->category, (int) $item->id, null);
                $item->status = $this->statusFor(
                    (int) $item->on_hand,
                    (int) ($item->last_invent ?: $item->on_hand),
                    $rule
                );
                $item->save();
            });

        return response()->json([
            'message' => 'Stock level rules saved successfully.',
            'data'    => $payload,
        ]);
    }
}
