<?php

use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\AdminRecoveryController;
use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\ArchiveController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CustomerMessageController;
use App\Http\Controllers\Api\HomeSdgController;
use App\Http\Controllers\Api\InventoryItemController;
use App\Http\Controllers\Api\MaintenanceController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\OrderReturnController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\ProductAnalyticsController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ProductRatingController;
use App\Http\Controllers\Api\PromotionController;
use App\Http\Controllers\Api\PsgcController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ServiceController;
use App\Http\Controllers\Api\SiteSettingController;
use App\Http\Controllers\Api\StaffAccountRequestController;
use App\Http\Controllers\Api\WalkInOrderController;
use App\Http\Controllers\CartItemController;
use App\Http\Middleware\EnsureNotUnderMaintenance;
use App\Http\Middleware\VerifyTurnstile;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// ─── PSGC Address Proxy (public, no auth needed) ──────────────────────────
Route::get('/psgc/regions', [PsgcController::class, 'regions']);
Route::get('/psgc/regions/{regionCode}/provinces', [PsgcController::class, 'provinces']);
Route::get('/psgc/provinces/{provinceCode}/cities-municipalities', [PsgcController::class, 'citiesMunicipalities']);
Route::get('/psgc/cities-municipalities/{cityMunCode}/barangays', [PsgcController::class, 'barangays']);
// ────────────────────────────────────────────────────────────────────────────

Route::get('/security-config', function () {
    $siteKey = trim((string) config('services.turnstile.site_key', ''));
    $secretKey = trim((string) config('services.turnstile.secret_key', ''));
    $enabled = (bool) config('services.turnstile.enabled', false)
        && $siteKey !== ''
        && $secretKey !== '';

    return response()->json([
        'turnstile' => [
            'enabled' => $enabled,
            'site_key' => $enabled ? $siteKey : null,
        ],
    ]);
});

// Admin/Staff login. Correct credentials alone are not enough: the Turnstile
// token has to be present and verified by Cloudflare as well.
Route::post('/login', [AuthController::class, 'login'])->middleware(VerifyTurnstile::class);

// Customer authentication routes (protected by Turnstile CAPTCHA)
Route::post('/customer/login', [AuthController::class, 'login'])->middleware(VerifyTurnstile::class);
Route::post('/register', [AuthController::class, 'register'])->middleware([
    VerifyTurnstile::class,
    // Maintenance Mode: with `customer_register` on, no new account can be
    // created even from a page the visitor already had open.
    EnsureNotUnderMaintenance::class . ':customer_register',
]);
Route::post('/auth/google', [AuthController::class, 'googleLogin']);

// Public: apply for a staff account from the Admin/Staff sign-in page.
//
// Carries the same Turnstile guard as /login and /register -- it costs nothing
// until Cloudflare keys are configured and then protects the admin's approval
// queue for free. A second layer (5 accepted submissions per IP per hour) lives
// in the controller. Deliberately NOT behind EnsureNotUnderMaintenance: all 11
// maintenance scopes are customer-facing, and locking staff out of applying
// during maintenance would be the opposite of useful.
Route::post('/staff-account-requests', [StaffAccountRequestController::class, 'store'])
    ->middleware(VerifyTurnstile::class);

// Public: Customer OTP-based password reset (forgot password flow)
Route::post('/forgot-password', [PasswordResetController::class, 'sendOtp']);
Route::post('/forgot-password/send-otp', [PasswordResetController::class, 'sendOtp']);
Route::post('/forgot-password/resend-otp', [PasswordResetController::class, 'resendOtp']);
Route::post('/forgot-password/check-lockout', [PasswordResetController::class, 'checkLockout']);
Route::post('/forgot-password/verify-otp', [PasswordResetController::class, 'verifyOtpAndReset']);
Route::post('/reset-password', [PasswordResetController::class, 'verifyOtpAndReset']);

// Public: admin recovery code -> new password. Stands in for the emailed OTP above
// when the account's Gmail can no longer be reached. Throttled inside the
// controller (5 wrong tries per 30 min per IP+identifier) and every use is
// emailed to the account as a security alert.
Route::post('/forgot-password/recovery-code', [AdminRecoveryController::class, 'redeem']);

Route::get('/appointments', [AppointmentController::class, 'index']);
Route::post('/appointments', [AppointmentController::class, 'store'])->middleware([
    VerifyTurnstile::class,
    EnsureNotUnderMaintenance::class . ':page_appointment',
]);
Route::delete('/appointments/{appointment}', [AppointmentController::class, 'destroy']);
Route::patch('/appointments/{appointment}/archive', [AppointmentController::class, 'archive']);
Route::patch('/appointments/{appointment}/unarchive', [AppointmentController::class, 'unarchive']);
Route::get('/appointments/calendar', [AppointmentController::class, 'calendar']);
Route::put('/appointments/calendar', [AppointmentController::class, 'updateCalendar']);
Route::get('/appointments/{reference}/verify', [AppointmentController::class, 'verifyByReference']);

