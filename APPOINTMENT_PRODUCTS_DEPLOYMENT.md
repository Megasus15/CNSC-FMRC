# Appointment-linked Custom Products: release and walkthrough

This release extends the existing appointment and order systems. It does not restore the retired standalone Custom Requests feature. Ordinary appointments keep their booking, consultation, receipt, rescheduling, completion, and archive workflow.

## Release state

- New intake is **disabled by default**: `APPOINTMENT_PRODUCTS_ENABLED=false`.
- Service eligibility defaults off. Admin and Staff stage the checkbox in the existing Services editor, then publish through **Save All Changes**.
- Existing custom agreements, payments, messages and orders remain accessible if new intake is disabled later.
- Code, automated local tests, and browser fixtures are separate from staging and live-provider verification. Do not describe the latter as complete until the walkthrough below has been performed.

## Before deployment

1. Back up the active production database and the private upload directory. Keep the backups outside the public web root.
2. Push the complete change through GitHub Desktop and deploy that revision on Hostinger, including new files. Do not copy only the HTML or JavaScript.
3. Keep `APPOINTMENT_PRODUCTS_ENABLED=false` in the active backend environment during migration and smoke checks. Do not change payment or courier secrets for this feature.
4. From Hostinger Terminal, enter the active Laravel folder. Selecting a folder in File Manager does not change Terminal's current folder:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
pwd
ls artisan
php artisan migrate:status
ls database/migrations/2026_11_06_000001_add_optional_appointment_products.php
```

If the installed domain or account path differs, use the actual path shown by `pwd`. Stop on any error and inspect it before continuing. Do not paste commands into the `artisan` source editor.

## Apply the additive migration

Inspect `migrate:status` and the active schema first. On a clean pending migration, apply only the reviewed feature migration:

```sh
php artisan migrate --path=database/migrations/2026_11_06_000001_add_optional_appointment_products.php --force
php artisan optimize:clear
php artisan appointments:product-status
php artisan migrate:status
```

Expected: the new migration is `Ran`, schema is `ready`, and new intake is `disabled`. The migration adds private appointment jobs, quotation versions, discussion, files, ownership claims, activity, advance-cash ledger, and nullable links on existing appointments/orders. Historical catalogue orders are unchanged. The production state column is `appointment_production_status`; it is deliberately distinct from the removed feature's column.

If a previous attempt failed partway, do not rerun DDL blindly or use `migrate:fresh`, `reset`, or a rollback on production. Capture the first error and compare existing tables/columns/constraints with the migration. Prepare an additive repair for that actual state. The schema guard keeps ordinary appointments usable and blocks optional actions until the required schema is ready.

The migration's `down()` refuses destructive rollback. Disable new intake to stop rollout; retain agreements, receipts and refunds. Do not rerun the old retired-workflow cleanup migration.

## Required runtime checks

- Private files use the existing Laravel local disk, normally `backend/storage/app/private/appointment-attachments`. PHP must be able to write it. **Do not expose or symlink this directory into public storage.** Private downloads require the appointment owner or an authorized operator.
- Five files and 50 MB combined are allowed per draft/booking submission or message. Set PHP/web-server `post_max_size` above 50 MB to accommodate the multipart envelope, and `upload_max_filesize` to at least 50 MB. Keep the application limits unchanged.
- Confirm customer SMTP delivery and both new editable templates under Website Management → Email Templates → Appointments.
- Keep one scheduler invocation per minute. Reuse the existing Laravel `schedule:run` cron; do not add a duplicate. It must run `payments:reconcile`, `shipments:process`, `pwa:process` and `appointments:expire-quotes`. A cron that only runs the older payment helper does not run quotation expiry.
- Check `php artisan schedule:list` and `php artisan appointments:product-status`. These checks do not prove SMTP, live payment or courier delivery.
- Online payment uses the existing PayMongo configuration, signed webhooks, and reconciliation. A return from checkout does not mark an order paid.
- Keep Ship24's current activation policy. Do not turn on automatic tracking merely because this migration ran. FMRC can record an actual J&T handover and waybill while automatic tracking remains inactive.
- Clear Laravel caches after changing the feature flag. Versioned canonical assets also serve Customer and Team PWA routes; no reinstall is needed for ordinary network-fetched pages.

## Frontend repair: assets 2026.1106.2

The review and confirmation receipts now keep the custom-product brief on its own full-width row. Appointment details and the verification QR retain readable space on desktop and stack on phones. The same layout is used by the PNG receipt download.

Admin and Staff retain the open product editor, selected tab, focus, text selection, scroll position and unsaved fields/files during quiet refreshes. Save Details uses the outlined style with a maroon hover; the active custom-product tab stays maroon when hovered, focused or pressed.

Deploy the changed canonical HTML, CSS and JavaScript together. This repair requires no additional database migration or feature-flag change. Refresh existing pages after deployment and continue the already booked appointment rather than creating another booking.

Local verification covered 320/390/768/1024/1440/1920 px receipt layouts, both operator themes, actual five-second refreshes with incoming updates, and real PNG exports through html2canvas at phone/desktop widths. Ordinary appointment browser regressions and 79 portal/PWA backend tests also passed. This is local verification, separate from the supervised Hostinger walkthrough.

## Navigation, wording and service actions: assets 2026.1107.1

Home navigation now uses `/home-page/`. Legacy `main` and `main.html` links redirect while retaining booking, order, notification and private claim parameters. The Customer PWA uses `/apps/customer/home-page/` so it stays in its installed scope. Returning from a finished or discarded booking clears its launch parameters.

Eligible Home/Services cards place **Book a Consultation** on the left and the existing **Learn more →** text link on the right. They wrap on narrow cards. The same booking action appears in the fixed Service details footer; opening another, ineligible service removes it. Image previews and keyboard focus return are retained. The arrow and calendar use inline icons so they remain visible without the external icon font.

Save Outcome uses the same outlined/default and maroon-hover treatment as Cancel Custom Request in both operator themes. Customer and operator guidance differs throughout consultation, quotation, payment, production and receipt. Operators receive instructions to manage the customer’s job; customers receive their own next step. Quotation history and payment-pending messages follow the same distinction.

Deploy the complete revision, including the root `.htaccess`, Laravel route/controller changes, and versioned shared scripts. Shared app navigation is version `1.6`; changed page assets are `2026.1107.1`. No new SQL, migration, or feature-flag change is required for this repair. From Hostinger Terminal clear cached routes after deploying:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan optimize:clear
```

