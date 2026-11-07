# Website editor and form coverage

Validated locally on 2026-11-04. Changes require deployment before they affect the hosted website.

## Save behavior

- Home stages its text, scene settings, logos, favicon, service cards, and SDG additions, edits, removals, visibility, and ordering. About stages its text, video reference, images, and galleries.
- Services has one main Save All Changes button for page copy, categories, and service records. Modal Apply Changes updates only the page draft.
- Login Portals saves all edited portal tabs together. Email Templates retains edits across selections; Restore Default stages a reset until Save All Changes.
- Contact, Footer, Payments, and Maintenance retain explicit saves. Refresh and navigation warn before discarding ordinary editor drafts. Shipping and Policies keep their existing private-draft, approval, and publication workflow, with unsaved-work guards.
- Private video uploads and email-render previews can run before Save; published records and customer notifications change only after successful saves.

## API and compatibility

`PUT /api/admin/website-pages/{page}` accepts `home` or `services` and requires an authenticated Admin or Staff account. The body contains `settings` plus optional `services` and `sdgs` change sets. Each change set contains `upsert` records (an existing positive `id` for updates, no `id` for additions) and `delete` IDs. Only Home accepts SDGs.

All validation and collection limits apply before publication; database changes commit in one transaction. Existing IDs, unchanged media, service detail fields, and settings belonging to other pages remain intact. The existing settings endpoint and collection endpoints remain compatible. No database migration is required.

## Field contract and verification

- Light focus: 1 px `#800000` border, `0 0 0 3px rgba(128,0,0,0.1)` halo, and no second outline. Dark mode follows the Province field theme accent with the same thickness.
- Native dropdowns retain their picker, values, events, validation, and keyboard behavior. Shared decorative arrows rotate in 200 ms from native `:open` or existing custom expanded states. OS and portal reduced-motion preferences disable the animation.
- Chrome inspected 935 runtime field nodes across all 44 pages below at 1440, 768, and 390 px. Authenticated pages were checked in light and dark themes; shared sign-in remains light. Focus styles were forced for hidden modal controls so they were included in the cascade audit.
- Additional browser checks use actual modal focus, native picker open/close, keyboard selection, dynamically inserted dropdowns, and normal/Team PWA URLs. Local screenshots were visually reviewed. Browser phone sizes are emulated; physical phone and hosted-site verification are separate.
- Save scenarios cover both editor roles, unchanged public data before Save, staged collection/media changes, rejected-save recovery, persistence after reload, and both outcomes of discard confirmation. Backend tests cover authorization, field validation, atomic rollback, SDG limits, preserved media/details, and source asset serving.

## Page checklist

The field count includes controls already created by shared scripts, including hidden modal fields. Modal IDs below inventory source markup; shared dialogs created by scripts are listed afterward.

