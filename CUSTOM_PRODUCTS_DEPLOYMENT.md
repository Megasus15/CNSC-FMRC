# Custom Products rollout

This change adds private custom requests, versioned quotations, hosted full payment, production controls, and service-based sales reporting. Existing catalog inventory and refund authority remain unchanged.

## Hostinger repair and deployment

Deploy the source assets in `products-page`, `services-page`, `home-page`, `customer-auth`, `admin-page`, and `staff-page`, and the changed Laravel application files, routes, migration, and console command. The normal website and Customer/Team PWA routes resolve these same source files through `PwaAssetController` and the existing Apache aliases. Do not copy the recursive legacy `backend/public/frontend` tree over the source pages.

1. In hPanel, open the active website's File Manager and confirm which folder contains the live `backend/artisan`. Export its database through **Databases → phpMyAdmin → Export** and keep the export privately. Back up the deployed application files and the private upload directory. Confirm your Hostinger Git deployment configuration before pushing through GitHub Desktop.
2. Upload or deploy the reviewed revision, including both new PHP schema files, the migration, and all changed customer and operator assets. Preserve the live `backend/.env` and storage. Confirm the deployed revision in hPanel and check that the served Custom Products assets use version `1.2`.
3. Open Hostinger SSH or a terminal connected to the hosting account. Change into the active `backend` directory identified in File Manager. Check where you are and inspect migration status. These commands are read-only.

   ```sh
   pwd
   ls artisan
   php -v
   php artisan migrate:status
   ```

   Find `2026_11_04_000001_create_custom_product_workflow`. If the row is missing from the status output, verify the deployed migration file and active directory first. If you have phpMyAdmin access only, open the database's **SQL** tab to run these read-only checks:

   ```sql
   SELECT migration, batch FROM migrations
   WHERE migration = '2026_11_04_000001_create_custom_product_workflow';

   SELECT table_name FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name IN (
     'custom_product_requests', 'custom_product_quotes', 'custom_product_messages',
     'custom_product_attachments', 'custom_product_events'
   );

   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = DATABASE() AND (
     (table_name = 'services' AND column_name = 'accepts_custom_requests') OR
     (table_name = 'orders' AND column_name IN (
       'custom_product_quote_id', 'production_status', 'production_started_at', 'production_ready_at'
     )) OR
     (table_name = 'report_generations' AND column_name = 'sales_type')
   );
   ```

4. Choose the branch that matches those results:

   - **Pending and custom schema absent.** Confirm the existing base migrations for Services, Orders, Reports and the payment ledger have run. During the maintenance window, apply this migration from the active `backend` directory, clear cached configuration/routes, and confirm it shows **Ran**.

     ```sh
     php artisan migrate --path=database/migrations/2026_11_04_000001_create_custom_product_workflow.php --force
     php artisan optimize:clear
     php artisan migrate:status
     ```

     If you only have phpMyAdmin access, arrange Artisan access through Hostinger. The Laravel migration creates constraints and records its own completion.
   - **Pending and some custom tables or columns already exist.** Inspect the migration error, existing table definitions and constraints before issuing another schema change. Prepare a repair for the missing pieces using the existing data and migration as the source of truth.
   - **Ran and schema is complete.** Inspect the latest file under `storage/logs` in File Manager after reproducing one failing request. Match the exception timestamp and missing table, column or failing query to the active database. Share the error code and relevant message with customer data and credentials removed.

5. Verify that the private local disk is writable, the uploads stay under `storage/app/private/custom-product-designs`, and PHP can receive up to five files totaling 50 MB with room for multipart overhead. Confirm the minute scheduler still runs `php artisan schedule:run`, including the existing payment, refund, and courier jobs and `custom-products:expire`.
6. Sign in as Admin and Staff. Check that regular Orders, Dashboard revenue, product charts and Reports load with the expected records. Open **Orders → Custom Requests** and check its empty or populated list. Confirm the existing hosted payment setup and published terms.
7. In **Website Management → Services**, enable **Accept custom product requests** for the suitable services, then click **Save All Changes**. Reload and confirm the saved switches. From the customer Products and Services pages, check that the request link opens a new tab and that **My Custom Requests** opens a modal. Confirm the eligible services appear in the wizard.

## Workflow and operational rules

- Products and Services open the new-request wizard in a separate tab. Eligible service cards preselect their service. **My Custom Requests** opens the request list and detail modal from the catalog or customer account menu.
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

Local repair verification on November 4, 2026:

- Full Laravel regression suite passed **771 tests**. The final focused Laravel run passed **39 tests**.
- The isolated MySQL suite passed **37 tests** with the complete schema. Separate MySQL API checks covered the pending and partial schema, including preserving regular revenue and keeping linked custom orders classified correctly.
- Chrome verified that clicking the request links opens separate tabs and leaves Products and Services in place. The standalone form uses the policy page layout. Browser checks covered hover states, modal centering and focus return, retry, consent, and Customer and Team PWA entry points.
- Staging and authenticated Hostinger checks remain pending. Local payment, refund and courier verification used fixtures.

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
