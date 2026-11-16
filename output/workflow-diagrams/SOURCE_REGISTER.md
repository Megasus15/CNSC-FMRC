# Workflow source register

Baseline: `c499fa5d03fc89ef8dc10ab828c4f1b3df4b35b4`. All references are repository-relative; method names are evidence anchors.

## F00 - System overview: separate, connected workflows

- `backend/routes/api.php:1`

## F01 - Customer registration and sign-in

- `backend/app/Http/Controllers/Api/AuthController.php:111` - `register`
- `backend/app/Http/Controllers/Api/AuthController.php:182` - `login`
- `backend/app/Http/Controllers/Api/AuthController.php:264` - `googleLogin`
- `backend/routes/api.php:1`

## F02 - Staff account application and approval

- `backend/app/Http/Controllers/Api/StaffAccountRequestController.php:55` - `store`
- `backend/app/Http/Controllers/Api/StaffAccountRequestController.php:201` - `approve`
- `backend/app/Http/Controllers/Api/StaffAccountRequestController.php:288` - `reject`
- `admin-page/accounts.js:1`

## F03 - Admin user management

- `backend/app/Http/Controllers/Api/AuthController.php:595` - `adminCreateUser`
- `backend/app/Http/Controllers/Api/AuthController.php:667` - `adminDeleteUser`
- `backend/app/Http/Controllers/Api/AuthController.php:681` - `adminDeleteUsersBulk`
- `backend/app/Models/User.php:1`
- `admin-page/accounts.js:1`

## F04 - Password reset

- `backend/app/Http/Controllers/Api/PasswordResetController.php:123` - `sendOtp`
- `backend/app/Http/Controllers/Api/PasswordResetController.php:276` - `resendOtp`
- `backend/app/Http/Controllers/Api/PasswordResetController.php:317` - `verifyOtpAndReset`
- `backend/routes/api.php:1`

## F05 - Personal profile and credential updates

- `backend/app/Http/Controllers/Api/AuthController.php:887` - `updateSelfProfile`
- `backend/app/Http/Controllers/Api/AuthController.php:731` - `updateCustomerProfile`
- `backend/app/Http/Controllers/Api/AuthController.php:1064` - `confirmEmailChange`
- `backend/app/Http/Controllers/Api/AuthController.php:1189` - `changePassword`
- `admin-page/my-account.js:1`

## F06 - Admin recovery-code generation and redemption

- `backend/app/Http/Controllers/Api/AdminRecoveryController.php:111` - `generate`
- `backend/app/Http/Controllers/Api/AdminRecoveryController.php:190` - `redeem`
- `backend/app/Http/Controllers/Api/AdminRecoveryController.php:73` - `status`
- `admin-page/my-account.js:1`

## F07 - Session renewal, expiry and logout

- `backend/app/Http/Controllers/Api/AdminSessionController.php:14` - `status`
- `admin-page/admin-session.js:1`
- `admin-page/session-helper.js:1`
- `backend/routes/api.php:1`
- `backend/app/Http/Controllers/Api/AuthController.php:522` - `logout`

## F08 - Personal Settings and sidebar customization

- `backend/app/Http/Controllers/Api/PortalPreferenceController.php:28` - `show`
- `backend/app/Http/Controllers/Api/PortalPreferenceController.php:44` - `update`
- `admin-page/settings.js:1`
- `admin-page/dark-mode.js:1`
- `admin-page/portal-sidebar.js:1`

## F09 - Service consultation: booking to completion

- `backend/app/Http/Controllers/Api/AppointmentController.php:76` - `store`
- `backend/app/Http/Controllers/Api/AppointmentController.php:639` - `updateMeeting`
- `backend/app/Http/Controllers/Api/AppointmentController.php:346` - `markCompleted`
- `backend/app/Services/AppointmentScheduling.php:1`
- `home-page/main.js:1`

## F10 - Custom-product appointment: request to fulfillment

- `backend/app/Http/Controllers/Api/AppointmentProductController.php:284` - `outcome`
- `backend/app/Http/Controllers/Api/AppointmentProductController.php:398` - `quotation`
- `backend/app/Http/Controllers/Api/AppointmentProductController.php:453` - `accept`
- `backend/app/Http/Controllers/Api/AppointmentProductController.php:577` - `expire`
- `backend/app/Services/AppointmentProducts.php:1`
- `home-page/appointment-products.js:1`

## F11 - Appointment rescheduling and cancellation

- `backend/app/Http/Controllers/Api/AppointmentController.php:608` - `reschedule`
- `backend/app/Http/Controllers/Api/AppointmentController.php:578` - `customerDestroy`
- `backend/app/Services/AppointmentScheduling.php:1`
- `backend/app/Services/AppointmentProducts.php:1`
- `home-page/my-appointments.js:1`

## F12 - Calendar availability management

- `backend/app/Http/Controllers/Api/AppointmentController.php:371` - `calendar`
- `backend/app/Http/Controllers/Api/AppointmentController.php:433` - `updateCalendar`
- `backend/app/Services/AppointmentScheduling.php:1`
- `admin-page/appointments.js:1`

