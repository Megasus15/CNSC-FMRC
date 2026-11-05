# Deploy the workflow removal

This release removes the separate Custom Products request, quotation, and production workflow. It preserves catalog products, regular and walk-in orders, payment/refund records, J&T tracking, appointments, Website Management's Save All Changes behavior, and the shared table/form improvements.

The user confirmed that only test, draft, or cancelled requests exist. No appointment integration is included in this release.

## 1. Push and deploy the removal

Commit the complete change in GitHub Desktop, including the deleted files, and deploy that revision through Hostinger. Keep the live `.env`, private uploads, and vendor dependencies.

Confirm that deployment **deletes** these obsolete public files rather than only uploading changed files:

- `products-page/custom-products.html`
- `products-page/custom-products.js`
- `products-page/custom-products.css`
- `admin-page/custom-product-metrics.js`
- `admin-page/website-services-copy.css`

Their removed backend classes and the two old workflow migration files must also be absent. The new removal migration replaces them for upgrades. Changed shared assets use cache version `2026.1105.1`.

## 2. Remove the test schema and private designs

Keep a current database export and a copy of `backend/storage/app/private` before this step. Earlier backups can be used if they include everything that needs to be retained.

Open the Hostinger terminal. From the domain directory shown in the earlier screenshots, enter:

```sh
cd public_html/backend
pwd
ls artisan
```

If the prompt already ends in `backend`, use only the last two commands. The folder must contain `artisan` before continuing.

Run **only** the targeted cleanup migration:

```sh
php artisan migrate --path=database/migrations/2026_11_05_000001_remove_retired_request_workflow.php --force
php artisan optimize:clear
```

Do not use `migrate:fresh`, `migrate:reset`, or a general `migrate:rollback` on Hostinger. Other pending migrations and existing application tables are outside this removal.

The cleanup removes the five unused request tables, their additional service/order/report columns, their three website-copy settings, their exact notification types and queued pushes, and only the private `custom-product-designs` directory. Appointment designs and other uploads are preserved. Existing migration history remains an audit record.

The migration stops **before making changes** if it finds any linked order, production state, or accepted quotation. If that happens, keep the error output and review those records before proceeding. Do not bypass the guard or delete an order/payment to make it pass.

## 3. Verify the deployed revision

```sh
php artisan migrate:status
php artisan route:list --path=custom-requests
```

The removal migration should show `Ran`; the old request routes should no longer be registered. The old standalone request page should return 404 in both normal and Customer PWA routes.

Clear any Hostinger page/CDN cache, refresh the Customer website, and reopen the Team PWA, then check:

- Products, Services, and the account menu have no custom-request card, quote action, or My Custom Requests entry.
- Orders and Archives have no Custom Requests section. Existing order, cancellation, refund, walk-in, and archive actions still work.
- Dashboard, Products analytics, and Reports load without Sales type or custom-production cards.
- Services Management retains its ordinary page-copy, category, and service editors with Save All Changes.
- My Appointments still opens, and appointment scheduling and private attachments remain available.

Local checks are separate from Hostinger verification. After deployment, record the served revision and migration result together. Integrating customization into appointments is a later change.

## Local verification

- Full Laravel regression suite: **753 passed**. The final expanded cleanup checks passed **5 tests / 54 assertions** on SQLite; cleanup also passed **5 tests** on an isolated MySQL 8.4 database.
- Frontend unit/static checks: **208 passed**. The additional local Apache-alias test cannot initialize because the installed Windows Apache rejects its absolute test-configuration path. It fails before loading the application. Laravel source-route checks and normal/Customer/Team browser-route checks passed.
- Eight browser tests passed for removal, retained Orders controls and table layouts, balanced section navigation, unified Website Management saves/readback, appointment booking and meeting updates, shipping/publication and J&T handling, and **43 portal pages in both themes (86 render checks)**.
- The runtime source audit found no retired feature references or missing JS/CSS references in changed pages. The existing transaction-policy wording predating this feature is preserved.
- No Hostinger database, private uploads, live payments, or live courier integration was modified by these local checks. The disposable MySQL instance and its test database were removed.