Reload open Customer/Admin/Staff pages and continue **AP-00053**. Verify both service actions, the Home address, the selected service, and operator wording before proceeding with the real consultation. Keep its appointment schedule, existing draft/job, eligibility settings and payment configuration.

Local verification for this repair covers the actual Apache redirects and PWA aliases, Laravel routes and existing optional-workflow safeguards, ordinary appointment browser regression, service actions/details at 320/390/768/1440 px, role-specific guidance through receipt, both operator themes, reduced motion, keyboard/focus return, stale-link handling and unsaved forms during five-second refreshes. API/provider responses in browser tests are isolated fixtures; these results do not verify a production charge, refund, email or parcel. The final targeted Laravel run passed **101 tests / 1,241 assertions**; ordinary and optional appointment browser suites, the PWA browser/worker and customer regression group (**26 tests**), Services rendering checks, and the isolated Apache alias suite passed.

## Customer bell and saved-outcome repair: assets 2026.1107.2

The shared Customer bell now opens one dialog with separate **Notifications** and **FMRC Announcements** tabs on Home, About, Services, Products, Contact, Refund Policy and Transaction Terms, including Customer PWA routes. The badge is hidden at zero, displays 1–99, and caps at 99+. Personal updates use the existing authenticated notification records and server read receipts; public campaigns retain their separate announcement reader. Opening a personal update does not read an announcement. Appointment updates open the matching appointment; order/payment updates retain their existing Order destinations. A quiet ten-second refresh backs off after failures and stops reading while the page is hidden.