## F13 - Product purchase: browse to completion

- `backend/app/Http/Controllers/Api/OrderController.php:124` - `customerStore`
- `backend/app/Http/Controllers/Api/OrderController.php:1865` - `review`
- `backend/app/Support/OrderReview.php:1`
- `backend/app/Support/OrderApproval.php:1`
- `products-page/products.js:1`
- `home-page/main.js:1`

## F14 - Online payment and provider confirmation

- `backend/app/Http/Controllers/Api/PayMongoWebhookController.php:51` - `retry`
- `backend/app/Http/Controllers/Api/PayMongoWebhookController.php:42` - `checkPaymentStatus`
- `backend/app/Services/GatewayPayments.php:1`
- `backend/app/Http/Controllers/Api/GatewayManagementController.php:141` - `reconcile`
- `backend/config/payments.php:1`

## F15 - Pickup fulfillment and collection

- `backend/app/Services/OrderCompletion.php:64` - `collect`
- `backend/app/Services/OrderCompletion.php:26` - `collectionBlocker`
- `backend/app/Http/Controllers/Api/OrderController.php:2024` - `complete`
- `backend/app/Http/Controllers/Api/OrderController.php:2403` - `updatePaymentStatus`

## F16 - Delivery handover and courier tracking

- `backend/app/Services/ShipmentTracking.php:1`
- `backend/app/Services/OrderCompletion.php:84` - `delivered`
- `backend/app/Services/SeventeenTrackTracking.php:1`
- `backend/app/Http/Controllers/Api/ShipmentTrackingController.php:1`

## F17 - Custom production and advance cash

- `backend/app/Http/Controllers/Api/AppointmentProductOrderController.php:20` - `action`
- `backend/app/Http/Controllers/Api/AppointmentProductOrderController.php:144` - `switchPayment`
- `backend/app/Services/AppointmentProducts.php:1`

## F18 - Order cancellation

- `backend/app/Http/Controllers/Api/OrderController.php:1131` - `customerCancel`
- `backend/app/Http/Controllers/Api/OrderController.php:1381` - `decideCancellation`
- `backend/app/Support/OrderRefundEligibility.php:1`

## F19 - Order rejection

- `backend/app/Http/Controllers/Api/OrderController.php:1865` - `review`
- `backend/app/Http/Controllers/Api/OrderController.php:1953` - `reject`
- `backend/app/Http/Controllers/Api/OrderController.php:1780` - `rejectBulk`
- `backend/app/Support/OrderReview.php:1`

## F20 - Refunded-order review

- `backend/app/Http/Controllers/Api/OrderController.php:1876` - `closeRefunded`
- `backend/app/Support/RefundedOrderReview.php:1`

## F21 - Returns and resolution

- `backend/app/Http/Controllers/Api/OrderReturnController.php:97` - `eligibility`
- `backend/app/Http/Controllers/Api/OrderReturnController.php:520` - `decision`
- `backend/app/Http/Controllers/Api/OrderReturnController.php:671` - `received`
- `backend/app/Http/Controllers/Api/OrderReturnController.php:621` - `resolution`
- `backend/app/Models/OrderReturn.php:1`

## F22 - Online refund request, approval and retry

- `backend/app/Http/Controllers/Api/GatewayManagementController.php:91` - `requestRefund`
- `backend/app/Http/Controllers/Api/GatewayManagementController.php:101` - `approve`
- `backend/app/Http/Controllers/Api/GatewayManagementController.php:106` - `retry`
- `backend/app/Support/OrderRefundEligibility.php:1`
- `backend/app/Services/GatewayPayments.php:1`

## F23 - Walk-in sales

- `backend/app/Http/Controllers/Api/WalkInOrderController.php:132` - `store`
- `backend/app/Http/Controllers/Api/WalkInOrderController.php:188` - `update`
- `backend/app/Http/Controllers/Api/WalkInOrderController.php:73` - `complete`
- `admin-page/orders.js:1`

## F24 - Product reviews and FMRC replies

- `backend/app/Http/Controllers/Api/ProductRatingController.php:21` - `store`
- `backend/app/Http/Controllers/Api/ProductRatingController.php:329` - `reply`
- `backend/app/Http/Controllers/Api/ProductRatingController.php:215` - `toggleLike`
- `backend/app/Http/Controllers/Api/ProductRatingController.php:392` - `archiveBulk`
- `admin-page/ratings.html:1`

## F25 - Customer inquiry submission and resolution

- `backend/app/Http/Controllers/Api/CustomerMessageController.php:15` - `store`
- `backend/app/Http/Controllers/Api/CustomerMessageController.php:88` - `markRead`
- `backend/app/Http/Controllers/Api/CustomerMessageController.php:107` - `resolve`
- `backend/app/Http/Controllers/Api/CustomerMessageController.php:127` - `destroy`
- `admin-page/customer-inquiries.html:1`

## F26 - Inventory items and variants

- `backend/app/Http/Controllers/Api/InventoryItemController.php:156` - `store`
- `backend/app/Http/Controllers/Api/InventoryItemController.php:218` - `update`
- `admin-page/inventory.js:1`

