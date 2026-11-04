# Custom Products rollout

This change adds private custom requests, versioned quotations, hosted full payment, production controls, and service-based sales reporting. Existing catalog inventory and refund authority remain unchanged.

## Deploy together

Deploy the source assets in `products-page`, `services-page`, `home-page`, `customer-auth`, `admin-page`, and `staff-page`, and the changed Laravel application files, routes, migration, and console command. The normal website and Customer/Team PWA routes resolve these same source files through `PwaAssetController` and the existing Apache aliases. Do not copy the recursive legacy `backend/public/frontend` tree over the source pages.

1. Back up the database and private storage. Review the release diff and run the checks below on staging first.
2. Deploy the application and source assets together, with the application in its normal maintenance window.
3. From `backend`, run `php artisan migrate --force`, then `php artisan optimize:clear`. The additive migration is `2026_11_04_000001_create_custom_product_workflow.php`.
4. Keep the existing scheduler running every minute (`php artisan schedule:run`). The new `custom-products:expire` task reconciles and explicitly expires unpaid PayMongo sessions. Existing gateway reconciliation, webhook processing, refund, and Ship24 jobs must continue running.
5. Verify that the private local filesystem disk is writable. Custom design files live under `storage/app/private/custom-product-designs` with the standard Laravel local-disk configuration. Never add this directory to a public storage link. Include it in private backups.
6. Configure PHP and the web server to accept the form limit: five files totaling 50 MB per request or message. `upload_max_filesize` must allow 50 MB; `post_max_size` and the upstream request-body limit need room above that for multipart overhead (for example 60 MB).
7. In **Website Management → Services**, edit suitable services and enable **Accept custom product requests**. All services default off. Review the Custom Products wording and click **Save All Changes** to publish copy and eligibility together.
8. Confirm transaction terms are published and the existing hosted payment method is available. Do not replace payment credentials or enable Ship24 as part of this rollout. Preserve the current verified provider configuration.

## Workflow and operational rules

- Products and Services link to `products-page/custom-products.html`; eligible service cards preselect their service. The customer account menu includes **My Custom Requests**.
- One request holds one design and quantity, its saved specifications, private conversation, attachments, quotations and activity history. Drafts are visible only to their owner. Sent quotations retain their original specification and design-proof snapshots.
- Admin and Staff use **Orders → Custom Requests**. They can clarify, decline, save a private quotation draft, or send a final quotation. Final quotations require resolved dimensions, materials, colors, finish, quantity, price, production lead time, and any delivery eligibility/fee/transit estimates.
- Quotations are payable for seven days from sending. A customer approves the complete quote and the currently published transaction terms before one linked order and hosted checkout are created. Retry actions return the existing order.
- Only a verified receipt covering the full quotation enables **Start Production**. **Mark Ready** is required before pickup or J&T physical handover. Existing J&T waybill, shipment history, and customer receipt confirmation remain in use. Actual courier costs never overwrite the accepted fee.
- Unpaid cancellation closes the order immediately and attempts to expire the checkout. Ambiguous provider responses show **Payment Review** and block replacement quotation/checkout until reconciliation succeeds. Admin recovery tools remain available for unknown provider references. A late payment on a closed or superseded agreement is recorded and queued for refund review; it does not revive production.
- Production has explicit guarded start/ready actions. General tracking updates can add notes without advancing custom production or changing the approved agreement. Paid cancellation before production follows the existing review flow; later concerns use assistance and return/refund actions. Only Admin can issue provider refunds.
- Customer and operator request views poll at approximately five seconds, with backoff on failures. Updates do not replace unsaved fields. The conflict dialog lets the user inspect the latest specifications and retain their draft before retrying.

## Accounting

The confirmed live payment/refund ledger remains authoritative. A custom receipt is a subset of Total Revenue, counted once on payment; completing the order adds no new receipt. Only successful refunds reduce provider revenue. Existing Philippine calendar filters and archival rules apply.

