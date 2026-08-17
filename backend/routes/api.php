<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\OrderReturnController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SiteSettingController;
use App\Http\Controllers\Api\ServiceController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\ProductAnalyticsController;
use App\Http\Controllers\Api\WalkInOrderController;
use App\Http\Controllers\Api\InventoryItemController;
use App\Http\Controllers\Api\ArchiveController;
use App\Http\Controllers\Api\CustomerMessageController;
use App\Http\Controllers\Api\PsgcController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\ProductRatingController;
use App\Http\Controllers\Api\PromotionController;
use App\Http\Controllers\Api\AnnouncementController;


// ─── PSGC Address Proxy (public, no auth needed) ──────────────────────────
Route::get('/psgc/regions', [PsgcController::class, 'regions']);
Route::get('/psgc/regions/{regionCode}/provinces', [PsgcController::class, 'provinces']);
Route::get('/psgc/provinces/{provinceCode}/cities-municipalities', [PsgcController::class, 'citiesMunicipalities']);
Route::get('/psgc/cities-municipalities/{cityMunCode}/barangays', [PsgcController::class, 'barangays']);
// ────────────────────────────────────────────────────────────────────────────

Route::post('/login', [AuthController::class, 'login']);
Route::post('/register', [AuthController::class, 'register']);

// Public: Customer password reset (forgot password flow)
Route::post('/forgot-password', [PasswordResetController::class, 'sendResetLink']);
Route::post('/reset-password', [PasswordResetController::class, 'resetPassword']);

Route::get('/appointments', [AppointmentController::class, 'index']);
Route::post('/appointments', [AppointmentController::class, 'store']);
Route::delete('/appointments/{appointment}', [AppointmentController::class, 'destroy']);
Route::patch('/appointments/{appointment}/archive', [AppointmentController::class, 'archive']);
Route::patch('/appointments/{appointment}/unarchive', [AppointmentController::class, 'unarchive']);
Route::get('/appointments/calendar', [AppointmentController::class, 'calendar']);
Route::put('/appointments/calendar', [AppointmentController::class, 'updateCalendar']);
Route::get('/appointments/{reference}/verify', [AppointmentController::class, 'verifyByReference']);

// Public: Customer-facing products (non-blocked only)
Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{product}/reviews', [ProductRatingController::class, 'publicIndex']);
Route::get('/announcements', [AnnouncementController::class, 'publicIndex']);
Route::get('/promotions/active', [PromotionController::class, 'active']);

// Public: Site settings (read-only for customer pages)
Route::get('/site-settings', [SiteSettingController::class, 'index']);