Admin and Staff appointment reads now request fresh data and reject older custom-job revisions, preventing a background response from undoing a successfully saved outcome. The empty Quotation message follows the saved stage. Saving unchanged details no longer resets a recorded discussion or withdraws an existing quotation. A completed appointment still needs an attended consultation and a saved **Ready to prepare quotation** outcome before quoting; these checks remain on the server.

The product-details service selector loads all currently eligible services, retaining the job's saved service if it is no longer enabled. A different enabled service requires confirmation and a new FMRC review, while keeping the same meeting, files and history. Unpaid offers are withdrawn through the existing checkout-reconciliation process; paid agreements remain protected. The final quotation uses the service from the reviewed brief.

Deploy all changed files, including the new `home-page/customer-notifications.js` and `.css`, versioned Customer/portal HTML, and Laravel controller/service/middleware changes. Announcements use script version `7.0`; the new Customer bell and repaired appointment assets use `2026.1107.2`. This update needs no new migration, SQL, cron job or feature-flag change on the already migrated installation.

After the GitHub Desktop push and Hostinger deployment, run in Hostinger Terminal:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan optimize:clear
```

Reload Customer, Admin and Staff pages. Continue the existing **AP-00054** rather than making a new booking. Check its saved outcome in Overview and verify **Preparing quotation** and the preparation form in Quotation. If the job still has no saved outcome, save the attended consultation outcome once and read it back after reopening; do not modify database fields or bypass the consultation check. Confirm a personal appointment notification opens AP-00054 and that opening the bell leaves FMRC Announcements separate. Continue with the agreed **J&T delivery** path once the quotation is ready.

Local checks: 106 Laravel tests / 1,323 assertions (SQLite), the optional workflow browser suite including cached/stale response regression, the ordinary appointment and PWA browser suites, and Customer bell checks on all seven pages plus the Customer PWA at 320/390/768/1440 px. Customer bell checks cover hidden-zero/99+ counts, separate announcement read state, account-owned read receipts, exact appointment opening, retry, sign-out privacy, keyboard focus and reduced motion. Browser API/payment responses are fixtures. Production AP-00054 persistence, live charges/refunds, email delivery and courier events must be verified separately in the supervised Hostinger walkthrough.

## Consultation readiness and customer deletion: assets 2026.1107.3

AP-00054 revealed a conflicting check: **Mark as Done** accepted an attended consultation completed before its reserved date, but **Save Outcome** still rejected that same meeting until the reserved date. Both Admin and Staff now use the recorded **Completed** meeting and the explicit confirmation that product requirements were discussed. The original schedule stays unchanged; the discussion confirmation receives the server's current timestamp. Scheduled, cancelled and unconfirmed consultations still cannot qualify. A successful **Ready to prepare quotation** save opens Quotation automatically. Failed saves preserve the operator's entries and display **Action not completed**, never a green Success notification.

Customers can delete an individual personal notification or use **Clear all**, with the existing confirmation popup. Deletion is account-owned, updates the unread count, preserves newer notifications received during confirmation, and leaves FMRC Announcements and appointment/order records intact. The bell stays hidden at zero and caps at 99+.

**My Appointments** offers **Delete** only for completed or cancelled meetings. It removes the meeting from that customer's list. FMRC team records, private designs, discussions, accepted quotations, orders and payments remain available. Existing owned appointment deep links continue to open the retained history. Internal Archived status is presented to customers as Completed. New follow-up appointments do not inherit a deleted-list marker. Customer instructions and human role labels use **FMRC team**.

Deploy this complete revision, including the new migration and all versioned canonical Customer/Admin/Staff HTML and shared assets. The quotation fix uses the existing schema. Customer appointment deletion adds one nullable timestamp; it needs this **specific new migration**. Ordinary appointment lists continue working if that migration is still pending, with Delete unavailable until it is applied.

After deploying and taking a current database backup, run these in the official website's Hostinger Terminal:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan migrate --path=database/migrations/2026_11_07_000001_add_customer_appointment_deletion.php --force
php artisan optimize:clear
```

