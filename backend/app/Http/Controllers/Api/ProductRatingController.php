<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductRating;
use App\Models\ProductRatingLike;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ProductRatingController extends Controller
{
    /** Customer: submit or update one product review inside a completed order. */
    public function store(Request $request, Order $order): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        $user = $request->user();

        if ((int) $order->customer_id !== (int) $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($order->customer_stage !== 'completed') {
            return response()->json(['message' => 'Only completed orders can be rated.'], 422);
        }

        $validated = $request->validate([
            'order_item_id' => 'required|integer|exists:order_items,id',
            'stars' => 'required|integer|min:1|max:5',
            'feedback' => 'nullable|string|min:30|max:300',
            'post_anonymously' => 'nullable|boolean',
            'media' => 'nullable|array|max:6',
            'media.*' => 'file|mimes:jpg,jpeg,png,webp,gif,mp4,mov,webm|max:20480',
        ]);

        /** @var OrderItem|null $orderItem */
        $orderItem = $order->items()
            ->whereKey((int) $validated['order_item_id'])
            ->first();

        if (!$orderItem) {
            return response()->json([
                'message' => 'That product is not part of this order.',
            ], 422);
        }

        $existing = ProductRating::query()
            ->where('user_id', $user->id)
            ->where('order_item_id', $orderItem->id)
            ->first();

        $uploadedMedia = $this->storeUploadedMedia($request->file('media', []));
        $feedback = array_key_exists('feedback', $validated)
            ? trim((string) ($validated['feedback'] ?? ''))
            : null;

        $rating = DB::transaction(function () use ($existing, $validated, $feedback, $order, $orderItem, $uploadedMedia, $user): ProductRating {
            $rating = ProductRating::query()->updateOrCreate(
                [
                    'user_id' => $user->id,
                    'order_item_id' => $orderItem->id,
                ],
                [
                    'order_id' => $order->id,
                    'product_id' => $orderItem->product_id,
                    'product_name' => $orderItem->product_name ?: 'Custom Order',
                    'stars' => (int) $validated['stars'],
                    'feedback' => $feedback !== '' ? $feedback : null,
                    'media' => $uploadedMedia !== null ? $uploadedMedia : ($existing?->media ?? null),
                    'is_anonymous' => (bool) ($validated['post_anonymously'] ?? false),
                    'is_archived' => false,
                    'archived_at' => null,
                ],
            );

            return $rating->fresh();
        });

        if ($uploadedMedia !== null && $existing?->media) {
            $this->deleteStoredMedia($existing->media);
        }

        return response()->json([
            'message' => 'Review saved.',
            'data' => $this->customerRatingPayload($rating),
        ]);
    }

    /** Customer: get every item review for an order. */
    public function show(Request $request, Order $order): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        if ((int) $order->customer_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $ratings = ProductRating::query()
            ->where('user_id', $request->user()->id)
            ->where('order_id', $order->id)
            ->where('is_archived', false)
            ->orderBy('order_item_id')
            ->get();

        return response()->json([
            'data' => $ratings->map(fn (ProductRating $rating) => $this->customerRatingPayload($rating))->values(),
        ]);
    }

    /** Customer: get all item reviews submitted by this customer. */
    public function customerRatings(Request $request): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        $ratings = ProductRating::query()
            ->where('user_id', $request->user()->id)
            ->where('is_archived', false)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (ProductRating $rating) => $this->customerRatingPayload($rating))
            ->values();

        return response()->json(['data' => $ratings]);
    }

    /** Public customer website: list reviews for one product. */
    public function publicIndex(Request $request, Product $product): JsonResponse
    {
        if ((bool) $product->is_blocked) {
            return response()->json(['message' => 'Product not found.'], 404);
        }

        $validated = $request->validate([
            'stars' => 'nullable|integer|between:1,5',
            'visuals' => 'nullable|boolean',
            'page' => 'nullable|integer|min:1',
        ]);

        $baseQuery = ProductRating::query()
            ->where('product_id', $product->id)
            ->where('is_archived', false);
        $query = (clone $baseQuery)
            ->with('user:id,name')
            ->withCount('likes')
            ->orderByDesc('created_at');

        if (!empty($validated['stars'])) {
            $query->where('stars', (int) $validated['stars']);
        }

        if (!empty($validated['visuals'])) {
            $query->withVisuals();
        }

        /** @var LengthAwarePaginator $reviews */
        $reviews = $query->paginate(10);
        $customer = Auth::guard('sanctum')->user();
        $likedIds = collect();

        if ($customer && $customer->role === 'customer' && $reviews->count() > 0) {
            $likedIds = ProductRatingLike::query()
                ->where('user_id', $customer->id)
                ->whereIn('product_rating_id', $reviews->getCollection()->pluck('id'))
                ->pluck('product_rating_id');
        }

        $counts = (clone $baseQuery)
            ->select('stars', DB::raw('COUNT(*) as aggregate'))
            ->groupBy('stars')
            ->pluck('aggregate', 'stars')
            ->map(fn ($count) => (int) $count);

        return response()->json([
            'data' => $reviews->getCollection()
                ->map(fn (ProductRating $rating) => $this->publicRatingPayload($rating, $likedIds))
                ->values(),
            'meta' => [
                'current_page' => $reviews->currentPage(),
                'last_page' => $reviews->lastPage(),
                'total' => $reviews->total(),
            ],
            'summary' => [
                'total' => (int) $baseQuery->count(),
                'average' => round((float) ($baseQuery->avg('stars') ?? 0), 1),
                'with_visuals' => (int) (clone $baseQuery)->withVisuals()->count(),
                'stars' => [
                    '5' => (int) ($counts[5] ?? 0),
                    '4' => (int) ($counts[4] ?? 0),
                    '3' => (int) ($counts[3] ?? 0),
                    '2' => (int) ($counts[2] ?? 0),
                    '1' => (int) ($counts[1] ?? 0),
                ],
            ],
        ]);
    }

    /** Authenticated customer: persist or remove one review like. */
    public function toggleLike(Request $request, Product $product, ProductRating $rating): JsonResponse
    {
        if ($denied = $this->ensureCustomer($request)) {
            return $denied;
        }

        if ((bool) $product->is_blocked || (int) $rating->product_id !== (int) $product->id || (bool) $rating->is_archived) {
            return response()->json(['message' => 'Review not found.'], 404);
        }

        $result = DB::transaction(function () use ($request, $rating): array {
            $lockedRating = ProductRating::query()
                ->whereKey($rating->id)
                ->lockForUpdate()
                ->firstOrFail();

            $like = ProductRatingLike::query()
                ->where('product_rating_id', $lockedRating->id)
                ->where('user_id', $request->user()->id)
                ->first();

            if ($like) {
                $like->delete();
                $liked = false;
                $likesCount = max(0, (int) $lockedRating->likes_count - 1);
            } else {
                ProductRatingLike::query()->create([
                    'product_rating_id' => $lockedRating->id,
                    'user_id' => $request->user()->id,
                ]);
                $liked = true;
                $likesCount = (int) $lockedRating->likes_count + 1;
            }

            $lockedRating->update(['likes_count' => $likesCount]);

            return [
                'liked' => $liked,
                'likes_count' => $likesCount,
            ];
        });

        return response()->json(['data' => $result]);
    }

    /** Admin/Staff: list all product reviews with pagination. */
    public function adminIndex(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $query = ProductRating::query()
            ->where('is_archived', false)
            ->with([
                'user:id,name,email',
                'order:id,order_no',
            ])
            ->withCount('likes')
            ->orderByDesc('created_at');

        if ($search = trim((string) $request->query('search'))) {
            $query->where(function ($q) use ($search) {
                $q->where('product_name', 'like', "%{$search}%")
                    ->orWhere('feedback', 'like', "%{$search}%")
                    ->orWhereHas('order', fn ($order) => $order->where('order_no', 'like', "%{$search}%"))
                    ->orWhereHas('user', fn ($user) => $user
                        ->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%"));
            });
        }

        if ($stars = $request->query('stars')) {
            $query->where('stars', (int) $stars);
        }

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
        $summaryQuery = ProductRating::query()->where('is_archived', false);

        return response()->json([
            'data' => collect($ratings->items())
                ->map(fn (ProductRating $rating) => $this->adminRatingPayload($rating))
                ->values(),
            'meta' => [
                'current_page' => $ratings->currentPage(),
                'last_page' => $ratings->lastPage(),
                'total' => $ratings->total(),
            ],
            'summary' => [
                'total' => (int) $summaryQuery->count(),
                'avg' => round((float) ($summaryQuery->avg('stars') ?? 0), 1),
                'five' => (int) (clone $summaryQuery)->where('stars', 5)->count(),
                'four' => (int) (clone $summaryQuery)->where('stars', 4)->count(),
                'three' => (int) (clone $summaryQuery)->where('stars', 3)->count(),
                'two' => (int) (clone $summaryQuery)->where('stars', 2)->count(),
                'one' => (int) (clone $summaryQuery)->where('stars', 1)->count(),
                'with_feedback' => (int) (clone $summaryQuery)->whereNotNull('feedback')->where('feedback', '!=', '')->count(),
                'with_media' => (int) (clone $summaryQuery)->withVisuals()->count(),
                'anonymous' => (int) (clone $summaryQuery)->where('is_anonymous', true)->count(),
            ],
        ]);
    }

    /** Admin/Staff: reply to a product review. */
    public function reply(Request $request, ProductRating $rating): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'admin_reply' => 'required|string|max:500',
        ]);

        $rating->update([
            'admin_reply' => trim($validated['admin_reply']),
            'replied_at' => now(),
        ]);

        return response()->json([
            'message' => 'Reply saved.',
            'data' => $this->adminRatingPayload($rating->fresh()->load(['user:id,name,email', 'order:id,order_no'])),
        ]);
    }

    /** Admin/Staff: return all non-archived rating IDs matching current filters (for "select all across pages"). */
    public function adminAllIds(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $query = ProductRating::query()
            ->where('is_archived', false)
            ->orderByDesc('created_at');

        if ($search = trim((string) $request->query('search'))) {
            $query->where(function ($q) use ($search) {
                $q->where('product_name', 'like', "%{$search}%")
                    ->orWhere('feedback', 'like', "%{$search}%")
                    ->orWhereHas('order', fn ($order) => $order->where('order_no', 'like', "%{$search}%"))
                    ->orWhereHas('user', fn ($user) => $user
                        ->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%"));
            });
        }

        if ($stars = $request->query('stars')) {
            $query->where('stars', (int) $stars);
        }

        if ($replied = $request->query('replied')) {
            if ($replied === 'yes') {
                $query->whereNotNull('admin_reply')->where('admin_reply', '!=', '');
            } elseif ($replied === 'no') {
                $query->where(function ($q) {
                    $q->whereNull('admin_reply')->orWhere('admin_reply', '');
                });
            }
        }

        $ids = $query->pluck('id')->map(fn ($id) => (int) $id)->values()->all();

        return response()->json(['ids' => $ids]);
    }

    /** Admin/Staff: move selected product reviews to the unified Archives page. */
    public function archiveBulk(Request $request): JsonResponse
    {
        if ($denied = $this->ensureAdminOrStaff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $archivedIds = DB::transaction(function () use ($ids): array {
            $query = ProductRating::query()
                ->whereIn('id', $ids)
                ->where('is_archived', false);
            $eligibleIds = $query->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values()
                ->all();

            if (!$eligibleIds) {
                return [];
            }

            $query->whereIn('id', $eligibleIds)->update([
                'is_archived' => true,
                'archived_at' => now(),
                'updated_at' => now(),
            ]);

            return $eligibleIds;
        });

        if (!$archivedIds) {
            return response()->json(['message' => 'No active product reviews were found to archive.'], 404);
        }

        return response()->json([
            'action' => 'archive',
            'scope' => 'rating',
            'processed_ids' => $archivedIds,
            'processed_count' => count($archivedIds),
            'skipped_ids' => array_values(array_diff($ids, $archivedIds)),
            'message' => count($archivedIds) . ' product review(s) archived successfully.',
        ]);
    }

    private function ensureCustomer(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || ($user->role ?? null) !== 'customer') {
            return response()->json(['message' => 'Customer access is required.'], 403);
        }

        return null;
    }

    private function ensureAdminOrStaff(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user || !in_array($user->role ?? '', ['admin', 'staff'], true)) {
            return response()->json(['message' => 'Forbidden. Admin or staff access is required.'], 403);
        }

        return null;
    }

    /** @return array<int, array<string, mixed>>|null */
    private function storeUploadedMedia(array|\Illuminate\Http\UploadedFile|null $files): ?array
    {
        $files = is_array($files) ? $files : ($files ? [$files] : []);
        if (!$files) {
            return null;
        }

        return collect($files)
            ->filter(fn ($file) => $file instanceof \Illuminate\Http\UploadedFile && $file->isValid())
            ->map(function (\Illuminate\Http\UploadedFile $file): array {
                $path = $file->store('product-reviews', 'public');

                return [
                    'path' => $path,
                    'url' => Storage::disk('public')->url($path),
                    'type' => str_starts_with((string) $file->getMimeType(), 'video/') ? 'video' : 'image',
                    'mime' => $file->getMimeType(),
                    'name' => $file->getClientOriginalName(),
                    'size' => $file->getSize(),
                ];
            })
            ->values()
            ->all();
    }

    private function deleteStoredMedia(?array $media): void
    {
        foreach ($media ?? [] as $item) {
            if (!empty($item['path'])) {
                Storage::disk('public')->delete($item['path']);
            }
        }
    }

    private function customerRatingPayload(ProductRating $rating): array
    {
        return [
            'id' => $rating->id,
            'order_id' => $rating->order_id,
            'order_item_id' => $rating->order_item_id,
            'product_id' => $rating->product_id,
            'product_name' => $rating->product_name,
            'stars' => (int) $rating->stars,
            'feedback' => $rating->feedback,
            'media' => $this->publicMediaPayload($rating->media),
            'is_anonymous' => (bool) $rating->is_anonymous,
            'likes_count' => (int) ($rating->likes_count ?? 0),
            'admin_reply' => $rating->admin_reply,
            'replied_at' => $rating->replied_at?->toIso8601String(),
            'created_at' => $rating->created_at?->toIso8601String(),
            'updated_at' => $rating->updated_at?->toIso8601String(),
        ];
    }

    private function publicRatingPayload(ProductRating $rating, $likedIds): array
    {
        return [
            'id' => $rating->id,
            'product_id' => $rating->product_id,
            'product_name' => $rating->product_name,
            'stars' => (int) $rating->stars,
            'feedback' => $rating->feedback,
            'media' => $this->publicMediaPayload($rating->media),
            'author_name' => $rating->is_anonymous
                ? 'Anonymous customer'
                : ($rating->user?->name ?: 'Customer'),
            'is_anonymous' => (bool) $rating->is_anonymous,
            'likes_count' => (int) ($rating->likes_count ?? 0),
            'liked_by_me' => $likedIds->contains($rating->id),
            'admin_reply' => $rating->admin_reply,
            'replied_at' => $rating->replied_at?->toIso8601String(),
            'created_at' => $rating->created_at?->toIso8601String(),
        ];
    }

    private function adminRatingPayload(ProductRating $rating): array
    {
        return [
            'id' => $rating->id,
            'order_id' => $rating->order_id,
            'order_item_id' => $rating->order_item_id,
            'product_id' => $rating->product_id,
            'product_name' => $rating->product_name,
            'stars' => (int) $rating->stars,
            'feedback' => $rating->feedback,
            'media' => $this->publicMediaPayload($rating->media),
            'media_count' => count($rating->media ?? []),
            'is_anonymous' => (bool) $rating->is_anonymous,
            'likes_count' => (int) ($rating->likes_count ?? 0),
            'admin_reply' => $rating->admin_reply,
            'replied_at' => $rating->replied_at?->toIso8601String(),
            'created_at' => $rating->created_at?->toIso8601String(),
            'user' => $rating->user ? [
                'id' => $rating->user->id,
                'name' => $rating->user->name,
                'email' => $rating->user->email,
            ] : null,
            'order' => $rating->order ? [
                'id' => $rating->order->id,
                'order_no' => $rating->order->order_no,
            ] : null,
        ];
    }

    private function publicMediaPayload(?array $media): array
    {
        return collect($media ?? [])
            ->map(fn ($item) => [
                'url' => $this->publicMediaUrl($item),
                'type' => $item['type'] ?? 'image',
                'mime' => $item['mime'] ?? null,
                'name' => $item['name'] ?? null,
                'size' => $item['size'] ?? null,
            ])
            ->filter(fn ($item) => !empty($item['url']))
            ->values()
            ->all();
    }

    /**
     * Resolve a stored media item to a URL the current host can actually load.
     *
     * The absolute URL saved at upload time is baked from APP_URL, so a review
     * uploaded while APP_URL pointed elsewhere would hand the browser a dead
     * link. Rebuild from the stored relative path against the incoming request
     * host whenever the path is available.
     */
    private function publicMediaUrl(array $item): ?string
    {
        $path = trim((string) ($item['path'] ?? ''), '/');
        if ($path !== '') {
            return url('/storage/' . $path);
        }

        return $item['url'] ?? null;
    }
}
