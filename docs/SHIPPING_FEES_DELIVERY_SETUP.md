# Step 2: Shipping fees and delivery estimates

## Behavior

Admin manages **Website Management → Shipping & Delivery**. Settings are saved
as a draft, previewed, and published after confirming FMRC approval. Staff sees
the published rates and working calendar through the same screen. Staff and
Customer accounts cannot write or publish shipping settings. Draft changes do
not affect checkout. Concurrent edits use a revision check.

The shared editor now gives a specific reason while Publish is disabled: add a
delivery area, save the draft, confirm FMRC approval, or the settings are already
published. The API identifies whether a draft has actually been saved; the empty
starting setup is not treated as an existing publication. Approval becomes
available after a valid draft is saved, and saving resets the approval checkbox.
Delivery requires at least one area. Each field includes a short explanation;
no fees or delivery commitments are filled in for the Admin.

Province is a select populated by `GET /api/psgc/provinces`. That endpoint uses
PSGC Cloud's nationwide `/api/provinces` data and the existing 24-hour server
cache shared with Customer address lookups. No province names are hardcoded as
dropdown choices. Failed or malformed responses produce a retry state; saved
province names and in-progress draft fields are preserved while loading/retrying.
An unrecognized saved name must be replaced with a selection before saving.

Shipping validation uses the shared Admin/Staff system popup rather than a red
inline banner or technical field paths. Repeated city names/postal codes are
validated within each delivery area; different areas may share these values when
their other coverage differs. Publication still rejects overlapping areas that
would produce equally specific matches. The popup identifies the affected area
and returns focus to the field after acknowledgement.

There are no seeded delivery rates. Until approved settings are published,
delivery is unavailable and checkout offers pickup. Pickup has zero shipping
fee. Enabling delivery requires at least one valid destination zone.

Each Philippine zone specifies an official province name, optional cities or
municipalities, optional four-digit postal codes, one fee per order, preparation
days, and minimum/maximum transit days. Postal-code restrictions take priority
over city restrictions, then province-wide coverage. Equally specific overlapping
zones cannot be published. Names are compared without case or repeated-space
differences. Addresses outside configured coverage cannot obtain free delivery.

The shared server calculation uses current catalog prices and live promotions.
Delivery estimates count working days in Asia/Manila, excluding configured
weekdays and dates. Preparation is counted after the order date; zero preparation
days uses that day if it is a working day, otherwise the next working day.
Transit starts after preparation. Estimates can change at Manila midnight.

Quotes last 15 minutes and bind the customer, cart quantities and prices,
fulfillment method, province/city/postal-code destination, published settings
version, fee, total, and delivery dates. Changed quantities, destination,
fulfillment, prices, published settings, expired quotes, and changed estimated
dates require a refreshed quote. Checkout presents revised totals for explicit
review before permitting submission. Old in-flight quote responses cannot
replace the current cart's result.

Order creation locks the products and published settings, validates the accepted
quote, and saves the shipping fee and quote snapshot together with the order.
The same payable total funds COD and provider-hosted online payments. A completed
idempotent submission can be replayed even after its original quote expires.
Later settings changes do not reprice existing orders.

Customer checkout and Customer/Admin/Staff order details show item subtotal,
shipping fee, payable total, and estimated delivery. Historical orders retain
their original totals; missing shipping fees and dates are shown as not recorded.
Online payments retain the existing provider confirmation workflow.

## API and data

- `POST /api/shipping/quote`: authenticated Customer quote.
- `GET /api/admin/shipping-settings`: Admin draft/published snapshot; Staff
  published snapshot only.
- `PUT /api/admin/shipping-settings/draft`: Admin-only, `expected_revision` and
  validated `settings`.
- `POST /api/admin/shipping-settings/publish`: Admin-only, `expected_revision`
  and explicit `approved` acceptance.
- `POST /api/orders` now receives `shipping_quote_token`. Missing, altered,
  expired, or stale tokens produce `409 shipping_quote_stale` with a fresh quote
  for review. Unavailable delivery produces an unavailable quote, not a zero fee.

The additive migration
`2026_11_02_000001_add_shipping_quotes_and_settings.php` creates a singleton
`shipping_settings` row and nullable order columns: `shipping_fee`,
`shipping_quote`, `estimated_delivery_from`, and `estimated_delivery_to`.
It does not rewrite historical orders. New quote/order operations fail closed
when the required schema is unavailable.

## Release checkpoint

1. Back up the target database and inspect migration status. Deploy the new PHP,
   canonical Admin/Staff/Customer assets, and versioned HTML together. Avoid
   copying the recursive `backend/public/frontend` tree.
2. Apply the target migration with `php artisan migrate --force` and clear
   application/route caches with `php artisan optimize:clear`. These commands
   have not been run against production as part of this implementation.
3. An Admin enters FMRC-approved coverage, fees, preparation/transit ranges,
   nonworking weekdays, and nonworking dates. Review the draft preview before
   publishing. The approval checkbox is not an instruction to invent rates.
4. Verify real authenticated draft persistence, publication and Staff read access.
   Check unavailable destinations and zero-fee pickup, quantities and destination
   changes, expired quotes, and reload persistence of an accepted order.
5. Compare checkout and Customer/Admin/Staff order details against stored order
   and payment totals. Use test provider credentials on staging to verify the
   online-payment amount and confirmation. No live payment was made in local QA.
6. Verify the deployed routes and cache versions, phone/tablet/desktop layouts,
   light/dark themes, keyboard operation, and order notifications on the target.

Local backend tests use an isolated SQLite database. Browser tests run the real
canonical frontend scripts and dialogs against a persistent API fixture. These
checks do not constitute a production deployment or a target MySQL/live-provider
test.

Implementation QA on November 2, 2026: 125 focused backend checks, 55 focused
frontend checks, and the complete shipping browser scenario passed. The browser
scenario includes 12 Admin/Staff settings layouts, Customer quote changes and
pickup recovery, and saved pricing in all three portals. A full backend run
passed 674 checks and surfaced four existing portal-consistency assertions.
The page-inventory expectation was updated and rechecked for the two new pages.
Three unrelated existing assertions remain: the maintenance preview's shared-UI
pin, the dashboard report CTA selector, and the announcement theme selector.
Their underlying frontend files were not changed by this stage.

Courier booking/tracking and transaction policies are now implemented in the following stages. Staff supplies actual parcel measurements; FMRC absorbs any difference from the accepted customer fee. See [the consolidated release checkpoint](PORTAL_UPGRADE_RELEASE.md) for final results and [Ninja Van activation](NINJA_VAN_ACTIVATION.md) for outstanding provider requirements.