Reload the operator page, open **AP-00054 → Overview → Record consultation outcome**, keep **Ready to prepare quotation**, select **AP-00054**, enter the agreed summary, confirm that the consultation took place, then click **Save Outcome**. If the consultation did take place and the appointment remains Completed, Quotation opens with **Preparing quotation** and its form. Reopen to verify persistence before sending the J&T delivery quotation. Do not recreate the appointment or manually edit database statuses.

Local verification: 66 Laravel tests / 753 assertions cover ordinary/optional appointments, both operator roles, completed-early readiness, authenticated deletion, pending-schema behavior and retained linked orders. Three Chrome browser suites pass for ordinary appointments, optional quotations and the Customer bell; they cover rejected-save feedback, automatic Quotation selection, stale polling, delete confirmation/cancellation/failure, focus return, paginated deletion and newer notifications surviving Clear all. Both operator themes and Customer/PWA layouts are checked with isolated API fixtures. Live AP-00054 persistence, payments, email and courier delivery remain separate Hostinger walkthrough steps.

Additional checks passed: 58 portal consistency tests / 746 assertions, 19 Customer/payment/worker tests, PHP/JavaScript syntax, CSS parsing and `git diff --check`. The separate Customer/Team PWA browser suite passed on an isolated rerun after a transient browser-target navigation error in its initial run. All 50 changed canonical HTML pages contain asset-version changes only.

## Original staging acceptance checklist

Use a staging origin and provider test mode. Confirm the ordinary guest and signed-in appointment paths first, with the checkbox unselected.

1. Enable `APPOINTMENT_PRODUCTS_ENABLED=true` on staging, then clear Laravel caches.
2. In Admin or Staff → Website Management → Services, edit one suitable service, select **Accept custom product requests**, apply the modal changes and click **Save All Changes**. Reload and verify it persists. Unsaved edits must not appear on the customer site.
3. As a signed-in customer, book the existing appointment with the custom option. Save a draft, close it, and reopen it through My Appointments. Verify a draft reserves no slot and private designs remain available.
4. Complete the ordinary booking. From the Services card, **Book a Consultation** should open this same flow with its service selected. Test later opt-in on an existing appointment. For a guest receipt, use the private email ownership link and the matching signed-in email.
5. Admin and Staff both review the brief and exchange a private message/file. Request and book a follow-up; it must create a linked meeting for the same product job, respecting calendar conflicts.
6. After an attended meeting, use the existing **Mark as Done** action. In Custom Product, record that requirements were discussed, resolve critical details, then send a quotation. A scheduled, cancelled or unattended meeting cannot qualify. A meeting actually held early can qualify once it is marked Done and its product discussion is explicitly confirmed; the reserved schedule remains unchanged.
7. As the customer, review exact specifications, proofs, quantity, unit price, product subtotal, shipping, lead time and deadline. Approve the current transaction terms and quotation. Duplicate approval must reuse the linked Order.
8. Test both collection paths on separate jobs: hosted online checkout and **full advance cash at FMRC**. Only record cash actually received, with its receipt reference. Online-to-cash switching must wait for explicit checkout expiry; unresolved/processing payments must block replacement collection.
9. In Orders, verify **Start Production** is blocked before full payment. After confirmed payment, start production, then **Mark Ready**. Complete one pickup using the pickup code; complete a delivery using actual J&T handover and waybill, then customer receipt confirmation in My Orders. The agreed shipping fee must remain fixed even if the actual courier charge differs.
10. Test unpaid cancellation, reviewed paid cancellation, Admin-only cash correction/refund and the existing online refund process. A paid material change requires closing/refunding the old agreement and sending a new quotation. Do not edit paid totals/specifications in place.
11. Test an expired quotation, duplicate clicks/webhooks, failed upload/save, stale revision, another-tab update, and cancelled discard confirmation. Unsent text and selected files must remain after failure.
12. Verify archive/restore and protected deletion of linked appointments/orders/history. Run the normal and PWA deep links as Customer, Admin, and Staff. Check both portal themes at desktop, tablet and phone widths, keyboard focus, reduced motion and compact popup errors.
13. Verify reporting: a PHP 1,000 product plus PHP 100 shipping contributes zero at quotation, PHP 1,100 after a confirmed payment, no additional revenue at completion, and PHP 900 after a successful PHP 200 refund. Completed gross product sales are PHP 1,000 excluding shipping; catalogue stock does not change. Refund requests alone do not reduce custom receipts.