// Public: Services (shared between home "What We Offer" and Services page)
Route::get('/services', [ServiceController::class, 'index']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/users', [AuthController::class, 'getUsers']);
    Route::post('/users', [AuthController::class, 'adminCreateUser']);
    Route::delete('/users/delete-bulk', [AuthController::class, 'adminDeleteUsersBulk']);
    Route::delete('/users/{user}', [AuthController::class, 'adminDeleteUser']);

    Route::patch('/appointments/archive-bulk', [AppointmentController::class, 'archiveBulk']);
    Route::patch('/appointments/{appointment}/complete', [AppointmentController::class, 'markCompleted']);

    Route::get('/customer/profile', [AuthController::class, 'customerProfile']);
    Route::put('/customer/profile', [AuthController::class, 'updateCustomerProfile']);

    Route::post('/orders', [OrderController::class, 'customerStore']);
    Route::get('/customer/orders', [OrderController::class, 'customerIndex']);
    Route::get('/customer/orders/{order}', [OrderController::class, 'customerShow']);
    Route::get('/customer/orders/{order}/items/{orderItem}/image', [OrderController::class, 'customerItemImage']);
    Route::post('/customer/orders/{order}/received', [OrderController::class, 'customerMarkReceived']);

    // Customer: Product ratings (rate a completed order)
    Route::get('/customer/ratings', [ProductRatingController::class, 'customerRatings']);
    Route::get('/customer/orders/{order}/rating', [ProductRatingController::class, 'show']);
    Route::post('/customer/orders/{order}/rating', [ProductRatingController::class, 'store']);
    Route::post('/products/{product}/reviews/{rating}/like', [ProductRatingController::class, 'toggleLike']);

    // Customer: Returns & Refunds (completed orders only, 7-day window)
    Route::get('/customer/returns', [OrderReturnController::class, 'customerIndex']);
    Route::get('/customer/orders/{order}/return/eligibility', [OrderReturnController::class, 'eligibility']);
    Route::post('/customer/orders/{order}/return', [OrderReturnController::class, 'store']);
    Route::get('/customer/returns/{orderReturn}', [OrderReturnController::class, 'customerShow']);
    Route::post('/customer/returns/{orderReturn}/cancel', [OrderReturnController::class, 'cancel']);
    Route::post('/customer/returns/{orderReturn}/shipped', [OrderReturnController::class, 'shipped']);

    // Admin/Staff: Returns & Refunds queue
    Route::get('/admin/returns', [OrderReturnController::class, 'adminIndex']);
    Route::get('/admin/returns/all-ids', [OrderReturnController::class, 'adminAllIds']);
    Route::patch('/admin/returns/archive-bulk', [OrderReturnController::class, 'archiveBulk']);
    Route::get('/admin/returns/{orderReturn}', [OrderReturnController::class, 'adminShow']);
    Route::post('/admin/returns/{orderReturn}/decision', [OrderReturnController::class, 'decision']);
    Route::post('/admin/returns/{orderReturn}/received', [OrderReturnController::class, 'received']);
    Route::post('/admin/returns/{orderReturn}/refund', [OrderReturnController::class, 'refund']);

    // Admin/Staff: Ratings & Feedback
    Route::get('/admin/ratings', [ProductRatingController::class, 'adminIndex']);
    Route::get('/admin/ratings/all-ids', [ProductRatingController::class, 'adminAllIds']);
    Route::patch('/admin/ratings/archive-bulk', [ProductRatingController::class, 'archiveBulk']);
    Route::post('/admin/ratings/{rating}/reply', [ProductRatingController::class, 'reply']);

    Route::get('/customer/cart', [\App\Http\Controllers\CartItemController::class, 'index']);
    Route::post('/customer/cart/sync', [\App\Http\Controllers\CartItemController::class, 'sync']);
    Route::post('/customer/messages', [CustomerMessageController::class, 'store']);

    Route::get('/admin/orders', [OrderController::class, 'adminIndex']);
    Route::get('/admin/dashboard/summary', [AdminDashboardController::class, 'summary']);
    Route::post('/admin/orders/approve-bulk', [OrderController::class, 'approveBulk']);
    Route::post('/admin/orders/reject-bulk', [OrderController::class, 'rejectBulk']);
    Route::patch('/admin/orders/archive-bulk', [OrderController::class, 'archiveBulk']);
    Route::get('/admin/orders/{order}', [OrderController::class, 'adminShow']);
    Route::post('/admin/orders/{order}/approve', [OrderController::class, 'approve']);
    Route::post('/admin/orders/{order}/reject', [OrderController::class, 'reject']);
    Route::post('/admin/orders/{order}/complete', [OrderController::class, 'complete']);
    Route::patch('/admin/orders/{order}/tracking', [OrderController::class, 'updateTracking']);
    Route::patch('/admin/orders/{order}/payment-status', [OrderController::class, 'updatePaymentStatus']);
    Route::patch('/admin/orders/{order}/archive', [OrderController::class, 'adminArchive']);
    Route::patch('/admin/orders/{order}/archive-payment', [OrderController::class, 'adminArchivePayment']);
    Route::patch('/admin/orders/{order}/unarchive', [OrderController::class, 'adminUnarchivePayment']);
    Route::delete('/admin/orders/{order}/payment', [OrderController::class, 'adminDestroyPayment']);
    Route::delete('/admin/orders/{order}', [OrderController::class, 'adminDestroy']);

    Route::get('/admin/walkin-orders', [WalkInOrderController::class, 'index']);
    Route::post('/admin/walkin-orders', [WalkInOrderController::class, 'store']);
    Route::put('/admin/walkin-orders/{id}', [WalkInOrderController::class, 'update']);
    Route::delete('/admin/walkin-orders/{id}', [WalkInOrderController::class, 'destroy']);

    // Admin: Products CRUD
    Route::get('/admin/products', [ProductController::class, 'adminIndex']);
    Route::get('/admin/products/promotion-options', [ProductController::class, 'promotionOptions']);
    Route::get('/admin/products/catalog-options', [ProductController::class, 'catalogOptions']);
    Route::get('/admin/products/names', [ProductController::class, 'productNames']);
    Route::post('/admin/products', [ProductController::class, 'store']);
    Route::delete('/admin/products/delete-bulk', [ProductController::class, 'deleteBulk']);
    Route::put('/admin/products/{product}', [ProductController::class, 'update']);
    Route::delete('/admin/products/{product}', [ProductController::class, 'destroy']);

    // Admin/Staff: time-bound sale campaigns and customer announcements
    Route::get('/admin/promotions', [PromotionController::class, 'index']);
    Route::post('/admin/promotions', [PromotionController::class, 'store']);
    Route::patch('/admin/promotions/archive-bulk', [PromotionController::class, 'archiveBulk']);
    Route::put('/admin/promotions/{promotion}', [PromotionController::class, 'update']);
    Route::delete('/admin/promotions/{promotion}', [PromotionController::class, 'destroy']);
    Route::get('/admin/announcements', [AnnouncementController::class, 'index']);
    Route::post('/admin/announcements', [AnnouncementController::class, 'store']);
    Route::patch('/admin/announcements/archive-bulk', [AnnouncementController::class, 'archiveBulk']);
    Route::put('/admin/announcements/{announcement}', [AnnouncementController::class, 'update']);
    Route::delete('/admin/announcements/{announcement}', [AnnouncementController::class, 'destroy']);

    // Admin: Site Settings
    Route::put('/admin/site-settings', [SiteSettingController::class, 'bulkUpdate']);

    // Admin: Services CRUD
    Route::get('/admin/services', [ServiceController::class, 'adminIndex']);
    Route::post('/admin/services', [ServiceController::class, 'store']);
    Route::put('/admin/services/{service}', [ServiceController::class, 'update']);
    Route::delete('/admin/services/{service}', [ServiceController::class, 'destroy']);

    Route::get('/user', function (Request $request) {
        return $request->user();
    });
    // Update current authenticated user's profile (email)
    Route::put('/user', [AuthController::class, 'updateSelfProfile']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);

    // Admin: Notifications
    Route::get('/admin/notifications', [NotificationController::class, 'index']);
    Route::get('/admin/notifications/unread-count', [NotificationController::class, 'unreadCount']);
    Route::patch('/admin/notifications/{notification}/read', [NotificationController::class, 'markRead']);
    Route::post('/admin/notifications/mark-all-read', [NotificationController::class, 'markAllRead']);
    Route::delete('/admin/notifications/clear-all', [NotificationController::class, 'clearAll']);
    Route::delete('/admin/notifications/{notification}', [NotificationController::class, 'destroy']);

    // Admin/Staff: Customer inquiries from Contact page
    Route::get('/admin/customer-messages', [CustomerMessageController::class, 'index']);
    Route::get('/admin/customer-messages/summary', [CustomerMessageController::class, 'summary']);
    Route::patch('/admin/customer-messages/{customerMessage}/read', [CustomerMessageController::class, 'markRead']);
    Route::patch('/admin/customer-messages/{customerMessage}/resolve', [CustomerMessageController::class, 'resolve']);
    Route::delete('/admin/customer-messages/delete-bulk', [CustomerMessageController::class, 'deleteBulk']);
    Route::delete('/admin/customer-messages/{customerMessage}', [CustomerMessageController::class, 'destroy']);

    // Admin: Product Analytics (real-time order-based)
    Route::get('/admin/product-analytics/top-selling', [ProductAnalyticsController::class, 'topSelling']);
    Route::get('/admin/product-analytics/sales-by-category', [ProductAnalyticsController::class, 'salesByCategory']);
    Route::get('/admin/product-analytics/product-performance', [ProductAnalyticsController::class, 'productPerformance']);
    Route::get('/admin/product-analytics/yearly-sales-trend', [ProductAnalyticsController::class, 'yearlySalesTrend']);

    // Admin: Inventory CRUD + Archive
    Route::get('/admin/inventory', [InventoryItemController::class, 'index']);
    Route::get('/admin/inventory/archived', [InventoryItemController::class, 'archived']);
    Route::get('/admin/inventory/stock-rules', [InventoryItemController::class, 'stockRuleSettings']);
    Route::put('/admin/inventory/stock-rules', [InventoryItemController::class, 'updateStockRuleSettings']);
    Route::post('/admin/inventory', [InventoryItemController::class, 'store']);
    Route::patch('/admin/inventory/archive-bulk', [InventoryItemController::class, 'archiveBulk']);
    Route::put('/admin/inventory/{id}', [InventoryItemController::class, 'update']);
    Route::post('/admin/inventory/{id}/deduct', [InventoryItemController::class, 'deduct']);
    Route::post('/admin/inventory/{id}/adjust', [InventoryItemController::class, 'adjust']);
    Route::patch('/admin/inventory/{id}/archive', [InventoryItemController::class, 'archive']);
    Route::patch('/admin/inventory/{id}/unarchive', [InventoryItemController::class, 'unarchive']);
    Route::get('/admin/inventory/export', [InventoryItemController::class, 'exportCsv']);
    Route::get('/admin/inventory/transactions', [InventoryItemController::class, 'transactions']);
    Route::delete('/admin/inventory/{id}', [InventoryItemController::class, 'destroy']);

    // Admin: Unified Archives page
    Route::patch('/admin/archives/restore-bulk', [ArchiveController::class, 'restoreBulk']);
    Route::delete('/admin/archives/delete-bulk', [ArchiveController::class, 'deleteBulk']);
    Route::post('/admin/archives/auto-delete', [ArchiveController::class, 'autoDelete']);
    Route::get('/admin/archives', [ArchiveController::class, 'index']);
});
