# Focused Orders update

## Included behavior

- Unpaid online Incoming Orders cannot be approved through the table, either dialog, pickup controls, or direct/bulk requests. Ordinary cash pickup keeps its existing preparation and payment-at-collection flow. Custom products retain their full-payment/accepted-agreement guards.
- Incoming Orders, Orders Directory and Customer cancellations use the same Order Details dialog. The fulfillment card has consistent fields, a neutral accepted-policy card and a shared action row. Refresh reads saved order data and paints only fulfillment/shipment history; payment controls, notes and operator drafts remain intact. Standard automatic polling and courier completion are unchanged.
- The external-parcel test section and its operator controls are removed. Existing diagnostic data and private backend endpoints are retained; this does not remove an assigned J&T shipment or change provider processing.
- Customer cancellations defaults to All cancellations and keeps the original customer-request statuses and routing. Archive becomes available only after a final decision and financial resolution. The order, customer visibility, reports and financial queues are not archived.
- A separate cancellation archive retains each request snapshot. Archives offers View and Restore, without permanent/automatic deletion. Superseded request snapshots stay readable; Restore cannot replace a newer request or unarchive its order.
- Online refunds uses 10 API records per page, retaining its current filters and actions.

## Deployment

Deploy the PHP files, migration, shared assets and the four updated Admin/Staff Orders/Archives entry points together. The affected pages use cache version `2026.1111.8`. Team PWA routes use those canonical files.

Run the additive migration in the deployed backend folder:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan migrate --force
php artisan optimize:clear
```

No environment, provider key, cron, payment/refund calculation, delivery-timing or Customer asset changes are required. The new table is `order_cancellation_archives`; it never uses `orders.is_archived` as a cancellation-history flag. If the migration has not run, order readback remains available and cancellation archival reports a setup requirement.

After deployment, verify both roles using owned records: unpaid online approval blocked; cash pickup still approvable; confirmed payment enables approval; Refresh leaves entered drafts intact; All cancellations is the initial filter; an eligible request archives/restores without hiding its order; pending refunds stay unarchivable; the eleventh refund is on page 2. Confirm normal hosted payment/provider updates separately.

## Verification boundary

Local validation completed: 902 backend tests passed with 11,691 assertions. The 26 targeted frontend/browser tests passed, covering both roles, approval eligibility, isolated fulfillment refresh, preserved drafts, cancellation archive/restore, 10-row refund pagination, cash pickup, custom cash refunds, unchanged order routing, and automatic Customer tracking readback. One browser navigation timed out during the concurrent run and passed on isolated rerun. Desktop and phone screenshots were checked in light and dark themes; JavaScript syntax checks and `git diff --check` passed.

Local tests use isolated databases, fake provider responses and browser API fixtures. They do not execute a real payment/refund, prove live provider delivery, or deploy to Hostinger. Orders Directory routing and Returns & Refunds actions remain unchanged.
