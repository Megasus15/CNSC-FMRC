# Orders workspace update

## Behavior

- Unpaid online orders remain in Incoming Orders without approval controls. The server enforces the same rule for individual and bulk approval. Ordinary cash pickup and historical cash-delivery records retain their existing payment timing. Custom production still requires the accepted quotation and confirmed full payment.
- Bulk approval processes eligible IDs and reports skipped IDs; it never confirms payments.
- Incoming, Directory and cancellation links use the same Order Details modal. Fulfillment Refresh reads saved FMRC data and updates fulfillment only, with inline loading/error feedback. Handover, correction and note drafts remain intact. Automatic polling continues to read payment and order changes normally.
- Record handover/Save correction and Refresh share an action row. Refresh stays usable when recording handover is unavailable. Existing tracking-update requests, worker timing, provider limits and automatic completion are unchanged.
- Accepted transaction policy uses a normal card with separate links to the accepted version of Transaction Terms and Refund Policy.
- Cancellations & rejections contains customer requests and non-archived cancelled/rejected history. It defaults to Awaiting decision; All records and source filters expose history. Cancelled/rejected rows leave Orders Directory. Refunds remain in their existing online/manual financial workspaces; no records are deleted or migrated.
- Returns & Refunds uses Manage return to open a four-step guide. Permitted review, inspection, refund and archive actions reuse existing handlers. Pending provider refunds and customer claims never offer a second refund action. Repair/replacement progress does not invent an unsupported completion action.
- Online refunds uses 10 payment records per API page.

## Additive API fields

Admin/Staff order responses include `approval` (`allowed`, `label`, `reason`) and `cancellation_record` (`status`, `source`, `source_label`, `reason`, `recorded_at`). Cancellation sources rely on recorded closure events or cancellation requests; unclear historical sources remain Not recorded.

Automated return responses include `online_refund_status` and `customer_claim_required`, derived from existing refund/claim records. Existing authorization, financial endpoints, and lifecycle values remain intact.

## Deployment and readback

Deploy PHP and shared portal assets together, including the new `backend/app/Support/OrderApproval.php`. No migration, environment change, tracking reactivation, or new cron is required. Canonical Admin/Staff pages use asset version `2026.1111.7`; Team PWA routes use those same source pages. Other portal HTML edits are cache-version changes only.

After deployment, verify an owned unpaid online order has no approval action, a cash pickup can still be prepared, and a confirmed payment enables approval without a duplicate payment. In both portals check fulfillment-only Refresh, retained drafts, All records in Cancellations, Manage return, and refund page 2 with the eleventh record. Preserve unrelated customer transactions. Local tests do not prove live payment/provider execution or hosted deployment.

## Local verification

Passed: the complete backend suite (895 tests, 11,623 assertions), 53 relevant frontend/browser checks, and the final approval/cancellation regression check (7 tests, 95 assertions). JavaScript syntax and `git diff --check` also passed. Browser fixtures covered Admin and Staff on desktop and phone layouts in light and dark themes; no hosted deployment or live financial/provider transaction was performed.

Coverage includes server approval guards and skipped bulk IDs, recorded cancellation sources, 21 refunds across three pages, payment acknowledgements and stale-state guards, full custom cash refund/pickup flows, normal tracking readback, drafts and scroll preservation, unified cancellation filters, return guide branches and phone/desktop light/dark layouts.

Commands:

```text
cd backend
php vendor/phpunit/phpunit/phpunit
```

Relevant frontend suites: `orders-workspace.browser.cjs`, `order-dialog-refresh.browser.cjs`, `order-fulfillment-ui.browser.cjs`, `guided-order-workflow.browser.cjs`, `custom-order-refunds.browser.cjs`, `orders-filters.browser.cjs`, `order-payment-verification.test.cjs`, `gateway-payments.test.cjs`, `return-resolution.test.cjs`, and `rejected-order-routing.test.cjs` under `backend/tests/Frontend`.
