<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Support\CustomerOrderHistory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CustomerOrderHistoryController extends Controller
{
    public function destroy(Request $request, Order $order): JsonResponse
    {
        return $this->remove($request, [(int) $order->id], false);
    }

    public function clear(Request $request): JsonResponse
    {
        $data = $request->validate(['order_ids' => ['required', 'array', 'min:1', 'max:1000'], 'order_ids.*' => ['required', 'integer', 'min:1', 'distinct']]);
        return $this->remove($request, $data['order_ids'], true);
    }

    private function remove(Request $request, array $ids, bool $bulk): JsonResponse
    {
        abort_unless(strtolower((string) $request->user()?->role) === 'customer', 403, 'Only customers can manage their own order history.');
        abort_unless(CustomerOrderHistory::available(), 503, 'Order history removal is not available until the database update finishes.');
        $result = DB::transaction(function () use ($request, $ids) {
            $orders = Order::whereIn('id', $ids)->where('customer_id', $request->user()->id)->orderBy('id')->lockForUpdate()->get();
            abort_unless($orders->count() === count($ids), 403, 'One or more orders are unavailable for this account.');
            CustomerOrderHistory::prime($orders);
            $removed = []; $skipped = [];
            foreach ($orders as $order) {
                $state = CustomerOrderHistory::state($order);
                if (!$order->customer_hidden_at && !$state['eligible']) {
                    $skipped[] = ['id' => $order->id, 'reason' => $state['reason'], 'code' => $state['code']];
                    continue;
                }
                // Do not touch updated_at: hiding is not order or financial activity.
                if (!$order->customer_hidden_at) DB::table('orders')->where('id', $order->id)->update(['customer_hidden_at' => now()]);
                $removed[] = $order->id;
            }
            return ['removed_ids' => $removed, 'skipped' => $skipped];
        });
        $message = !$bulk && $result['skipped'] ? $result['skipped'][0]['reason']
            : count($result['removed_ids']).' order(s) removed from My Orders. FMRC retains the transaction records.';
        return response()->json(['message' => $message, ...$result], !$bulk && $result['skipped'] ? 409 : 200)
            ->withHeaders(['Cache-Control' => 'private, no-store']);
    }
}
