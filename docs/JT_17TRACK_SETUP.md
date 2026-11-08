# J&T delivery with 17TRACK automatic tracking

17TRACK is FMRC's only tracking provider. Staff assigns a complete J&T tracking number once. The minute worker registers/reuses the number and processes signed callbacks. If a callback is missed, FMRC retrieves saved API results every five minutes. A valid Delivered result completes an eligible paid delivery order automatically, for both catalog and customized products.

## Current behavior

- The `JT` prefix is accepted. FMRC does not reject a number because the parcel came from TikTok or was previously used in diagnostics.
- Assigning an owned diagnostic number to an order reuses its subscription and credit reservation. Its courier results then drive that order's delivery/completion. A diagnostic or linked preview alone does not complete an order; the operator must assign it through the shipment action.
- A number can belong to **one FMRC order only**, including after completion, cancellation, correction, or preview removal. Case and surrounding whitespace are normalized. Repeated saves of the same assignment are idempotent.
- Activation no longer waits for a first parcel or signed shipment callback. The API key, verified J&T carrier, environment switch, and Admin pause switch control automatic registration. Webhook and parcel evidence remain visible without creating a circular startup gate.
- API account/carrier/number/subscription-tag checks, signed webhook authentication, confirmed payment, production readiness for custom work, and refund/cancellation checks remain enforced.

## Deploy this fix

Deploy the backend and canonical root frontend folders together. Laravel/Apache serve those root assets. Do not copy files into the obsolete recursive `backend/public/frontend` directory.

Run in Hostinger's terminal:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan migrate --force
php artisan config:clear
php artisan route:clear
php artisan shipments:process
php artisan 17track:verify --status --order=ORD-261107-00104
```

The new migration `2026_11_08_000001_enable_17track_automatic_registration.php`:

1. Creates a database reservation for each previously assigned tracking number, including historical and completed shipments.
2. Preserves legacy duplicate rows/history and marks conflicts for review; it does not delete orders or change payments. Conflicting assignments cannot register or complete another order.
3. Enables the existing 17TRACK setting once to release the former activation gate. Subsequent explicit Admin pauses remain respected; normal worker runs never undo them.
4. Retries previously failed, unregistered tag mismatches once through the new manual-registration binding logic. Unknown nonempty tags remain protected.

Keep this private backend environment configuration:

```dotenv
TRACK17_API_KEY=YOUR_PRIVATE_API_SECURITY_KEY
TRACK17_ENABLED=true
TRACK17_REGISTRATION_LIMIT=200
TRACK17_ALLOW_DEMO_HANDOVER=false
```

### Recovery when 17TRACK says Delivered but FMRC still says To Receive

The provider dashboard is separate from FMRC's saved order data. A failed API import or a worker that never completes leaves the order unchanged. A scheduler line marked DONE can also represent an overlap skip; it is not proof that courier events were imported.

This follow-up runs the shipment command inside the scheduler's bootstrapped application, using the command's own 120-second lock. It avoids a second PHP process and a second five-minute scheduler lock. Cron output now reports a completed worker run or an explicit lock/setup skip. Keep the existing production `artisan schedule:run` cron every minute; **do not add another shipment cron alongside it**.

After deploying this follow-up, run:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend
php artisan config:clear
php artisan 17track:verify --sync --order=ORD-261107-00104
php artisan shipments:process --verbose
php artisan 17track:verify --status --order=ORD-261107-00104
```

No additional database migration is introduced by this follow-up. `--sync` imports saved API results for the already-assigned number. If registration is missing, it reuses the existing provider registration or registers that assigned parcel within the existing budget. It never purchases an instant carrier lookup. Successful Delivered import completes the eligible paid order; payment and refund ledgers are not changed.

Requests are paced at 400 ms between starts, below 17TRACK's documented three requests per second. A console registration is looked up before submitting any registration, avoiding redundant daily-registration checks. HTTP 429 honors numeric or date-form Retry-After and shares its cooldown across workers with the same cache/key; repeated HTTP 429 responses do not become six-hour exponential delays. Other outages retain bounded backoff.