// Public: Customer-facing products (non-blocked only)
Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{product}/image', [ProductController::class, 'image']);
Route::get('/products/{product}/reviews', [ProductRatingController::class, 'publicIndex']);
Route::get('/announcements', [AnnouncementController::class, 'publicIndex']);
Route::get('/promotions/active', [PromotionController::class, 'active']);

// Public: Site settings (read-only for customer pages)
Route::get('/site-settings', [SiteSettingController::class, 'index']);

// Public: Maintenance Mode snapshot. Read by every customer page before it
// paints, and revalidated on the site-content tick that already exists, so it
// carries an ETag and answers 304 whenever nothing has changed.
Route::get('/maintenance', [MaintenanceController::class, 'index']);

// Public: Services (shared between home "What We Offer" and Services page)
Route::get('/services', [ServiceController::class, 'index']);
Route::get('/services/{service}/image', [ServiceController::class, 'image']);

// Public: Home hero SDG badges (ETag-revalidated for cheap polling)
Route::get('/site-sdgs', [HomeSdgController::class, 'index']);

// Public: Courier registry. The admin tracking dropdown and the customer's
// "track it yourself" link both read this, so config/couriers.php stays the one
// place that knows which companies FMRC ships through.
Route::get('/couriers', [OrderController::class, 'couriers']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/users', [AuthController::class, 'getUsers']);
    Route::post('/users', [AuthController::class, 'adminCreateUser']);
    Route::delete('/users/delete-bulk', [AuthController::class, 'adminDeleteUsersBulk']);
    Route::delete('/users/{user}', [AuthController::class, 'adminDeleteUser']);

    Route::patch('/appointments/archive-bulk', [AppointmentController::class, 'archiveBulk']);
    Route::patch('/appointments/{appointment}/complete', [AppointmentController::class, 'markCompleted']);

    Route::get('/customer/profile', [AuthController::class, 'customerProfile']);
    Route::put('/customer/profile', [AuthController::class, 'updateCustomerProfile']);

    Route::post('/orders', [OrderController::class, 'customerStore'])
        ->middleware(EnsureNotUnderMaintenance::class . ':page_products');
    Route::get('/customer/orders', [OrderController::class, 'customerIndex']);
    Route::get('/customer/orders/{order}', [OrderController::class, 'customerShow']);
    Route::get('/customer/orders/{order}/items/{orderItem}/image', [OrderController::class, 'customerItemImage']);
    Route::post('/customer/orders/{order}/received', [OrderController::class, 'customerMarkReceived']);

    // Customer: submit the GCash reference number for an order placed to be paid
    // later. Records a claim for staff to verify; it never marks the order paid.
    Route::post('/customer/orders/{order}/payment', [OrderController::class, 'customerSubmitPayment']);

    // Customer: call off an order that has not been handed over yet. The server
    // decides whether this cancels outright (nothing paid, nothing prepared) or
    // only files a request for staff to approve.
    Route::post('/customer/orders/{order}/cancel', [OrderController::class, 'customerCancel']);

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

    Route::get('/customer/cart', [CartItemController::class, 'index']);
    Route::post('/customer/cart/sync', [CartItemController::class, 'sync']);
    Route::post('/customer/messages', [CustomerMessageController::class, 'store'])
        ->middleware(EnsureNotUnderMaintenance::class . ':page_contact');

    Route::get('/admin/orders', [OrderController::class, 'adminIndex']);
    Route::get('/admin/dashboard/summary', [AdminDashboardController::class, 'summary']);
    Route::get('/admin/dashboard/live-counts', [AdminDashboardController::class, 'liveCounts']);
    Route::get('/admin/reports', [ReportController::class, 'index']);
    Route::post('/admin/reports/generate', [ReportController::class, 'generate']);
    Route::post('/admin/orders/approve-bulk', [OrderController::class, 'approveBulk']);
    Route::post('/admin/orders/reject-bulk', [OrderController::class, 'rejectBulk']);
    Route::patch('/admin/orders/archive-bulk', [OrderController::class, 'archiveBulk']);
    Route::get('/admin/orders/{order}', [OrderController::class, 'adminShow']);
    Route::post('/admin/orders/{order}/approve', [OrderController::class, 'approve']);
    Route::post('/admin/orders/{order}/reject', [OrderController::class, 'reject']);
    Route::post('/admin/orders/{order}/complete', [OrderController::class, 'complete']);
    Route::patch('/admin/orders/{order}/tracking', [OrderController::class, 'updateTracking']);
    // Admin/Staff: the ready-made checkpoint list for the tracking modal, out of
    // config/tracking_checkpoints.php. Saves retyping the same checkpoints and
    // their coordinates; it is not a courier feed, nothing here is automatic.
    Route::get('/admin/tracking/checkpoint-presets', [OrderController::class, 'checkpointPresets']);
    Route::patch('/admin/orders/{order}/payment-status', [OrderController::class, 'updatePaymentStatus']);
    // Admin/Staff: accept or refuse a customer's cancellation request.
    Route::post('/admin/orders/{order}/cancellation', [OrderController::class, 'decideCancellation']);
    Route::patch('/admin/orders/{order}/archive', [OrderController::class, 'adminArchive']);
    Route::patch('/admin/orders/{order}/archive-payment', [OrderController::class, 'adminArchivePayment']);
    Route::patch('/admin/orders/{order}/unarchive', [OrderController::class, 'adminUnarchivePayment']);
    Route::delete('/admin/orders/{order}/payment', [OrderController::class, 'adminDestroyPayment']);
    Route::delete('/admin/orders/{order}', [OrderController::class, 'adminDestroy']);

    Route::get('/admin/walkin-orders', [WalkInOrderController::class, 'index']);
    Route::post('/admin/walkin-orders', [WalkInOrderController::class, 'store']);
    Route::put('/admin/walkin-orders/{id}', [WalkInOrderController::class, 'update']);
    Route::patch('/admin/walkin-orders/{id}/complete', [WalkInOrderController::class, 'complete']);
    Route::patch('/admin/walkin-orders/{id}/archive', [WalkInOrderController::class, 'archive']);
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

    // Admin only: Gmail notification templates. Reads only -- saving an edited
    // template goes through PUT /admin/site-settings like every other setting,
    // under the "email_tpl_{slug}" keys the public /site-settings hides. Both
    // controller actions check for role === 'admin', and bulkUpdate() rejects
    // "email_tpl_" keys from a staff token, so the wording that goes out under
    // the lab's name is admin-only however it is reached.
    Route::get('/admin/email-templates', [SiteSettingController::class, 'emailTemplates']);
    Route::post('/admin/email-templates/preview', [SiteSettingController::class, 'previewEmailTemplate']);

    // Admin: Maintenance Mode. The controller checks for role === 'admin', which
    // is stricter than the site-settings route above (admin OR staff) on
    // purpose: taking the customer site offline is not a staff action.
    Route::put('/admin/maintenance', [MaintenanceController::class, 'update']);

    // Admin: Services CRUD
    Route::get('/admin/services', [ServiceController::class, 'adminIndex']);
    Route::post('/admin/services', [ServiceController::class, 'store']);
    Route::put('/admin/services/{service}', [ServiceController::class, 'update']);
    Route::delete('/admin/services/{service}', [ServiceController::class, 'destroy']);

    // Admin: Home hero SDG badges CRUD
    Route::get('/admin/site-sdgs', [HomeSdgController::class, 'adminIndex']);
    Route::post('/admin/site-sdgs', [HomeSdgController::class, 'store']);
    Route::patch('/admin/site-sdgs/reorder', [HomeSdgController::class, 'reorder']);
    Route::put('/admin/site-sdgs/{homeSdg}', [HomeSdgController::class, 'update']);
    Route::delete('/admin/site-sdgs/{homeSdg}', [HomeSdgController::class, 'destroy']);

    Route::get('/user', function (Request $request) {
        return $request->user();
    });
    // Update current authenticated user's profile (email)
    Route::put('/user', [AuthController::class, 'updateSelfProfile']);
    // Admin Gmail changes are parked until the code sent to the NEW address is entered.
    Route::get('/user/email-change', [AuthController::class, 'pendingEmailChange']);
    Route::post('/user/email-change/confirm', [AuthController::class, 'confirmEmailChange']);
    Route::post('/user/email-change/cancel', [AuthController::class, 'cancelEmailChange']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);

    // Admin: one-time recovery codes (offline way back in if the Gmail is unreachable)
    Route::get('/admin/recovery-codes', [AdminRecoveryController::class, 'status']);
    Route::post('/admin/recovery-codes/generate', [AdminRecoveryController::class, 'generate']);

    // Admin: staff-account approval queue on Accounts Management.
    //
    // Admin-only (not staff) -- enforced by ensureAdmin() inside the controller,
    // matching accounts.js, which already bounces a staff session off that page.
    // The {id} is a plain string rather than an implicit model binding on purpose:
    // route-model binding would query the table before the controller's
    // "is it installed?" probe could run, and a server without the table would
    // answer 500 instead of a readable 503.
    Route::get('/admin/staff-account-requests', [StaffAccountRequestController::class, 'index']);
    Route::post('/admin/staff-account-requests/{id}/approve', [StaffAccountRequestController::class, 'approve']);
    Route::post('/admin/staff-account-requests/{id}/reject', [StaffAccountRequestController::class, 'reject']);

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
