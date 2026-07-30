<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\ProductRating;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductRatingController extends Controller
{
    /** Customer: submit or update a rating for a completed order */
    public function store(Request $request, Order $order): JsonResponse
    {
        $user = $request->user();

        if ((int) $order->customer_id !== (int) $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($order->customer_stage !== 'completed') {
            return response()->json(['message' => 'Only completed orders can be rated.'], 422);
        }

        $validated = $request->validate([
            'stars'    => 'required|integer|min:1|max:5',
            'feedback' => 'nullable|string|max:75',
        ]);

        $order->loadMissing('items');
        $firstItem = $order->items->first();

        $rating = ProductRating::updateOrCreate(
            ['user_id' => $user->id, 'order_id' => $order->id],
            [
                'product_id'   => $firstItem?->product_id,
                'product_name' => $firstItem?->product_name ?? 'Custom Order',
                'stars'        => $validated['stars'],
                'feedback'     => $validated['feedback'] ?? null,
            ]
        );

        return response()->json(['message' => 'Rating saved.', 'data' => $rating], 200);
    }

    /** Customer: get existing rating for an order */
    public function show(Request $request, Order $order): JsonResponse
    {
        $user = $request->user();

        if ((int) $order->customer_id !== (int) $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $rating = ProductRating::where('user_id', $user->id)
            ->where('order_id', $order->id)
            ->first();

        return response()->json(['data' => $rating]);
    }

    /** Customer: get all ratings submitted by this customer */
    public function customerRatings(Request $request): JsonResponse
    {
        $user = $request->user();
        $ratings = ProductRating::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->get();
        return response()->json(['data' => $ratings]);
    }

    /** Admin/Staff: list all ratings with pagination */
    public function adminIndex(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!in_array($user->role ?? '', ['admin', 'staff'])) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $query = ProductRating::with('user:id,name,email')
            ->orderByDesc('created_at');

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('product_name', 'like', "%{$search}%")
                  ->orWhere('feedback', 'like', "%{$search}%")
                  ->orWhereHas('user', fn($u) => $u->where('name', 'like', "%{$search}%")
                      ->orWhere('email', 'like', "%{$search}%"));
            });
        }

        if ($stars = $request->query('stars')) {
            $query->where('stars', (int) $stars);
        }

        // Filter by replied status: 'yes' = has reply, 'no' = no reply
        if ($replied = $request->query('replied')) {
            if ($replied === 'yes') {
                $query->whereNotNull('admin_reply')->where('admin_reply', '!=', '');
            } elseif ($replied === 'no') {
                $query->where(function ($q) {
                    $q->whereNull('admin_reply')->orWhere('admin_reply', '');
                });
            }
        }

        $ratings = $query->paginate(10);

        $summary = [
            'total'         => ProductRating::count(),
            'avg'           => round(ProductRating::avg('stars') ?? 0, 1),
            'five'          => ProductRating::where('stars', 5)->count(),
            'four'          => ProductRating::where('stars', 4)->count(),
            'three'         => ProductRating::where('stars', 3)->count(),
            'two'           => ProductRating::where('stars', 2)->count(),
            'one'           => ProductRating::where('stars', 1)->count(),
            'with_feedback' => ProductRating::whereNotNull('feedback')->where('feedback', '!=', '')->count(),
        ];

        return response()->json([
            'data'    => $ratings->items(),
            'meta'    => [
                'current_page' => $ratings->currentPage(),
                'last_page'    => $ratings->lastPage(),
                'total'        => $ratings->total(),
            ],
            'summary' => $summary,
        ]);
    }

    /** Admin/Staff: reply to a rating */
    public function reply(Request $request, ProductRating $rating): JsonResponse
    {
        $user = $request->user();
        if (!in_array($user->role ?? '', ['admin', 'staff'])) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $validated = $request->validate([
            'admin_reply' => 'required|string|max:500',
        ]);

        $rating->update([
            'admin_reply' => $validated['admin_reply'],
            'replied_at'  => now(),
        ]);

        return response()->json(['message' => 'Reply saved.', 'data' => $rating->fresh()]);
    }
}