Products analytics group completed custom units and product gross sales by service under **Custom Products**. These figures exclude shipping and do not create catalog products, deduct stock, or publish ratings. The **All / Regular / Custom** filter also applies to dashboards and financial/order reports; Regular includes walk-ins. Report rows include order type, request reference, service, shipping, receipts and refunds. Generated report identities retain their selected sales type.

The reference accounting fixture is: quotation ₱0 revenue; confirmed ₱1,000 product + ₱100 shipping payment ₱1,100; completion still ₱1,100; pending ₱200 refund still ₱1,100; successful refund ₱900. Gross completed product sales remain ₱1,000, with the refund reported separately.

## Verification checklist

Automated local coverage is in `backend/tests/Feature/CustomProductsTest.php`, the extended Website Page Save/report suites, and `backend/tests/Frontend/custom-products.browser.cjs`.

Local verification on November 4, 2026:

- Full Laravel regression suite: **768 tests passed, 9,816 assertions**. The subsequent custom-request suite passed **18 tests, 221 assertions**, including an added historical-service drill-down check after renaming/deleting a service.
- Payment/cancellation follow-up: **106 tests passed**, including a confirmed payment arriving during cancellation. Cancellation is reviewed using payment state read under the order lock.
- Focused frontend suites: **41 tests passed** for custom workflows, Website Management draft/save behavior, portals, Services content, report exports, payment controls and PWA behavior. Both custom browser scenarios passed again after the final unsent-message and failed-dialog preservation fixes.
- Broader Chrome theme suite: **43 Admin/Staff pages, 86 light/dark render checks passed**, with desktop, narrow-screen, scrolling-footer and preference checks. Dedicated custom scenarios also cover tablet/phone layouts, reduced motion and Customer PWA consent links.
- PHP/JavaScript syntax and `git diff --check` passed. Provider calls were mocked; no live payment, refund, courier handover, staging deployment or production release was performed.

- [ ] Staging migration and private file download/upload permissions.
- [ ] Admin and Staff: enable a suitable service; unsaved eligibility/copy stays private; Save All Changes publishes both.
- [ ] Customer: sign in, save/reopen draft, submit, exchange files/messages, request revision, approve current quote/terms, complete hosted payment.
- [ ] Both roles: partial quotation drafts, sent immutable versions, stale edits, duplicate acceptance, unpaid production/dispatch rejection.
- [ ] Paid pickup and J&T delivery: production → ready → handover → customer receipt. Verify that the accepted fee stays fixed.
- [ ] Seven-day expiry, explicit checkout expiry, provider timeout, delayed confirmation, and late-payment refund review.
- [ ] Paid cancellation review, Admin refund issuance, pending versus successful refund totals, and archived report records.
- [ ] Product/service grouping, All/Regular/Custom filters, Philippine date boundaries, PDF/Excel output, dashboard operational counts, unchanged catalog stock.
- [ ] Desktop/tablet/phone, both portal themes, keyboard navigation, reduced motion, normal routes and Customer/Team PWA deep links.
- [ ] Genuine live PayMongo payment/refund and J&T/Ship24 events, only under the existing approved provider setup. Local tests use mocked provider responses and do not establish live verification.

Commands from the repository root:

```powershell
Set-Location backend
php artisan test --compact
Set-Location ..
node --test backend/tests/Frontend/custom-products.browser.cjs backend/tests/Frontend/website-page-drafts.browser.cjs backend/tests/Frontend/report-excel.test.cjs backend/tests/Frontend/page-content.test.cjs
```

## Recovery

Disable new requests for affected services through Services → Save All Changes while investigating. Keep existing requests, orders, receipts and uploaded designs. Run `php artisan custom-products:expire` to retry due checkout closures; inspect existing payment recovery/refund tools for ambiguous cases. Do not drop the custom tables or roll back the migration once requests exist. Any application rollback must retain code capable of safely reconciling already-created custom orders and their hosted payment sessions.
