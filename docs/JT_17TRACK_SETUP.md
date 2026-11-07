# J&T delivery with 17TRACK automatic tracking

17TRACK is FMRC's only active tracking provider. Staff records the actual J&T waybill once. The existing minute worker registers it, receives signed updates, and saves the timeline. Admin, Staff, and Customer Orders display saved changes automatically while the relevant view is open.

Local tests are separate from live verification. An API account, deployment, matching real parcel results, a signed callback, and actual notification delivery are still needed before calling the live integration complete.

## 1. Create the API account

1. Open [17TRACK Tracking API](https://www.17track.net/en/api) and select **Start My Free Trial**. Choose the API service for your custom FMRC website.
2. Enter the real project/company details, website `https://ucn-fabmanlab.com`, and an email and phone controlled by the team. Complete the requested verification.
3. Open the [API console](https://admin.17track.net/api/dashboard), then Settings. Obtain the API security key and check the available tracking credits. Public tracking success alone does not establish API access.
4. Keep the key privately in Hostinger's backend `.env`. Do not put it into frontend code, screenshots, Git, or chat.

Documentation checked on November 7, 2026 says new accounts receive **200 tracking numbers once**, not monthly. Use the actual account balance when choosing the FMRC budget. Diagnostics and other applications using the same account also consume credits.

## 2. Deploy the application and additive migration

Deploy the backend and canonical root frontend folders together. Laravel and the Apache aliases serve those root folders. Do not copy into `backend/public/frontend`; that directory contains obsolete recursive copies.

For the existing production database, run in Hostinger's terminal:

```sh
php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan migrate --path=database/migrations/2026_11_07_000001_add_17track_subscriptions.php --force
```

This requires the existing shipment tables. A fresh development installation should run the normal full migrations. The migration preserves physical handovers, waybills, shipping prices, timelines, and historical provider identifiers. It creates a separate disabled 17TRACK configuration. Previous provider verification cannot enable it.

The old tracking client, command, configuration, and webhook routes have been removed. Historical rows and original migrations remain for database compatibility. Remove the obsolete webhook from the old provider dashboard and unused `SHIP24_*` settings from the production `.env`. This release does not use those credentials.

## 3. Configure the backend privately

In `public_html/backend/.env`, add or update:

```dotenv
TRACK17_API_KEY=YOUR_PRIVATE_API_SECURITY_KEY
TRACK17_ENABLED=false
TRACK17_REGISTRATION_LIMIT=200
TRACK17_ALLOW_DEMO_HANDOVER=false
```

Replace the placeholder privately. Set the limit to FMRC's confirmed allocation. It is a **lifetime local budget**: calendar changes and key rotation never replenish consumed reservations. Increase it only when additional credits are actually available to FMRC.

Then run:

```sh
php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan config:clear
```

If this installation normally caches configuration, rebuild that cache after environment changes.

## 4. Configure the webhook

1. In 17TRACK's API Settings → WebHook, save:

   `https://ucn-fabmanlab.com/api/webhooks/17track`

2. Run the dashboard webhook test. GET/HEAD readiness returns an empty HTTP 200; this alone does not verify a parcel update.
3. Real POST callbacks require the `sign` header. FMRC verifies SHA-256 of the untouched request body, `/`, and the API key. It returns **HTTP 200 after durable storage**, then processes the message through the minute worker.
4. If a dashboard dummy message is rejected, check its response and selected key. Do not disable signatures. The owned diagnostic parcel below provides a meaningful signed update test. Unknown subscriptions are isolated and cannot update customers.

## 5. Keep the existing cron

The existing Hostinger Custom cron should remain:

```sh
/usr/bin/php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan shipments:process
```

Use `* * * * *` (every minute). Keep one runner. If the installation already runs Laravel's scheduler every minute, it already schedules this command; do not add another runner. Existing payment/PWA jobs remain independent.

Open Admin → Shipping & Delivery. **Background processing** should show **Running** after the worker runs. A blank cron output alone does not indicate failure: successful runs are normally silent. Check the heartbeat and queued-update counts.

## 6. Test your owned parcel separately

This diagnostic can use one tracking credit. It does not create an FMRC order, write customer history, send customer notifications, or satisfy the genuine FMRC handover check.

```sh
php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan 17track:verify --carrier=100240 --tracking-number=JT0026952419687 --postcode=4604 --register-diagnostic
```

Use the parcel's actual destination postcode. If known, append its actual shipment date as `--ship-date=2026-11-07`. Do not guess the date for another parcel. The command validates J&T Express (PH), carrier `100240`, against the official carrier directory.

The first attempt may report saved registration but no events yet. Repeat the **same** command later: it reuses the persisted subscription and reads saved results. It reports API events and any signed diagnostic callback. If a pre-existing API registration has another subscription tag, FMRC rejects it instead of taking it over. Use a fresh owned diagnostic parcel or resolve that conflicting registration in the API console.

## 7. Test Customer Orders using your own external parcel

This optional Admin-only test supports the requested real QR Ph payment on the official website. The test displays a verified external parcel, such as the user's own TikTok shipment, in a separate **Tracking test — external parcel** section. It preserves the FMRC order's actual preparation stage, payment, shipping fee, stock, and fulfillment history. Delivery of the external parcel does not complete the FMRC order or enable production shipment registration.

1. Deploy the new code and run:

   ```sh
   php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan migrate --path=database/migrations/2026_11_07_000002_add_order_tracking_tests.php --force
   ```

2. Keep `TRACK17_ENABLED=false` for this test. Retain the existing minute cron. Run the same owned-parcel diagnostic command from step 6 once more to populate the saved test display; the existing registration is reused.
3. As Customer, open Products, choose a product, select **QR Ph → J&T Express delivery**, review the total and terms, place the order, and pay through the hosted checkout. **This charges real money.** Confirm FMRC shows the provider-confirmed paid status.
4. As Admin, approve that order. Open **Orders → Update Tracking Status**, expand **Tracking test — external parcel**, enter the verified diagnostic tracking number, confirm ownership, and choose **Link test tracking**. Use this test section rather than confirming a physical FMRC handover.
5. As Customer, open that same order's details. Confirm the labelled test section shows the external parcel's real courier status and history. Leave the view open: signed updates are processed by the minute worker and appear automatically. Previously completed scans can be shown immediately; future changes still depend on actual courier scans and 17TRACK's standard schedule. This is scan history, not a live driver location map.
6. Staff can view the linked test, while Admin alone can attach or remove it. Use **Remove tracking test** before recording the genuine FMRC parcel later. Linking/removing the test never cancels an order or refunds a payment. If this purchase will not be fulfilled, finish through FMRC's existing cancellation/refund process and verify the actual payment/refund result.

Only a registered diagnostic parcel with a matching account, signed diagnostic webhook, and saved tracking results can be linked. A paid and approved eligible delivery order is required. The test never sends another registration for the same diagnostic, writes courier updates into the genuine order timeline, or sends genuine shipment milestone notifications. Audit notes identify the link/removal as a system test.

## 8. Verify one genuine FMRC delivery and activate

1. Customer places an online-paid delivery order. FMRC approves and prepares it. An eligible appointment-linked custom order can use its existing confirmed Cash at FMRC rules.
2. Staff physically hands the parcel, sender details, and customer/recipient details to J&T. J&T supplies the actual waybill. Keep its complete number, including the `JT` prefix when present.
3. Admin or Staff opens Orders → **Update Tracking Status**. Record the waybill, actual handover time, and handover confirmation. The optional branch cost is internal; it does not change the accepted customer fee. Saving moves **To Ship → To Receive**.
4. Run this command, replacing the example with the real FMRC order number (a database ID also works):

   ```sh
   php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan 17track:verify --carrier=100240 --order=ORD-261107-00101 --real-handover
   ```

5. Retry with the same order until matching API scan events arrive. Keep the webhook and minute worker running. **Real waybill** and **Webhook delivery** must become **Verified** for this 17TRACK account. An outside diagnostic parcel cannot unlock these checks.
6. Set `TRACK17_ENABLED=true` in the backend `.env`, then clear/rebuild configuration as above.
7. In Admin → Shipping & Delivery, choose **Activate automatic tracking**. Staff can view readiness but cannot activate the provider or correct waybills.
8. Verify the next courier event appears automatically in an already-open Admin/Staff order and Customer Orders. Confirm the actual notification arrives. Follow the real parcel through Delivered. FMRC automatically moves the order to Completed after processing that verified courier update. Customers have no manual receipt-confirmation action.

After activation, eligible new and existing unfinished J&T handovers register automatically. Cancelled, completed, refund-pending/refunded, demonstration, pickup, and already courier-delivered shipments are excluded. Existing history and last confirmed status remain during registration and outages.

## Timing and safeguards

- Standard 17TRACK carrier checks normally occur every **6–12 hours**; its documentation specifies longer checks for some statuses, including delivered/exception parcels. This mode does not buy instant carrier lookups.
- Once a signed update reaches FMRC, the next minute worker processes it. Visible Admin/Staff order views poll saved data about every five seconds; Customer Orders polls about every three seconds. Admin does not need to keep refreshing Shipping & Delivery.
- Every six hours, FMRC also reads saved provider results to recover missed callbacks. Manual refresh requests the same saved results through the worker, with a 15-minute limit. It does not force a fresh carrier scan or purchase an immediate lookup.
- Repeated snapshots and milestone notifications are deduplicated. Older scans cannot replace newer confirmed status. Expiration/stoppage retains the last confirmed information.
- A verified Delivered update for the current real FMRC shipment completes the order once. It does not mark a payment paid, issue a refund, change stock quantities, or change accepted shipping charges. Completion counts and return eligibility follow the new state. External parcel tests cannot complete an FMRC order.
- The full Update Tracking Status modal remains available. Saved facts are disabled. Courier stages cannot be fabricated manually; preparation note templates appear before handover, and optional FMRC notes remain separate from courier updates. Record or correct physical handover details using their own controls. Background updates preserve unsaved form drafts.

## Automatic completion and pickup collection

- Genuine J&T delivery: approval/preparation → **To Ship**; confirmed physical handover → **To Receive**; verified 17TRACK Delivered event → **Completed**. The event retains J&T’s delivery time. `completed_at` records when FMRC processes completion, so the customer receives the full existing seven-day return window even after a delayed update.
- Pickup: Admin/Staff marks the order ready, confirms the full payment, then opens Order Details and chooses **Confirm pickup collection** using the pickup code in the customer’s order. Custom products retain their existing production and collection action. Customers do not mark themselves collected or received.
- Repeated callbacks cannot repeat completion or move it backwards. The existing worker also completes eligible real shipments that already have a saved, confirmed 17TRACK Delivered event. Review outstanding Delivered shipments before deployment because this may move genuine existing orders into Completed and begin their return window.
- The old customer `/received` endpoint returns a managed-completion conflict for older cached pages. Generic tracking updates cannot complete fulfillment or move Completed back to an earlier stage.
- A linked external TikTok parcel, diagnostic subscription, demonstration, old corrected waybill, unpaid/refunded/cancelled order, or another account/carrier cannot complete an FMRC order. Never record an external parcel as a real FMRC handover.
- Readiness separates signed diagnostic tests from live shipment verification. **Test connection verified** is not **Active**. Admin sees each missing check and the next action; a stale worker is **Needs attention**.

## Deploying this improvement

1. Push/deploy the changed backend and canonical shared portal assets together. This change adds no database migration; retain the earlier 17TRACK and order-test migrations.
2. Run `php artisan config:clear` and `php artisan route:clear` from `backend`. Retain the existing every-minute `shipments:process` cron. Run it manually once to process pending updates and reconcile eligible saved Delivered shipments.
3. Reload the browser with Ctrl+F5. Verify the five-row rates table, draft publication, locked fields, FMRC notes, pickup-code action, and updated tracking readiness in both portals.
4. For an actual FMRC parcel, complete the genuine handover verification above; receive its signed callback; enable the environment switch; confirm a recent worker heartbeat and allowance; then activate from Admin. Do not bypass those gates using a personal TikTok parcel.
5. With an owned, clearly identified test transaction, confirm hosted checkout → QR Ph payment receipt → approval → genuine handover → automatic Delivered/Completed → correct return deadline and rating eligibility. Check receipt/refund reconciliation separately and confirm the real notification arrives. Keep unrelated customer orders unchanged.


## Troubleshooting

| Display | Check |
| --- | --- |
| Setup/verification required | Private API key, cached configuration, correct carrier, real FMRC parcel, signed matching callback |
| Waiting for registration | Activation, order eligibility, worker heartbeat, local budget |
| `response_mismatch` | Wrong tag/carrier/account or another application's registration; do not retag blindly |
| `credentials_rejected` | API key and account permissions; saved waybills remain available |
| `quota_limit_reached` | Provider balance and FMRC lifetime allocation; do not reset counters |
| `rate_limited` / `connection_unknown` | Allow backoff; reuse the same subscription/order rather than creating another |
| Stopped/expired tracking | Use the official J&T fallback and investigate in the API console |
| Notifications awaiting delivery | Minute worker and existing email/PWA configuration |

## Pause / rollback

Pause in Admin or set `TRACK17_ENABLED=false` and refresh configuration. New registrations and scheduled result lookups stop. Signed callbacks and queued notifications remain processable; keep the minute worker running. Saved waybills and history remain available through the official J&T fallback.

Do not drop tables to pause tracking. Corrected waybills stop the old 17TRACK subscription only after identity checks. Stopping tracking never cancels physical J&T transport. There is no automatic fallback to another tracking provider.

## Official references

Validation must distinguish local fixtures from hosted evidence. The backend regression suite and browser commands below exercise order completion, pickup-code collection, payment/refund safeguards, external-test isolation, paginated delivery rates, and both portal layouts. Provider calls in these local tests use fixtures. User-supplied Hostinger output confirms diagnostic API events and a signed diagnostic webhook; it does not establish genuine FMRC shipment verification, hosted payment/refund completion, or notification delivery.

Local validation on November 7, 2026: **810 backend tests passed (10,356 assertions)** and **210 frontend checks passed**, including the isolated Apache routes check. Chrome suites passed for shipping refresh/publication, five-row pagination, bounded delivery-area editing, Admin/Staff dialogs, disabled facts, pickup-code collection, automatic completion readback, external-test separation, and connected checkout/tracking behavior. The focused note-save check also verifies that an automatic refresh cannot re-enable or duplicate an in-flight save.

```sh
# From backend:
php artisan test --compact
# From the repository root, one browser suite at a time:
node --test --test-concurrency=1 backend/tests/Frontend/*.test.cjs
node --test backend/tests/Frontend/shipping-refresh.browser.cjs
node --test backend/tests/Frontend/order-fulfillment-ui.browser.cjs
node --test backend/tests/Frontend/shipping.browser.cjs
```

- [17TRACK API documentation](https://api.17track.net/en/doc)
- [API account and webhook quick guide](https://help.17track.net/hc/en-us/articles/30944262120729--Tracking-API-Quick-Guide)
- [Official carrier directory](https://res.17track.net/asset/carrier/info/apicarrier.all.json)
- [J&T Philippines tracking](https://www.jtexpress.ph/track-and-trace?waybillNo=&flag=1)
