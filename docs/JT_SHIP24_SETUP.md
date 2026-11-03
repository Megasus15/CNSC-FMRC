# J&T drop-off and Ship24 tracking

## Current release state

New delivery orders use J&T Express and the existing provider-hosted online payment flow. Cash on pickup and historical COD records remain supported. Staff physically hands the parcel to J&T, then records its actual waybill in Orders. FMRC retains the customer's accepted shipping fee; the optional branch charge is internal only.

**Automatic tracking is inactive, as requested.** No Ship24 account, credentials, or real Philippine waybill has been verified. This implementation does not book J&T transport, generate a waybill, collect COD, or report driver GPS. It does not require direct J&T API credentials.

## Operator flow

1. Customer chooses J&T delivery, accepts the existing shipping quote and policy, and pays through hosted checkout (currently QR Ph, including supported e-wallets).
2. FMRC accepts the order after provider-confirmed payment and prepares it.
3. After physical drop-off, Admin or Staff opens Order Details → Record J&T waybill. Enter the complete number, actual handover time in Philippine time, and optional branch charge. Confirm the handover.
4. Saving moves the order to To Receive immediately, even if tracking is inactive or unavailable. The customer sees the waybill, Copy action, official J&T link, and clearly labeled FMRC/courier history.
5. With automatic tracking active, updates are stored in FMRC in the background. Opening or refreshing an order does not call Ship24.
6. Customer confirmation of receipt remains separate from courier delivery. Courier events cannot change payments, refunds, stock, revenue, or complete the order.

Staff can record handovers, add FMRC notes, and request eligible retries. Admin alone can correct a waybill with a reason and version check, or activate/pause automatic tracking. Corrections retain the old history and stop old callbacks affecting the replacement; unsubscribing never cancels physical transport.

An unpaid, test-paid, cancelled, refund-pending, incomplete, unaccepted, or pickup order cannot be dispatched using this flow. Local demonstrations may explicitly use `SHIP24_ALLOW_DEMO_HANDOVER=true` outside production; these shipments are labeled as demonstrations and never sent to Ship24.

## Installation

Deploy backend files and the canonical root frontend folders together. Do not copy into `backend/public/frontend`: it contains obsolete recursive copies. Laravel's `PwaAssetController` and the Apache aliases serve the root page folders. Changed asset URLs have new cache versions.

From `backend`, install the additive migration:

```sh
php artisan migrate --path=database/migrations/2026_11_03_000001_add_ship24_tracking.php --force
```

Keep these defaults until account setup and real verification are available:

```dotenv
SHIP24_ENABLED=false
SHIP24_API_KEY=
SHIP24_WEBHOOK_SECRET=
SHIP24_MONTHLY_REGISTRATION_LIMIT=10
SHIP24_ALLOW_DEMO_HANDOVER=false
```

Secrets belong in the deployment environment, never frontend files, source control, screenshots, or chat. The webhook secret is separate from the API key. Use a shared persistent cache store supporting atomic locks (database/Redis; file for a single host). Do not use the array cache in a deployed worker.

The existing scheduler must execute every minute:

```cron
* * * * * cd /absolute/path/to/backend && php artisan schedule:run >> /dev/null 2>&1
```

`shipments:process` runs through this scheduler with a lock shared by registration verification. It processes a bounded inbox, registrations, reconciliation, unsubscribes, and notification retries. The scheduler also retains the existing payment and PWA commands. Configure working mail transport and run the existing PWA processor for push delivery. SMTP now has a default 10-second timeout (`MAIL_TIMEOUT` may override it).

## Account verification and controlled activation

Use Ship24's **Tracking API and Webhook, per-shipment plan**. The documented free allowance is currently 10 shipments/month, not 100 automatic trackers. Confirm the actual account allowance before use; never auto-purchase or upgrade.

1. Configure the two secrets on the backend; retain `SHIP24_ENABLED=false`. Rebuild the deployment's configuration cache after environment changes.
2. List the account's actual J&T carrier entries:

   ```sh
   php artisan ship24:verify
   ```

3. Verify the exact active Philippines entry and its required fields:

   ```sh
   php artisan ship24:verify --carrier=EXACT_PROVIDER_CODE
   ```

   No carrier code is guessed or preconfigured. Non-Philippine, deprecated, or unsupported account-required entries are rejected. If `courierAccount` or other unsupported information is required, leave tracking inactive and ask Ship24 about that carrier's access requirements.

4. Configure the public HTTPS callback in Ship24 as `https://YOUR_DOMAIN/api/webhooks/ship24` with `Authorization: Bearer YOUR_SEPARATE_WEBHOOK_SECRET`. HEAD must return 200. The same empty readiness response is available through GET for hosting proxies that forward HEAD as GET. Neither readiness method stores or processes updates. Authenticated POST returns 202 only after durable storage. Confirm the hosting proxy forwards Authorization. A dashboard test alone verifies connectivity, not an actual parcel.
5. Record one genuine prepaid parcel physically handed to J&T Daet. Its payment must have a matching full-value, live provider receipt. Verify its FMRC order ID:

   ```sh
   php artisan ship24:verify --carrier=EXACT_PROVIDER_CODE --order=ORDER_ID --real-handover
   ```

   This can consume one free shipment. It succeeds only after matching J&T carrier events are returned. If there are no scans yet, retry later with the same order. Timeout retries reuse the saved client identifier and payload. Specific provider failure codes are retained on the subscription and shown by the command.
