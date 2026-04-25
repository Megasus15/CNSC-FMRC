<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class CartItemController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        $cartItems = \App\Models\CartItem::where('user_id', $user->id)
            ->get()
            ->map(function ($item) {
                return [
                    'id' => $item->id,
                    'title' => $item->title,
                    'image' => $item->image,
                    'unitPrice' => (float)$item->unit_price,
                    'quantity' => (int)$item->quantity,
                    'checked' => (bool)$item->checked,
                ];
            });

        return response()->json(['data' => $cartItems]);
    }

    public function sync(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        $validated = $request->validate([
            'items' => 'array',
            'items.*.title' => 'required|string',
            'items.*.image' => 'nullable|string',
            'items.*.unitPrice' => 'required|numeric',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.checked' => 'boolean',
        ]);

        \DB::transaction(function () use ($user, $validated) {
            // Remove old cart items
            \App\Models\CartItem::where('user_id', $user->id)->delete();

            // Insert new cart items
            $itemsToInsert = [];
            $now = now();
            foreach ($validated['items'] ?? [] as $item) {
                $itemsToInsert[] = [
                    'user_id' => $user->id,
                    'title' => $item['title'],
                    'image' => $item['image'] ?? null,
                    'unit_price' => $item['unitPrice'],
                    'quantity' => $item['quantity'],
                    'checked' => $item['checked'] ?? true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            if (!empty($itemsToInsert)) {
                \App\Models\CartItem::insert($itemsToInsert);
            }
        });

        return response()->json(['message' => 'Cart synced successfully']);
    }
}