| Page | Runtime fields inspected | Source modal/dialog IDs | Shared styles and script |
|---|---:|---|---|
| `admin-page/accounts.html` | 13 | `modalDeleteAccount`, `modalViewUser`, `modalApproveRequest`, `modalRejectRequest` | Checked |
| `admin-page/appointments.html` | 9 | `modalCalendar`, `modalViewAppointment`, `modalArchiveAppointment`, `modalTimePicker`, `modalCompleteAppointment` | Checked |
| `admin-page/archives.html` | 22 | `modalAutoDeleteSettings`, `modalDeleteArchive` | Checked |
| `admin-page/customer-inquiries.html` | 4 | `inquiryDetailModal` | Checked |
| `admin-page/dashboard.html` | 2 | Shared dialogs | Checked |
| `admin-page/inventory.html` | 25 | `modalAddInventoryItem`, `modalViewInventoryItem`, `modalDeductInventoryItem`, `modalStockRules`, `reportPreviewModal`, `reportLetterheadModal` | Checked |
| `admin-page/my-account.html` | 7 | `recoveryConfirmModal` | Checked |
| `admin-page/orders.html` | 96 | `modalOrderDetails`, `modalTrackingUpdate`, `rejectIncomingOrderDialog`, `modalReturnDetails`, `modalReturnAction`, `modalAddWalkInOrder`, `modalWalkInDetails`, `modalDeleteWalkInOrder`, `modalArchivePaymentHistory`, `modalArchiveRejectedOrder`, `modalCompleteWalkInOrder`, `modalArchiveWalkInOrder` | Checked |
| `admin-page/products.html` | 35 | `modalAddProduct`, `modalEditProduct`, `modalViewProduct`, `modalDeleteProduct`, `modalProductPhotoEditor` | Checked |
| `admin-page/promotions.html` | 23 | `modalAddPromotion`, `modalAddAnnouncement`, `modalCustomizeTheme` | Checked |
| `admin-page/ratings.html` | 6 | `ratingDetailModal` | Checked |
| `admin-page/reports.html` | 5 | `reportPreviewModal`, `reportLetterheadModal` | Checked |
| `admin-page/settings.html` | 10 | `sidebarLogoDialog` | Checked |
| `admin-page/website-about.html` | 50 | `cropModal`, `sdgModal`, `serviceModal` | Checked |
| `admin-page/website-contact.html` | 11 | Shared dialogs | Checked |
| `admin-page/website-emails.html` | 8 | Shared dialogs | Checked |
| `admin-page/website-footer.html` | 19 | Shared dialogs | Checked |
| `admin-page/website-home.html` | 63 | `cropModal`, `sdgModal`, `serviceModal` | Checked |
| `admin-page/website-maintenance.html` | 35 | Shared dialogs | Checked |
| `admin-page/website-payments.html` | 3 | Shared dialogs | Checked |
| `admin-page/website-policies.html` | 4 | Shared dialogs | Checked |
| `admin-page/website-portals.html` | 12 | Shared dialogs | Checked |
| `admin-page/website-services.html` | 24 | `serviceModal` | Checked |
| `admin-page/website-shipping.html` | 10 | Shared dialogs | Checked |
| `staff-page/appointments.html` | 9 | `modalCalendar`, `modalViewAppointment`, `modalArchiveAppointment`, `modalTimePicker`, `modalCompleteAppointment` | Checked |
| `staff-page/archives.html` | 22 | `modalAutoDeleteSettings`, `modalDeleteArchive` | Checked |
| `staff-page/customer-inquiries.html` | 4 | `inquiryDetailModal` | Checked |
| `staff-page/dashboard.html` | 2 | Shared dialogs | Checked |
| `staff-page/inventory.html` | 25 | `modalAddInventoryItem`, `modalViewInventoryItem`, `modalDeductInventoryItem`, `modalStockRules`, `reportPreviewModal`, `reportLetterheadModal` | Checked |
| `staff-page/my-account.html` | 6 | Shared dialogs | Checked |
| `staff-page/orders.html` | 96 | `modalOrderDetails`, `modalTrackingUpdate`, `rejectIncomingOrderDialog`, `modalReturnDetails`, `modalReturnAction`, `modalAddWalkInOrder`, `modalWalkInDetails`, `modalDeleteWalkInOrder`, `modalArchivePaymentHistory`, `modalArchiveRejectedOrder`, `modalCompleteWalkInOrder`, `modalArchiveWalkInOrder` | Checked |
| `staff-page/products.html` | 35 | Shared dialogs | Checked |
| `staff-page/promotions.html` | 23 | `modalAddPromotion`, `modalAddAnnouncement`, `modalCustomizeTheme` | Checked |
| `staff-page/ratings.html` | 6 | `ratingDetailModal` | Checked |
| `staff-page/reports.html` | 5 | `reportPreviewModal`, `reportLetterheadModal` | Checked |
| `staff-page/settings.html` | 10 | `sidebarLogoDialog` | Checked |
| `staff-page/website-about.html` | 50 | `cropModal`, `sdgModal`, `serviceModal` | Checked |
| `staff-page/website-contact.html` | 11 | Shared dialogs | Checked |
| `staff-page/website-footer.html` | 19 | Shared dialogs | Checked |
| `staff-page/website-home.html` | 63 | `cropModal`, `sdgModal`, `serviceModal` | Checked |
| `staff-page/website-policies.html` | 4 | Shared dialogs | Checked |
| `staff-page/website-services.html` | 24 | `serviceModal` | Checked |
| `staff-page/website-shipping.html` | 10 | Shared dialogs | Checked |
| `admin-auth/auth.html` | 15 | `requestSuccessModal`, `forgotPasswordModal`, `requestAccountModal` | Checked |

