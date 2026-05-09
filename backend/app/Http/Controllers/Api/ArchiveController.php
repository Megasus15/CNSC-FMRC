<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

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

        return response()->json([
            'inventory'    => $inventory->values(),
            'appointments' => $appointments->values(),
            'orders'       => $orders->values(),
        ]);
    }
}