The old `rate_limited` label could mean two different provider conditions. They are now distinct:

- **HTTP 429 / `rate_limited`:** short-term request-frequency protection. Automatic retries respect the provider cooldown.
- **API -18019907 / `daily_limit_reached`:** the account's daily tracking allowance, separate from remaining lifetime credits. Review the daily limit in 17TRACK Settings; FMRC cannot override that provider setting.

Read the actual account allowance without registering anything:

```sh
php artisan 17track:verify --quota
```

Status output includes the order's tracking eligibility, provider registration acceptance, next retry/check, and last completed worker run. Shipping & Delivery displays retries separately from registrations and refreshes its health panel every 30 seconds without replacing delivery-rate drafts. The order card explains HTTP/daily limits and the next automatic retry. Use Ctrl+F5 after deployment to load the updated shared assets.

Use FMRC's actual available allocation for the limit. It is a lifetime local budget, including diagnostics and uncertain attempts. Calendar changes and key rotation do not replenish it. Keep the existing key private; there is no need to create another account or obtain another number for this fix. Clear/rebuild configuration after changing environment values.

For a new API account, create the API service at [17TRACK](https://www.17track.net/en/api), obtain its key privately in Settings, confirm the available allowance, and run:

```sh
php artisan 17track:verify --carrier=100240
```

The command validates J&T Express (PH) against the official carrier directory. A key/account change requires current carrier verification, but no parcel or webhook is required before registration can start.

## Webhook and worker

In 17TRACK API Settings, save the Package Webhook URL with version V2.4 and the required package-status triggers:

`https://ucn-fabmanlab.com/api/webhooks/17track`

FMRC checks the `sign` header using SHA-256 of the untouched body, `/`, and the private API key. It returns HTTP 200 after durable storage and processes updates asynchronously. GET/HEAD readiness returns 200 but does not prove a signed parcel callback. Unknown or superseded subscriptions cannot alter an order.

Retain one Hostinger Custom cron every minute (`* * * * *`):

```sh
/usr/bin/php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan shipments:process
```

If Laravel's scheduler already runs this command, keep that runner instead of adding a duplicate. Successful cron runs are normally silent. Shipping & Delivery reports the worker heartbeat; a stale worker is Needs attention. Existing payment and notification jobs remain independent.

## Assign a parcel and check automatic completion

1. Confirm the order is paid and approved. Customized work must also be ready for dispatch. Preserve the accepted customer shipping quote.
2. Open Admin/Staff Orders → Update Tracking Status and assign the full J&T tracking number using the handover action. Record handover details accurately for real shipments. Saving moves To Ship → To Receive.
3. The worker registers the number, retrieves saved results, and processes callbacks automatically. Do not register the same number manually for every order.
4. A Delivered result moves both order stages to Completed. The timeline preserves the carrier's delivery timestamp; `completed_at` is when FMRC processes completion, which starts the existing seven-day return window.
5. Open Customer My Orders and Admin/Staff Order Details to verify readback. Those open views poll saved changes; Shipping & Delivery does not need to stay open.

For an expressly assigned, owned TikTok parcel used to test a paid FMRC test order, the same automatic workflow applies. Its existing Delivered history can complete that test order, even if the scans predate the assignment. This does not create a new physical J&T shipment. Keep the test transaction identifiable when reviewing fulfillment and revenue records.

A separate unassigned diagnostic is optional:

```sh
php artisan 17track:verify --carrier=100240 --tracking-number=JT0026952419687 --postcode=4604 --register-diagnostic
```

It may reserve a tracking credit and does not create an order. If subsequently assigned to an eligible order, its existing local subscription is reused rather than registered a second time. The optional linked preview remains separate until explicitly assigned through the shipment action.

## Numbers already entered in the 17TRACK console

FMRC retrieves the existing registration with the configured API account. A blank tag, or a tag equal to the assigned order reference, is bound to the persisted FMRC subscription using the official V2.4 `changeinfo` endpoint. The result is read back and verified before applying events. Future callbacks must carry that exact tag. An uncertain response is retried using the saved identity.

FMRC does not overwrite an unrelated application's nonempty tag, change a carrier, or stop an unknown subscription. `response_mismatch` means the account/carrier/tag needs review; it does not mean the `JT` prefix is forbidden. Do not delete the local subscription to retry or reset credits.

## Timing, uniqueness, and financial safeguards

- Standard carrier checks depend on 17TRACK/J&T availability; they are not instant driver-location updates. FMRC uses standard saved-result retrieval, never paid instant carrier lookups.
- Signed callbacks are processed by the minute worker. Saved-result recovery runs every five minutes by default (`TRACK17_SAVED_RESULTS_MINUTES`, 5–360). Existing long schedules are brought forward without bypassing provider-error backoff. Manual refresh requests the same saved data, with the existing 15-minute rate limit.
- Complete matched history is retained even when staff assigns a number after an earlier scan. Duplicate/out-of-order snapshots cannot regress a confirmed newer status or repeat completion/notifications. Stopped/expired tracking retains the last confirmed facts.
- A database primary key reserves the normalized number for its order. A corrected number remains reserved in history; a completed/cancelled order does not release it. The same number cannot be attached as another order's preview or shipment. Deleted order references do not free the number.
- Courier events cannot mark payment paid, issue refunds, alter stock, or change accepted shipping fees. Unpaid, cancelled, refunded, demonstration, mismatched, and superseded shipments cannot complete an order. A diagnostic becomes an assigned subscription only through an eligible operator assignment.
- Pickup completion remains a separate Admin/Staff action requiring ready status, full payment, and the customer's pickup code. Customers cannot mark delivery or collection complete themselves.

## Status and troubleshooting

`17track:verify --status --order=ORD-261107-00104` reads local state only. It prints automatic mode, worker health, specific blockers, registration state, last saved-result check, signed-update time, courier status, and registration errors. It does not contact the provider or mutate payment/refund data.

| Display | Action |
| --- | --- |
| Inactive / backend switch off | Set `TRACK17_ENABLED=true` privately and clear cached configuration. |
| Paused | Admin can activate tracking again in Shipping & Delivery. |
| Carrier/account setup required | Verify the current key/account and carrier `100240`. |
| Waiting for first webhook | Check webhook settings; saved-result recovery still runs automatically. |
| Waiting for registration | Check eligibility, worker heartbeat, allowance, and registration errors. |
| Tracking number already assigned | Use the correct unique number; the original assignment stays reserved. |
| `credentials_rejected` | Correct the private API key/account permissions. |
| `quota_limit_reached` | Review provider balance and lifetime local allocation. |
| `response_mismatch` | Review account, carrier, and tag ownership. |
| HTTP 429 / `rate_limited` | Allow the paced automatic retry; the provider Retry-After is respected. |
| `daily_limit_reached` | Read `17track:verify --quota` and review the provider daily setting. |
| `connection_unknown` | Allow backoff; reuse the saved subscription. |
| Stopped / expired | Investigate in the API console; retain the official J&T fallback. |

## Pause and verification

Pause in Admin or set `TRACK17_ENABLED=false` and clear cached configuration. New registrations and scheduled lookups stop; authenticated callbacks/queued notifications remain processable. Keep the worker running. Pausing subscriptions never cancels physical J&T transport. There is no fallback to the retired tracking provider.

Local tests use provider fixtures and do not establish hosted deployment, real payment/refund success, or notification receipt. Validate those separately on an owned test transaction after deployment.

```sh
# From backend:
php artisan test --compact
# From the repository root:
node --test --test-concurrency=1 backend/tests/Frontend/*.test.cjs
node --test backend/tests/Frontend/order-fulfillment-ui.browser.cjs
```

Official references: [17TRACK API documentation](https://api.17track.net/en/doc), [API quick guide](https://help.17track.net/hc/en-us/articles/30944262120729--Tracking-API-Quick-Guide), [carrier directory](https://res.17track.net/asset/carrier/info/apicarrier.all.json), [J&T Philippines tracking](https://www.jtexpress.ph/track-and-trace?waybillNo=&flag=1).