## Supervised Hostinger walkthrough

After staging passes, retain the disabled production flag until ready for one supervised job. Set the flag to true, clear caches, select a suitable service through **Save All Changes**, then follow customer booking → attended consultation → quotation → approval → full payment → production → ready → pickup/J&T handover → customer receipt.

Use real money only with the operator/customer's informed participation. Never mark a payment or courier event verified from a redirect, screenshot, or test fixture. Record the deployed Git revision, migration batch, role, appointment/quotation/order references, provider mode, payment receipt, physical handover/waybill and customer receipt result.

Keep **local automated results**, **staging smoke results**, **live payment/refund proof**, and **live courier proof** as separate entries. If the pilot needs to stop, set the intake flag false and clear caches; existing financial and fulfillment records remain available.

Provider constraints: [PayMongo checkout lifecycle](https://docs.paymongo.com/docs/payment-channels-key-concepts) requires explicit session expiry and reconciliation. [Ship24 webhook delivery](https://docs.ship24.com/webhooks/delivery) can group multiple events; provider timing and activation still apply.

## Original release verification record

Checked locally on Windows with PHP 8.3 and isolated MySQL 8.4.3 (not the Hostinger database):

- Full Laravel suite: **774 tests passed, 9,838 assertions**. After the final schema-response adjustment, the focused optional/ordinary appointment regression passed again: **33 tests, 366 assertions**.
- Isolated MySQL optional-workflow run: **21 tests passed, 281 assertions**. The temporary database server was shut down after verification.
- Frontend unit suites: **208 tests passed**. Ordinary and optional appointment Chrome suites: **2 passed**; the optional Chrome suite was rerun after the final accessibility changes.
- Ordinary appointment regression: booking, private uploads, availability, meeting details, rescheduling, receipts and completion.
- Optional workflow: draft create/save/book with revision zero, replay protection, later opt-in, guest ownership claims, private files/messages, linked follow-up, completed-discussion gate, immutable revised quotes, online checkout creation, explicit expiry, cash switch blocking, advance cash, ready guards, pickup/J&T handover, receipt, refunds, archive/restore and service eligibility saves.
- Concrete revenue fixture verified through the financial ledger, Dashboard and product classification. Catalogue inventory stays unchanged.
- Canonical Customer and operator pages checked through headless Chrome fixtures at 390/768/1440 px, both operator themes, shared fonts, centered dialogs, unsaved-work handling and reduced motion. The optional browser fixture exercises booking/draft recovery, Staff/Admin quotation panels, customer approval and Staff cash/production controls.
- Normal and Customer/Team PWA asset routes verified by Laravel tests. Provider requests in automated tests are fixtures; no real charge, refund or parcel was created.

Staging smoke checks: **not performed in this workspace**. Hostinger migration/flag activation, real SMTP ownership mail, real PayMongo payments/refunds and real courier verification remain rollout steps, not local test results.

The earlier sandboxed Apache attempt rejected temporary paths. During the 2026.1107.1 repair, the authorized isolated local Apache run passed, including the new Home redirects, retained query strings, Customer/Team aliases and scope restrictions. Hostinger verification still follows deployment.
