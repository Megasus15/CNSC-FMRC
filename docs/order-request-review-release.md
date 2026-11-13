# FMRC order requests: review before payment

New catalog orders now follow: submit request → FMRC review → payment → the existing preparation and fulfillment workflow. Both individual Buy Now orders and cart orders use this gate.

## Operator and customer behavior

- Admin and Staff review new requests individually in **Awaiting FMRC Review**, above Incoming Orders. **Approve request** reserves stock and unlocks payment; **Reject request** requires a customer-visible reason.
- Approved requests move to Incoming Orders. **Start preparation** is the existing fulfillment action, with its original paid-online / cash-pickup eligibility checks.
- Customers find requests in **My Orders → Awaiting Review**. Approved online requests move to To Pay. Approval does not charge the customer, create a payment session, or start preparation.
- Stock is reserved only on approval. Unpaid approved requests have no automatic expiry. Rejection or eligible cancellation releases reserved stock once.
- Existing orders retain their prior flow. An FMRC-issued custom quotation already provides approval; walk-in sales keep their operator-confirmed workflow. Payment verification, cash pickup, quotations, shipping, cancellations, and refunds retain their existing rules.

## Deployment through Git

Commit the migration, new review service, backend changes, shared frontend changes, tests, and this document together. Push the commit and deploy it through the existing online Git workflow. No ZIP upload or Composer dependency change is required.

Deploy the backend and canonical frontend folders together. The affected assets use version **2026.1113.3**. Run this migration from the deployed Laravel backend before reopening checkout:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend &&
php artisan migrate --path=database/migrations/2026_11_13_000002_add_order_request_review.php --force &&
php artisan optimize:clear
```

The migration adds nullable review/stock metadata. It does not reclassify existing orders, debit stock, change totals, or call the payment provider. New requests fail with a setup message if required columns are missing.

Keep the new backend in place once review-gated orders exist. Rolling back to the old payment code would remove their payment guard; do not roll back only the application files or drop these columns while such requests remain active. Preserve the database and private storage during deployment.

### UI refinement: assets 2026.1113.4

The follow-up UI changes remove the Products navbar My Orders shortcut, keep all nine My Orders tabs in one row with comfortable label padding, and align Admin/Staff request-review fields and buttons with the shared order dialogs. The tab strip scrolls on smaller screens; the profile menu still opens My Orders.

Deploy the changed frontend files and their matching HTML references through the existing commit → push → online deployment workflow. If the review migration above is already installed, this UI refinement requires no additional migration or Composer command.

## Interfaces

- Existing `POST /api/orders` creates an unpaid request with `review.status=pending`. A current catalog product ID and `checkout_request_key` UUID are required. It returns no payment URL and creates no provider payment attempt.
- `POST /api/admin/orders/{order}/review` accepts `decision: approve|reject`; rejection requires `reason` (maximum 1,000 characters). Both Admin and Staff are authorized. Repeated identical decisions are idempotent; conflicting or closed-state decisions return a conflict.
- Authenticated order responses add `review`, `awaiting_review`, and `payment_eligibility`. Existing fulfillment fields retain their meanings.
- `GET /api/admin/orders` adds `review`; pending requests are excluded from `incoming` until approved. The existing `/approve` endpoint starts preparation and cannot approve a request for payment.
- Payment checkout/status responses expose the review state and withhold checkout URLs/retry eligibility until approved. Provider evidence still records actual receipts and flags unexpected pre-review payments for investigation.

## Hosted smoke checks

1. Submit a catalog request. Confirm the request number, Awaiting Review tab, no payment redirect, unchanged available stock, and no provider attempt.
2. Open the request as Admin or Staff. Approve it and verify stock changes once, the original total is unchanged, and the same order appears in Incoming Orders.
3. Sign back in as its customer. Check the decision email and To Pay action. Confirm hosted payment separately with an authorized transaction; a redirect alone is not payment confirmation.
4. Confirm preparation remains a separate action. For cash pickup, retain payment at collection.
5. Decline a separate unpaid request with a reason, and cancel another pending request. Neither should add stock that was never reserved.
6. Check a pre-release order and an accepted custom quotation to verify their existing payment and fulfillment behavior.

## Local verification

- The affected backend suite passed **295 tests / 3,569 assertions**. After the final notification wording changes, the focused review/payment suite passed again: **95 tests / 1,173 assertions**.
- The six request-review browser scenarios passed: single-product and cart submission failures/retries, Admin and Staff decisions, oldest-first table search/pagination, and customer status/payment transitions. Layout checks cover **320, 390, 768, 1024, and 1440 px**, with both portal themes and keyboard draft/focus checks.
- Existing hosted-payment, shared-dialog refresh, focused Orders workspace, guided ordinary/custom pickup, and shipping browser regressions passed. Screenshot inspection confirmed the selected customer tab and visible panel after transitions settle. Browser fixtures block external resources, so CDN font/icon delivery still needs a hosted check.
- Shared frontend unit tests: **214 passed, one pre-existing failure** in `backend/tests/Frontend/page-content.test.cjs:152` (the About Us gallery fixture). The same failure was reproduced using the committed, unmodified `home-page/main.js`; the gallery implementation was not changed in this release.
- JavaScript syntax, canonical asset-version references, and `git diff --check` passed.

Reservation tests cover competing requests, stale decisions, cancellation ordering, repeated clicks, aggregated cart quantities, transaction rollback, and exactly-once restoration. They use an isolated test database; parallel production-MySQL locking still requires a separate staging check.

Local tests use isolated databases and fixture payment/browser responses. They do not deploy the release, run the production migration, deliver real email, or prove a live provider transaction.