`admin-page/maintenance-preview.html` contains the customer maintenance preview and has no editable form controls.

## Shared and generated controls

| Source | Coverage |
|---|---|
| `admin-common.js`, `apps/shared/pwa.js` | Shared account, confirmation, session, notification and app dialogs inherit the common field rules. |
| `orders.js`, `gateway-payments.js`, `courier-shipments.js`, `jnt-tracking.js` | Order, payment, cancellation, return and courier fields use the same global selectors; existing shipping browser workflows were exercised. |
| `appointments.js`, `appointment-details.js`, `inventory.js`, `products.js`, `promotions.js`, `reports.js` | Existing static/modal fields are included above; generated ordinary controls are covered by the same rules and shared select observer. |
| `website-home.js`, `website-services.js`, `website-portals.js`, `website-emails.js` | Dynamic editor fields, galleries, crop/service/SDG dialogs, portal selections and template drafts have targeted save tests. |
| `website-shipping.js`, `website-policies.js` | Province combobox and generated shipping/policy controls retain their existing approval and read-only behavior. |

The field audit verifies appearance and selection behavior. It does not claim a complete business-operation test of every unrelated operational modal.

## Shipping settings refresh and publication

Admin and Staff Refresh retrieves current published rates and tracking health without reusing cached settings. It waits for both requests and reports partial failures. Cancelling the unsaved-changes prompt preserves the editor.

The top table shows published rates. Admin edits update the draft preview immediately; **Save draft → FMRC approval → Publish settings** applies the changes to new checkouts and the Staff view. A pending-change notice distinguishes saved drafts from live rates. Removing the final area switches delivery off in the draft so its removal can be published. Existing orders retain their accepted shipping prices.

`ShippingQuotesTest` checks persistence, no-store response headers, removed destinations, pickup, and existing order snapshots. `shipping-refresh.browser.cjs` reproduces a cacheable settings response and checks both portals, rate editing/removal/publication, unsaved-change protection, and slow/failed refreshes. `shipping.browser.cjs` covers the connected checkout and tracking flows with an isolated provider fixture. These checks do not change or verify hosted production data.

## Regression commands

```powershell
php artisan test --compact --filter="WebsitePageSaveTest|WebsiteContentValidationTest|SiteSettingsVideoUploadTest|PortalAppearanceSettingsTest|CommercePolicyTest"
php artisan test --compact --filter=ShippingQuotesTest
node --test backend/tests/Frontend/shipping-refresh.browser.cjs
node --test backend/tests/Frontend/website-drafts.test.cjs backend/tests/Frontend/website-about-save.test.cjs backend/tests/Frontend/website-editor-refresh.test.cjs backend/tests/Frontend/website-portals.test.cjs backend/tests/Frontend/website-payments.test.cjs backend/tests/Frontend/website-loading.test.cjs backend/tests/Frontend/admin-only-website-settings.test.cjs backend/tests/Frontend/page-content.test.cjs
node --test --test-concurrency=1 backend/tests/Frontend/admin-form-controls.browser.cjs backend/tests/Frontend/website-page-drafts.browser.cjs backend/tests/Frontend/hero-scene-editor.browser.cjs backend/tests/Frontend/website-about-save.browser.cjs backend/tests/Frontend/shipping.browser.cjs
```

Run the PHP command from `backend`; run the Node commands from the repository root. Run browser suites sequentially on this workstation to avoid competing rendering workloads.
