<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Announcement;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

class ArchiveController extends Controller
{
    private const ALLOWED_ADMIN_ROLES = ['admin', 'staff'];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $module = strtolower($request->query('module', 'all'));

        $inventory   = collect();
        $appointments = collect();
        $orders      = collect();
        $promotions  = collect();
        $announcements = collect();

        try {
            // ── Inventory Items ────────────────────────────────────────────────
            if ($module === 'all' || $module === 'inventory') {
                $inventory = InventoryItem::query()
                    ->where('is_archived', true)
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (InventoryItem $item) => [
                        'id'           => 'inv-' . $item->id,
                        'source_id'    => $item->id,
                        'module'       => 'inventory',
                        // Matches the Inventory table columns exactly
                        'category'     => $item->category ?? '—',
                        'item_name'    => $item->item_name ?? '—',
                        'description'  => $item->description ?? '—',
                        'unit'         => $item->unit ?? '—',
                        'on_hand'      => $item->on_hand ?? 0,
                        'status'       => $item->status ?? '—',
                        'remarks'      => $item->remarks ?? '—',
                        'variants'     => $item->variants ?? [],
                        'has_variants' => !empty($item->variants),
                        'archived_at'  => $item->archived_at?->toIso8601String(),
                        'created_at'   => $item->created_at?->toIso8601String(),
                    ]);
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: inventory fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // ── Appointments ───────────────────────────────────────────────────
            if ($module === 'all' || $module === 'appointment') {
                $appointments = Appointment::query()
                    ->where('status', 'Archived')
                    ->orderByDesc('updated_at')
                    ->get()
                    ->map(function (Appointment $a) {
                        $mi = trim((string) ($a->middle_initial ?? ''));
                        $mi = $mi ? rtrim($mi, '.') . '.' : '';
                        $clientName = implode(' ', array_filter([
                            trim((string) $a->first_name),
                            $mi,
                            trim((string) $a->last_name),
                        ])) ?: '—';

                        // Format appointment date same as the Appointments table
                        $apptDate = $a->appointment_date ? \Carbon\Carbon::parse($a->appointment_date)->format('M d, Y') : '—';

                        // Format reference_no same as the Appointments table
                        $refNo = $a->reference_no ?? '—';

                        return [
                            'id'               => 'appt-' . $a->id,
                            'source_id'        => $a->id,
                            'module'           => 'appointment',
                            // Matches the Appointments table columns exactly
                            'reference_no'     => $refNo,
                            'client_name'      => $clientName,
                            'contact_number'   => $a->contact_number ?? '—',
                            'email'            => $a->email ?? '—',
                            'full_address'     => $a->full_address ?? '—',
                            'client_type'      => $a->client_type ?? '—',
                            'purpose'          => $a->purpose ?? '—',
                            'appointment_date' => $apptDate,
                            'appointment_time' => $a->appointment_time ?? '—',
                            'status'           => $a->status ?? '—',
                            'archived_at'      => $a->updated_at?->toIso8601String(),
                            'created_at'       => $a->created_at?->toIso8601String(),
                        ];
                    });
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: appointments fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            // ── Orders ─────────────────────────────────────────────────────────
            if ($module === 'all' || $module === 'order') {
                $orders = Order::query()
                    ->with(['items'])
                    ->where('is_archived', true)
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(function (Order $o) {
                        $productName = $o->items->last()?->product_name ?? 'Custom Order';
                        $totalLabel  = '₱ ' . number_format((float) ($o->total ?? 0), 2, '.', ',');

                        return [
                            'id'               => 'ord-' . $o->id,
                            'source_id'        => $o->id,
                            'module'           => 'order',
                            // Matches the Orders Directory table columns exactly
                            'order_no'         => $o->order_no ?? "ORD-{$o->id}",
                            'order_item'       => $productName,
                            'date'             => $o->created_at?->format('M d, Y') ?? '—',
                            'customer_name'    => $o->customer_name ?? '—',
                            'payment_method'   => $o->payment?->method ?? $o->payment_method ?? 'WALKIN VIA CASHIER',
                            'total'            => (float) ($o->total ?? 0),
                            'total_label'      => $totalLabel,
                            'lifecycle_status' => ucfirst($o->lifecycle_status ?? '—'),
                            'archived_at'      => $o->archived_at?->toIso8601String(),
                            'created_at'       => $o->created_at?->toIso8601String(),
                        ];
                    });
            }
        } catch (\Throwable $e) {
            Log::error('ArchiveController: orders fetch failed', ['error' => $e->getMessage()]);
        }

        try {
            if ($module === 'all' || $module === 'promotion') {
                $promotions = Promotion::query()
                    ->where('is_archived', true)
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (Promotion $promotion) => [
                        'id' => 'promo-' . $promotion->id,
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
                $announcements = Announcement::query()
                    ->where('is_archived', true)
                    ->orderByDesc('archived_at')
                    ->get()
                    ->map(fn (Announcement $announcement) => [
                        'id' => 'announcement-' . $announcement->id,
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

        return response()->json([
            'inventory'    => $inventory->values(),
            'appointments' => $appointments->values(),
            'orders'       => $orders->values(),
            'promotions'   => $promotions->values(),
            'announcements'=> $announcements->values(),
        ]);
    }

    public function restoreBulk(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $validated = $request->validate([
            'module' => ['required', 'string', Rule::in(['inventory', 'appointment', 'order', 'promotion', 'announcement'])],
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
                'promotion' => Promotion::query()->whereIn('id', $ids)->where('is_archived', true),
                'announcement' => Announcement::query()->whereIn('id', $ids)->where('is_archived', true),
            };

            $eligibleIds = (clone $query)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if (!$eligibleIds) {
                return [];
            }

            $updates = match ($module) {
                'inventory', 'order', 'promotion', 'announcement' => [
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

        if (!$restoredIds) {
            return response()->json(['message' => 'No archived records were found to restore in this section.'], 404);
        }

        return response()->json([
            'action' => 'restore',
            'scope' => $module,
            'processed_ids' => $restoredIds,
            'processed_count' => count($restoredIds),
            'skipped_ids' => array_values(array_diff($ids, $restoredIds)),
            'message' => count($restoredIds) . ' archived record(s) restored successfully.',
        ]);
    }

    public function deleteBulk(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $validated = $request->validate([
            'module' => ['required', 'string', Rule::in(['inventory', 'appointment', 'order', 'promotion', 'announcement'])],
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
                'promotion' => Promotion::query()->whereIn('id', $ids)->where('is_archived', true),
                'announcement' => Announcement::query()->whereIn('id', $ids)->where('is_archived', true),
            };

            $eligibleIds = (clone $query)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if (!$eligibleIds) {
                return [];
            }

            $query->whereIn('id', $eligibleIds)->delete();
            return $eligibleIds;
        });

        if (!$deletedIds) {
            return response()->json(['message' => 'No archived records were found to delete.'], 404);
        }

        return response()->json([
            'action' => 'delete',
            'scope' => $module,
            'processed_ids' => $deletedIds,
            'processed_count' => count($deletedIds),
            'skipped_ids' => array_values(array_diff($ids, $deletedIds)),
            'deleted_count' => count($deletedIds),
            'message' => count($deletedIds) . ' archived record(s) permanently deleted.',
        ]);
    }

    public function autoDelete(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role, self::ALLOWED_ADMIN_ROLES, true)) {
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
            Log::warning('Auto-delete inventory failed: ' . $e->getMessage());
        }

        try {
            // Appointments
            $totalDeleted += Appointment::query()
                ->where('status', 'Archived')
                ->where('updated_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete appointments failed: ' . $e->getMessage());
        }

        try {
            // Orders
            $totalDeleted += Order::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete orders failed: ' . $e->getMessage());
        }

        try {
            // Promotions
            $totalDeleted += Promotion::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete promotions failed: ' . $e->getMessage());
        }

        try {
            // Announcements
            $totalDeleted += Announcement::query()
                ->where('is_archived', true)
                ->where('archived_at', '<=', $cutoffDate)
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Auto-delete announcements failed: ' . $e->getMessage());
        }

        return response()->json([
            'action' => 'auto-delete',
            'retention_days' => $retentionDays,
            'deleted_count' => $totalDeleted,
            'message' => $totalDeleted > 0
                ? $totalDeleted . ' expired archived record(s) permanently deleted.'
                : 'No expired archived records found.',
        ]);
    }
}