6. Confirm receipt/processing of an authenticated callback, the scheduler health, and actual notification delivery. Set `SHIP24_ENABLED=true`, refresh configuration, then activate in Admin → Shipping & Delivery. The switch remains unavailable without carrier, real-waybill, account, and webhook evidence. Staff has read-only access to this configuration.
7. Follow the real parcel through courier delivery and separate customer receipt confirmation. With a healthy scheduler, target displaying an accepted webhook within two minutes. This does not measure the delay from J&T's physical scan to Ship24 discovering it.

## Failure handling and limits

- Ship24 is never contacted during customer/admin order views. Active results are reconciled every six hours; operator requests are limited to one per shipment per 15 minutes.
- Provider quota/rate-limit/outage responses use backoff. Unknown or contradictory identifiers are quarantined; terminal contradictions require review. Duplicate provider events do not duplicate timeline entries or milestone alerts. Date-only events stay date-only; original timestamps and offsets are retained.
- The local monthly cap counts registration requests, including uncertain responses, conservatively. The UI labels confirmed creations as **FMRC registrations**. These are calendar-month counts for this installation, not authoritative Ship24 billing usage/reset dates. Other applications using the same account consume its allowance too.
- At capacity, shipping continues with saved waybills and the official J&T link. Pending registrations resume when the local/provider limits permit. Nothing automatically upgrades the subscription.
- In-app notifications are deduplicated separately from email retry. Like SMTP generally, a process failure after mail acceptance but before the sent marker is saved can result in a repeated email; this is not exactly-once mail delivery.
- Shipping & Delivery shows connection/verification, pending/failed registrations, unmatched updates, pending notifications, and last worker/webhook activity. Unmatched inbox entries remain stored for diagnosis; they cannot update orders.

## Rollback

Pause automatic tracking in Admin, or set `SHIP24_ENABLED=false` and refresh configuration. Scheduled provider requests and new registrations stop. Authenticated updates already arriving are still safely received and processed; saved waybills and history remain available. Keep the minute scheduler running for inbox/notifications. Do not roll back/drop the migration to pause this feature. Stopping Ship24 tracking does not cancel a physical J&T shipment.

## Verification evidence and release checklist

Local automated checks cover paid dispatch eligibility, test-payment isolation, idempotency/version conflicts, timeout recovery, quota recovery, webhook authentication/batching/early callbacks/deduplication, dates/offsets, terminal conflicts, refresh throttling, separate customer receipt, and notification retry. Historical Ninja Van tests build prior shipments through the service while confirming the public booking endpoint is retired.

- Focused backend suite: 80 tests / 564 assertions passed.
- Readiness compatibility follow-up: all 21 Ship24 tests / 166 assertions passed, including empty GET/HEAD responses, no inbox writes from readiness requests, and rejection of unauthenticated POST requests. This accommodates hosting proxies that forward HEAD as GET; the callback must be retested on the hosted site after deployment.
- Payment/checkout frontend tests: 67 passed.
- Real Chrome fixture run: checkout quotes/policy acceptance, Admin/Staff handover/correction/reload/drafts, and Customer tracking at 320/390/768/1440px; both operator themes. Provider calls and customer data are simulated. External font/CDN downloads are blocked in this fixture; font inheritance is checked separately from remote font loading.
- Full backend suite: 736 passed; four existing `AdminPortalConsistencyTest` failures concern maintenance-preview shared assets, inconsistent report script versions, dashboard report-button CSS, and announcement theme CSS. Their source files are unchanged by this work.
- New migration applied successfully to local MySQL. The worker ran successfully with zero registrations; health confirmed tracking is disabled and credentials are absent. Local HTTP checks confirmed HEAD 200 and byte-for-byte matching canonical JS/CSS. Local checks are not hosted deployment verification.

Before a live release, verify actual served JS/CSS and cache URLs, HTTPS HEAD/POST, proxy Authorization forwarding, minute scheduler behavior, mail/push receipt, hosted live payment, and the real J&T Daet parcel lifecycle. Those external checks remain outstanding while tracking is inactive.

Provider references: [API schema](https://docs.ship24.com/assets/openapi/ship24-tracking-api.yaml), [courier requirements](https://docs.ship24.com/couriers), [webhook setup](https://help.ship24.com/en/article/setting-up-webhooks-for-the-tracking-api-1iaiqes/), [date formats](https://docs.ship24.com/data-format), [pricing](https://help.ship24.com/en/article/ship24-pricing-and-plans-explained-425d9d/).