## F27 - Inventory stock adjustments

- `backend/app/Http/Controllers/Api/InventoryItemController.php:380` - `adjust`
- `backend/app/Http/Controllers/Api/InventoryItemController.php:287` - `deduct`
- `backend/app/Http/Controllers/Api/InventoryItemController.php:558` - `transactions`
- `admin-page/inventory.js:1`

## F28 - Low-stock rules

- `backend/app/Http/Controllers/Api/InventoryItemController.php:1001` - `stockRuleSettings`
- `backend/app/Http/Controllers/Api/InventoryItemController.php:1052` - `updateStockRuleSettings`
- `admin-page/inventory.js:1`

## F29 - Product catalog and media management

- `backend/app/Http/Controllers/Api/ProductController.php:117` - `store`
- `backend/app/Http/Controllers/Api/ProductController.php:149` - `update`
- `backend/app/Http/Controllers/Api/ProductController.php:283` - `destroy`
- `backend/app/Http/Controllers/Api/ProductMediaController.php:1`
- `admin-page/products.js:1`

## F30 - Promotions management

- `backend/app/Http/Controllers/Api/PromotionController.php:33` - `store`
- `backend/app/Http/Controllers/Api/PromotionController.php:56` - `update`
- `backend/app/Http/Controllers/Api/PromotionController.php:135` - `active`
- `backend/app/Http/Controllers/Api/PromotionController.php:78` - `archiveBulk`
- `admin-page/promotions.html:1`

## F31 - Announcements management

- `backend/app/Http/Controllers/Api/AnnouncementController.php:50` - `store`
- `backend/app/Http/Controllers/Api/AnnouncementController.php:69` - `update`
- `backend/app/Http/Controllers/Api/AnnouncementController.php:17` - `publicIndex`
- `admin-page/promotions.html:1`

## F32 - Reports, letterhead and printing

- `backend/app/Http/Controllers/Api/ReportController.php:68` - `generate`
- `backend/app/Http/Controllers/Api/ReportController.php:57` - `index`
- `admin-page/reports.js:1`
- `admin-page/report-document.css:1`

## F33 - Notifications and personal feed state

- `backend/app/Http/Controllers/Api/NotificationController.php:18` - `index`
- `backend/app/Http/Controllers/Api/NotificationController.php:35` - `markAllRead`
- `backend/app/Http/Controllers/Api/CustomerNotificationController.php:1`
- `admin-page/admin-common.js:1`

## F34 - Archives, restoration and permanent cleanup

- `backend/app/Http/Controllers/Api/ArchiveController.php:384` - `restoreBulk`
- `backend/app/Http/Controllers/Api/ArchiveController.php:476` - `deleteBulk`
- `backend/app/Http/Controllers/Api/ArchiveController.php:560` - `autoDelete`
- `backend/app/Support/AdminArchiveRecords.php:1`
- `backend/app/Services/AppointmentWorkState.php:1`
- `admin-page/archives.js:1`

## F35 - Home content management

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-home.js:1`

## F36 - About Us content management

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-home.js:1`

## F37 - Services content management

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-services.js:1`
- `backend/app/Http/Controllers/Api/ServiceController.php:76` - `store`
- `backend/app/Http/Controllers/Api/ServiceController.php:93` - `update`

## F38 - Contact content management

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-contact.js:1`

## F39 - Footer content management

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-footer.js:1`

## F40 - Login Portal branding

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-portals.js:1`
- `backend/app/Support/PortalAppearanceSettings.php:1`

## F41 - Payment Methods configuration

- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `backend/app/Support/PaymentMethodAvailability.php:1`
- `admin-page/website-payments.js:1`

## F42 - Shipping, delivery and tracking settings

- `backend/app/Http/Controllers/Api/ShippingController.php:43` - `saveDraft`
- `backend/app/Http/Controllers/Api/ShippingController.php:115` - `publish`
- `backend/app/Http/Controllers/Api/ShippingController.php:150` - `quote`
- `backend/app/Http/Controllers/Api/ShipmentTrackingController.php:83` - `updateSettings`
- `admin-page/website-shipping.js:1`

## F43 - Transaction Policy drafting and publication

- `backend/app/Http/Controllers/Api/CommercePolicyController.php:42` - `saveDraft`
- `backend/app/Http/Controllers/Api/CommercePolicyController.php:58` - `publish`
- `backend/app/Http/Controllers/Api/CommercePolicyController.php:19` - `published`
- `admin-page/website-policies.js:1`

## F44 - Email Template customization

- `backend/app/Http/Controllers/Api/SiteSettingController.php:216` - `emailTemplates`
- `backend/app/Http/Controllers/Api/SiteSettingController.php:240` - `previewEmailTemplate`
- `backend/app/Http/Controllers/Api/SiteSettingController.php:131` - `bulkUpdate`
- `admin-page/website-emails.js:1`

## F45 - Maintenance controls

- `backend/app/Http/Controllers/Api/MaintenanceController.php:64` - `update`
- `backend/app/Http/Middleware/EnsureNotUnderMaintenance.php:1`
- `admin-page/website-maintenance.html:1`
