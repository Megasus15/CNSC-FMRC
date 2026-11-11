<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\{Order, OrderCancellationArchive, Payment};
use App\Support\CancellationHistoryArchive;
use Illuminate\Http\{JsonResponse, Request};
use Illuminate\Support\Facades\DB;

class CancellationArchiveController extends Controller
{
    public function archive(Request $request, Order $order): JsonResponse
    {
        abort_unless(in_array($request->user()?->role, ['admin', 'staff'], true), 403);
        $data = $request->validate(['request_key' => ['required', 'string', 'size:64']]);
        abort_unless(CancellationHistoryArchive::available(), 503, 'Run the cancellation archive migration first.');
        $record = DB::transaction(function () use ($order, $data, $request) {
            $fresh = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $fresh->setRelation('payment', Payment::where('order_id', $fresh->id)->lockForUpdate()->first());
            $state = CancellationHistoryArchive::state($fresh);
            abort_unless($state['request_key'] && hash_equals($state['request_key'], $data['request_key']), 409, 'This cancellation changed. Refresh and review it again.');
            if ($state['archived']) return $fresh->getRelation('cancellationArchiveRecord');
            abort_unless($state['allowed'], 422, $state['reason']);
            return OrderCancellationArchive::updateOrCreate(['request_key' => $data['request_key']], [
                'order_id' => $fresh->id, 'snapshot' => CancellationHistoryArchive::snapshot($fresh),
                'archived_at' => now(), 'archived_by' => $request->user()->id, 'restored_at' => null, 'restored_by' => null,
            ]);
        });
        return response()->json(['message' => 'Cancellation archived. The order and its payment records are kept.', 'data' => ['id' => $record->id, 'order_id' => $order->id, 'request_key' => $record->request_key, 'archived' => true]]);
    }
}
