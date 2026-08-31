<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\ProductRating;
use App\Models\ProductRatingLike;
use App\Models\Promotion;
use App\Models\WalkInOrder;
use App\Support\AdminArchiveRecords;
use App\Support\ReturnPresenter;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class ArchiveController extends Controller
{
    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user || ! in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $module = strtolower($request->query('module', 'all'));

        $inventory = collect();
        $appointments = collect();
        $orders = collect();
        $returns = collect();
        $promotions = collect();
        $announcements = collect();
        $ratings = collect();
        $walkins = collect();

        try {
            // ── Inventory Items ────────────────────────────────────────────────
            if ($module === 'all' || $module === 'inventory') {
                $inventory = AdminArchiveRecords::query('inventory')
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (InventoryItem $item) => [
                        'id' => 'inv-'.$item->id,
                        'source_id' => $item->id,
                        'module' => 'inventory',
                        // Matches the Inventory table columns exactly
                        'category' => $item->category ?? '—',
                        'item_name' => $item->item_name ?? '—',
                        'description' => $item->description ?? '—',
                        'unit' => $item->unit ?? '—',
                        'on_hand' => $item->on_hand ?? 0,
                        'status' => $item->status ?? '—',
                        'remarks' => $item->remarks ?? '—',
                        'variants' => $item->variants ?? [],
                        'has_variants' => ! empty($item->variants),
                        'archived_at' => $item->archived_at?->toIso8601String(),
                        'created_at' => $item->created_at?->toIso8601String(),
                    ]);
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: inventory fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // ── Appointments ───────────────────────────────────────────────────
            if ($module === 'all' || $module === 'appointment') {
                $appointments = AdminArchiveRecords::query('appointments')
                    ->orderByDesc('updated_at')
                    ->get()
                    ->map(function (Appointment $a) {
                        $mi = trim((string) ($a->middle_initial ?? ''));
                        $mi = $mi ? rtrim($mi, '.').'.' : '';
                        $clientName = implode(' ', array_filter([
                            trim((string) $a->first_name),
                            $mi,
                            trim((string) $a->last_name),
                        ])) ?: '—';

                        // Format appointment date same as the Appointments table
                        $apptDate = $a->appointment_date ? Carbon::parse($a->appointment_date)->format('M d, Y') : '—';

                        // Format reference_no same as the Appointments table
                        $refNo = $a->reference_no ?? '—';

                        return [
                            'id' => 'appt-'.$a->id,
                            'source_id' => $a->id,
                            'module' => 'appointment',
                            // Matches the Appointments table columns exactly
                            'reference_no' => $refNo,
                            'client_name' => $clientName,
                            'contact_number' => $a->contact_number ?? '—',
                            'email' => $a->email ?? '—',
                            'full_address' => $a->full_address ?? '—',
                            'client_type' => $a->client_type ?? '—',
                            'purpose' => $a->purpose ?? '—',
                            'appointment_date' => $apptDate,
                            'appointment_time' => $a->appointment_time ?? '—',
                            'status' => $a->status ?? '—',
                            'archived_at' => $a->updated_at?->toIso8601String(),
                            'created_at' => $a->created_at?->toIso8601String(),
                        ];
                    });
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: appointments fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // ── Orders ─────────────────────────────────────────────────────────
            if ($module === 'all' || $module === 'order') {
                $orders = AdminArchiveRecords::query('orders')
                    ->with(['items'])
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(function (Order $o) {
                        $productName = $o->items->last()?->product_name ?? 'Custom Order';
                        $totalLabel = '₱ '.number_format((float) ($o->total ?? 0), 2, '.', ',');

                        return [
                            'id' => 'ord-'.$o->id,
                            'source_id' => $o->id,
                            'module' => 'order',
                            // Matches the Orders Directory table columns exactly
                            'order_no' => $o->order_no ?? "ORD-{$o->id}",
                            'order_item' => $productName,
                            'date' => $o->created_at?->format('M d, Y') ?? '—',
                            'customer_name' => $o->customer_name ?? '—',
                            'payment_method' => $o->payment?->method ?? $o->payment_method ?? 'WALKIN VIA CASHIER',
                            'total' => (float) ($o->total ?? 0),
                            'total_label' => $totalLabel,
                            'lifecycle_status' => ucfirst($o->lifecycle_status ?? '—'),
                            'archived_at' => $o->archived_at?->toIso8601String(),
                            'created_at' => $o->created_at?->toIso8601String(),
                        ];
                    });
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: orders fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // ── Returns & Refunds ──────────────────────────────────────────────
            if ($module === 'all' || $module === 'return') {
                $returns = AdminArchiveRecords::query('returns')
                    ->with([
                        'order:id,order_no,customer_name',
                        'customer:id,name,email',
                        'handler:id,name,role',
                        'items',
                    ])
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(function (OrderReturn $orderReturn) {
                        $items = $orderReturn->items;
                        $firstName = $items->first()?->product_name ?: 'Returned item';
                        $extra = max(0, $items->count() - 1);

                        // Show whatever the return actually settled on: the released
                        // refund if there is one, else the approved figure, else what
                        // the customer asked for.
                        $settled = $orderReturn->refunded_amount
                            ?? $orderReturn->approved_amount
                            ?? $orderReturn->requested_amount;

                        return [
                            'id' => 'return-'.$orderReturn->id,
                            'source_id' => $orderReturn->id,
                            'module' => 'return',
                            // Matches the Returns & Refunds table columns exactly
                            'return_no' => $orderReturn->return_no ?: "RTN-{$orderReturn->id}",
                            'order_no' => $orderReturn->order?->order_no ?: "ORD-{$orderReturn->order_id}",
                            'customer_name' => $orderReturn->customer?->name
                                ?: ($orderReturn->order?->customer_name ?: 'Guest customer'),
                            'customer_email' => $orderReturn->customer?->email ?: '',
                            'product_name' => $extra > 0 ? "{$firstName} (+{$extra} more)" : $firstName,
                            'items_count' => $items->count(),
                            'quantity' => (int) $items->sum('quantity'),
                            'reason_label' => $orderReturn->reasonLabel(),
                            'resolution_label' => $orderReturn->resolutionLabel(),
                            'status' => $orderReturn->status,
                            'status_label' => $orderReturn->statusLabel(),
                            'amount' => (float) $settled,
                            'amount_label' => ReturnPresenter::money((float) $settled),
                            'refund_method_label' => $orderReturn->refundMethodLabel(),
                            'refund_reference' => $orderReturn->refund_reference,
                            'handled_by' => $orderReturn->handler?->name,
                            'media_count' => count($orderReturn->media ?? []),
                            'created_at' => $orderReturn->created_at?->toIso8601String(),
                            'archived_at' => $orderReturn->archived_at?->toIso8601String(),
                        ];
                    });
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: order returns fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            if ($module === 'all' || $module === 'promotion') {
                $promotions = AdminArchiveRecords::query('promotions')
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (Promotion $promotion) => [
                        'id' => 'promo-'.$promotion->id,
                        'source_id' => $promotion->id,
                        'module' => 'promotion',
                        'title' => $promotion->title,
                        'discount_percent' => (int) $promotion->discount_percent,
                        'scope' => $promotion->scope,
                        'product_ids' => $promotion->product_ids ?? [],
                        'starts_at' => $promotion->starts_at?->toIso8601String(),
                        'ends_at' => $promotion->ends_at?->toIso8601String(),
                        'is_enabled' => (bool) $promotion->is_enabled,
                        'status' => $promotion->status(),
                        'archived_at' => $promotion->archived_at?->toIso8601String(),
                    ]);
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: promotions fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            if ($module === 'all' || $module === 'announcement') {
                $announcements = AdminArchiveRecords::query('announcements')
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (Announcement $announcement) => [
                        'id' => 'announcement-'.$announcement->id,
                        'source_id' => $announcement->id,
                        'module' => 'announcement',
                        'title' => $announcement->title,
                        'message' => $announcement->message,
                        'placement' => $announcement->placement,
                        'starts_at' => $announcement->starts_at?->toIso8601String(),
                        'ends_at' => $announcement->ends_at?->toIso8601String(),
                        'is_enabled' => (bool) $announcement->is_enabled,
                        'status' => $announcement->status(),
                        'archived_at' => $announcement->archived_at?->toIso8601String(),
                    ]);
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: announcements fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // â”€â”€ Product Reviews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            if ($module === 'all' || $module === 'rating') {
                $ratings = AdminArchiveRecords::query('ratings')
                    ->with([
                        'user:id,name,email',
                        'order:id,order_no',
                    ])
                    ->withCount('likes')
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (ProductRating $rating) => [
                        'id' => 'rating-'.$rating->id,
                        'source_id' => $rating->id,
                        'module' => 'rating',
                        'customer_name' => $rating->user?->name ?: ($rating->user?->email ?: 'Unknown'),
                        'customer_email' => $rating->user?->email ?: '',
                        'product_name' => $rating->product_name ?: 'Custom Order',
                        'order_no' => $rating->order?->order_no ?: "ORD-{$rating->order_id}",
                        'stars' => (int) $rating->stars,
                        'feedback' => $rating->feedback,
                        'admin_reply' => $rating->admin_reply,
                        'is_anonymous' => (bool) $rating->is_anonymous,
                        'likes_count' => (int) ($rating->likes_count ?? 0),
                        'media_count' => count($rating->media ?? []),
                        'created_at' => $rating->created_at?->toIso8601String(),
                        'archived_at' => $rating->archived_at?->toIso8601String(),
                    ]);
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: product ratings fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // ── Walk-in Customers ──────────────────────────────────────────────
            if ($module === 'all' || $module === 'walkin') {
                $walkins = AdminArchiveRecords::query('walkins')
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(function (WalkInOrder $walkIn) {
                        $money = fn ($amount) => '₱ '.number_format((float) ($amount ?? 0), 2, '.', ',');
                        $withOther = function (?string $selected, ?string $other) {
                            $selected = $selected ?: '—';

                            return $other ? "{$selected}: {$other}" : $selected;
                        };

                        return [
                            'id' => 'walkin-'.$walkIn->id,
                            'source_id' => $walkIn->id,
                            'module' => 'walkin',
                            // Matches the Walk-in Customers table columns exactly
                            'order_no' => $walkIn->order_no ?? '—',
                            'customer_name' => $walkIn->customer_name ?: ($walkIn->customer ?: 'Walk-in Customer'),
                            'address' => $walkIn->address ?? '—',
                            'contact_number' => $walkIn->contact_number ?? '—',
                            'client_type' => $withOther($walkIn->client_type, $walkIn->client_type_other),
                            'agency_organization' => $walkIn->agency_organization ?? '—',
                            'project_description' => $withOther($walkIn->project_description, $walkIn->project_description_other),
                            'item_detail' => $walkIn->item_detail ?: ($walkIn->order_item ?: '—'),
                            'unit' => $walkIn->unit ?? '—',
                            'subtotal_cost' => (float) ($walkIn->subtotal_cost ?? 0),
                            'subtotal_cost_label' => $money($walkIn->subtotal_cost ?? $walkIn->total),
                            'total' => (float) ($walkIn->total ?? 0),
                            'total_label' => $money($walkIn->total),
                            'payment' => $walkIn->payment_method ?: 'WALKIN VIA CASHIER',
                            'status' => $walkIn->status ?: 'Pending',
                            'created_at' => $walkIn->created_at?->toIso8601String(),
                            'archived_at' => $walkIn->archived_at?->toIso8601String(),
                        ];
                    });
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: walk-in orders fetch failed', ['error' => $e->getMessage()]);
        }

        return response()->json([
            'inventory' => $inventory->values(),
            'appointments' => $appointments->values(),
            'orders' => $orders->values(),
            'returns' => $returns->values(),
            'promotions' => $promotions->values(),
            'announcements' => $announcements->values(),
            'ratings' => $ratings->values(),
            'walkins' => $walkins->values(),
        ]);
    }

    public function restoreBulk(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user || ! in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $validated = $request->validate([
            'module' => ['required', 'string', Rule::in(['inventory', 'appointment', 'order', 'return', 'promotion', 'announcement', 'rating', 'walkin'])],
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);

        $module = $validated['module'];
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();

        $restoredIds = DB::transaction(function () use ($module, $ids): array {
            $now = now();
            $query = match ($module) {
                'inventory' => InventoryItem::query()->whereIn('id', $ids)->where('is_archived', true),
                'appointment' => Appointment::query()->whereIn('id', $ids)->where('status', 'Archived'),
                'order' => Order::query()->whereIn('id', $ids)->where('is_archived', true),
                'return' => OrderReturn::query()->whereIn('id', $ids)->where('is_archived', true),
                'promotion' => Promotion::query()->whereIn('id', $ids)->where('is_archived', true),
                'announcement' => Announcement::query()->whereIn('id', $ids)->where('is_archived', true),
                'rating' => ProductRating::query()->whereIn('id', $ids)->where('is_archived', true),
                'walkin' => WalkInOrder::query()->whereIn('id', $ids)->where('is_archived', true),
            };

            $eligibleIds = (clone $query)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if (! $eligibleIds) {
                return [];
            }

            $updates = match ($module) {
                'inventory', 'order', 'return', 'promotion', 'announcement', 'rating', 'walkin' => [
                    'is_archived' => false,
                    'archived_at' => null,
                    'updated_at' => $now,
                ],
                'appointment' => [
                    'status' => 'Pending',
                    'updated_at' => $now,
                ],
            };

            $query->whereIn('id', $eligibleIds)->update($updates);

            return $eligibleIds;
        });

        if (! $restoredIds) {
            return response()->json(['message' => 'No archived records were found to restore in this section.'], 404);
        }

        return response()->json([
            'action' => 'restore',
            'scope' => $module,
            'processed_ids' => $restoredIds,
            'processed_count' => count($restoredIds),
            'skipped_ids' => array_values(array_diff($ids, $restoredIds)),
            'message' => count($restoredIds).' archived record(s) restored successfully.',
        ]);
    }

    public function deleteBulk(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user || ! in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $validated = $request->validate([
            'module' => ['required', 'string', Rule::in(['inventory', 'appointment', 'order', 'return', 'promotion', 'announcement', 'rating', 'walkin'])],
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);

        $module = $validated['module'];
        $ids = collect($validated['ids'])->map(fn ($id) => (int) $id)->unique()->values()->all();

        $deletedIds = DB::transaction(function () use ($module, $ids): array {
            $query = match ($module) {
                'inventory' => InventoryItem::query()->whereIn('id', $ids)->where('is_archived', true),
                'appointment' => Appointment::query()->whereIn('id', $ids)->where('status', 'Archived'),
                'order' => Order::query()->whereIn('id', $ids)->where('is_archived', true),
                'return' => OrderReturn::query()->whereIn('id', $ids)->where('is_archived', true),
                'promotion' => Promotion::query()->whereIn('id', $ids)->where('is_archived', true),
                'announcement' => Announcement::query()->whereIn('id', $ids)->where('is_archived', true),
                'rating' => ProductRating::query()->whereIn('id', $ids)->where('is_archived', true),
                // No stock restore here on purpose: an archived walk-in is a sale
                // that already happened, so its goods have left the building.
                // `WalkInOrderController::destroy()` restores stock because that
                // path is for undoing a mistaken entry, which is a different act.
                'walkin' => WalkInOrder::query()->whereIn('id', $ids)->where('is_archived', true),
            };

            $eligibleIds = (clone $query)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if (! $eligibleIds) {
                return [];
            }

            if ($module === 'rating') {
                $ratings = ProductRating::query()->whereIn('id', $eligibleIds)->get();
                foreach ($ratings as $rating) {
                    $this->deleteMediaFiles($rating->media);
                }
                ProductRatingLike::query()->whereIn('product_rating_id', $eligibleIds)->delete();
            }

            if ($module === 'return') {
                // Items and timeline events cascade with the return row; the
                // uploaded evidence has to be swept by hand.
                $returns = OrderReturn::query()->whereIn('id', $eligibleIds)->get();
                foreach ($returns as $orderReturn) {
                    $this->deleteMediaFiles($orderReturn->media);
                }
            }

            $query->whereIn('id', $eligibleIds)->delete();

            return $eligibleIds;
        });

        if (! $deletedIds) {
            return response()->json(['message' => 'No archived records were found to delete.'], 404);
        }

        return response()->json([
            'action' => 'delete',
            'scope' => $module,
            'processed_ids' => $deletedIds,
            'processed_count' => count($deletedIds),
            'skipped_ids' => array_values(array_diff($ids, $deletedIds)),
            'deleted_count' => count($deletedIds),
            'message' => count($deletedIds).' archived record(s) permanently deleted.',
        ]);
    }

    public function autoDelete(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user || ! in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $validated = $request->validate([
            'retention_days' => ['required', 'integer', 'in:30,60,90'],
        ]);

        $retentionDays = (int) $validated['retention_days'];
        $cutoffDate = now()->subDays($retentionDays);

        $totalDeleted = 0;

        try {
            // Inventory
            $totalDeleted += InventoryItem::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete inventory failed: '.$e->getMessage());
        }

        try {
            // Appointments
            $totalDeleted += Appointment::query()
                ->where('status', 'Archived')
                ->where('updated_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete appointments failed: '.$e->getMessage());
        }

        try {
            // Orders
            $totalDeleted += Order::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete orders failed: '.$e->getMessage());
        }

        try {
            // Returns & refunds (including evidence cleanup; items/events cascade)
            $returns = OrderReturn::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->get();
            $returnIds = $returns->pluck('id')->map(fn ($id) => (int) $id)->values();
            foreach ($returns as $orderReturn) {
                $this->deleteMediaFiles($orderReturn->media);
            }
            if ($returnIds->isNotEmpty()) {
                $totalDeleted += OrderReturn::query()->whereIn('id', $returnIds->all())->delete();
            }
        } catch (\Throwable $e) {
            Log::warning('Auto-delete order returns failed: '.$e->getMessage());
        }

        try {
            // Promotions
            $totalDeleted += Promotion::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete promotions failed: '.$e->getMessage());
        }

        try {
            // Announcements
            $totalDeleted += Announcement::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete announcements failed: '.$e->getMessage());
        }

        try {
            // Product reviews (including attachment cleanup)
            $ratings = ProductRating::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->get();
            $ratingIds = $ratings->pluck('id')->map(fn ($id) => (int) $id)->values();
            foreach ($ratings as $rating) {
                $this->deleteMediaFiles($rating->media);
            }
            if ($ratingIds->isNotEmpty()) {
                ProductRatingLike::query()->whereIn('product_rating_id', $ratingIds->all())->delete();
                $totalDeleted += ProductRating::query()->whereIn('id', $ratingIds->all())->delete();
            }
        } catch (\Throwable $e) {
            Log::warning('Auto-delete product ratings failed: '.$e->getMessage());
        }

        try {
            // Walk-in customers. Plain delete - no stock restore, same reasoning as
            // the manual delete path above.
            $totalDeleted += WalkInOrder::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete walk-in orders failed: '.$e->getMessage());
        }

        return response()->json([
            'action' => 'auto-delete',
            'retention_days' => $retentionDays,
            'deleted_count' => $totalDeleted,
            'message' => $totalDeleted > 0
                ? $totalDeleted.' expired archived record(s) permanently deleted.'
                : 'No expired archived records found.',
        ]);
    }

    /** Sweeps the uploaded files behind a media JSON column (ratings, return evidence). */
    private function deleteMediaFiles(?array $media): void
    {
        foreach ($media ?? [] as $item) {
            if (! empty($item['path'])) {
                Storage::disk('public')->delete($item['path']);
            }
        }
    }
}
