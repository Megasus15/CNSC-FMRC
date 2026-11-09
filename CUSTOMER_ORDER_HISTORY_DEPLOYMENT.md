# Customer Orders release

Deploy the application, the shared Customer assets and the additive migration together. This release does not delete orders, payments, returns or courier events. Customer removal sets `orders.customer_hidden_at`; administrative archiving is separate.

## Hostinger

In the production backend terminal:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan migrate --path=database/migrations/2026_11_09_000001_add_customer_order_history_visibility.php --force
php artisan config:clear
php artisan route:clear
```

The new migration is `2026_11_09_000001_add_customer_order_history_visibility`. If it has not run, customer order reads continue working and removal stays unavailable. Keep existing payment and shipment cron jobs running.

Shared Customer JavaScript and CSS use cache version `2026.1109.1` across Home, Products, Services, About, Contact and the two transaction-policy pages. Verify the website and Customer PWA load those versions after deployment.

## Hosted readback

- Open an owned delivery order. Verify each courier scan appears once, actual Philippine scan timestamps and supplied driver details remain visible, and the tracking number is shown once above the timeline. Corrected waybills must show the current parcel's scans; superseded scans remain in the original audit trail.
- Open regular and custom-product order details and existing Return & Refund records on mobile and desktop. Confirm payment/claim links and evidence still open.
- An order closed fewer than seven full days ago, an active order, or an order with an unresolved claim cannot be removed. A confirmed refund or final return resolution starts a fresh seven-day wait.
- Using an owned eligible closed order, check individual removal and Clear eligible orders. Reopen My Orders and its old notification link. The list/counts must exclude the removed order and the link must explain removal.
- Confirm the removed order, its original timeline, payment and refund records remain visible to Admin/Staff and continue appearing in the appropriate financial reports.

## API behavior

Customer list/detail responses include `history_removal` (`eligible`, `available_at`, `available_at_label`, `reason`, `code`). Detail responses also include the projected `customer_timeline`; the original `timeline` remains intact.

- `DELETE /api/customer/orders/{order}/history`: remove one eligible owned order; repeated removal succeeds. An ineligible order returns HTTP 409 and a reason.
- `POST /api/customer/orders/history/clear`: submit `order_ids` from the confirmed snapshot (up to 1,000 per request). Every ID must belong to the customer. The response contains `removed_ids` and any `skipped` rows with current blocking reasons. The UI batches larger selections.
- Hidden order/return detail links return HTTP 410 with `code=order_history_removed`. Customer list ETags include visibility and time-dependent eligibility.

No restore or automatic deletion is provided. Rolling application assets back retains all business data; hidden-history visibility is honored only by application versions supporting this column.

## Local checks

Run Laravel tests against the isolated testing database, and run the Customer order record/cache/payment browser suites. Browser fixtures simulate provider responses and do not perform a live checkout, refund or courier request. Hosted readback must be checked separately after deployment.
