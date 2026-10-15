# School GCash / QR Ph setup and rollout

Implementation is local; it has not been deployed or tested with real money. New online checkout defaults to disabled. COD/COP remain available. Never enter a GCash OTP or MPIN on FMRC.

The dashboard supplied on October 14 shows QR Ph Active and direct GCash Inactive. New checkout defaults to `PAYMONGO_CHECKOUT_METHOD=qrph`: customers pay through the provider's order-specific QR using GCash or another supported QR Ph app. QR Ph does not provide direct GCash app authorization. Keep this setting until direct GCash is approved; `gcash` is available as an explicit future configuration. Each attempt stores its method, so configuration changes cannot reinterpret older transactions or change an unresolved retry's provider payload. Confirmed QR receipts are labeled QR Ph because the provider does not identify which wallet the customer used.

## 1. Register the school merchant

1. Have the school designate its authorized representative and official receiving bank account.
2. Create the institutional PayMongo account and complete representative identity verification.
3. Follow the account-specific government entity checklist: enabling law/charter, board authorization naming the signatory and bank account, officials list, signatory ID, applicable authorization letter/BIR registration, official bank certificate and signed MOA. PhilGEPS registration is recommended. Do not substitute a sole proprietor business permit without PayMongo instructions.
4. Publish accurate institutional contact details, products/prices, privacy/terms, delivery/pickup and refund/cancellation policies approved by the school.
5. Confirm the school merchant identity and receiving account with PayMongo. In Settings > Payment Methods, verify the selected rail is Active. QR Ph supports GCash scanning; direct GCash requires separate approval and is unavailable to Individual accounts. An active QR capability alone does not establish approval to collect university funds under a personal identity.

Official references: [Government entities](https://docs.paymongo.com/docs/account-settings-government-entities), [verification](https://docs.paymongo.com/docs/account-settings-verification-requirements), [capabilities](https://docs.paymongo.com/docs/account-settings-account-capabilities).

## 2. Deploy disabled, first to staging

Use a separate staging database and test credentials. Back up files and database. PHP 8.3 and the existing Composer dependencies are required.

Build the allowlisted update from the repository root:

    python tools/pwa/build-payments.py

The output/fmrc-gcash-payment-update.zip uses root-relative paths, like the existing PWA update workflow. Extract into the existing public_html, with folder name . (one dot); do not create public_html/public_html. Keep backend storage, environment files and dependencies protected. This package does not contain credentials or customer data. It does not recursively copy backend/public/frontend.

Configure the private backend .env using backend/.env.paymongo.example:

    PAYMENT_GATEWAY=paymongo
    PAYMONGO_ENABLED=false
    PAYMONGO_CHECKOUT_METHOD=qrph
    PAYMONGO_SECRET_KEY=<test key in staging; live key in production>
    PAYMONGO_WEBHOOK_SECRET=<matching webhook signing secret>

APP_URL and FRONTEND_URL must point to the correct HTTPS site. APP_ENV=production rejects test keys. Remove obsolete simulator/automatic-confirm flags; they no longer authorize payments. Never paste secrets into browser code or commit .env.

Check migration status. Apply pending prerequisite order/return migrations through the normal deployment process, then these additive migrations if pending:

    php artisan migrate --path=database/migrations/2027_01_05_000000_add_paymongo_columns_to_payments.php --force
    php artisan migrate --path=database/migrations/2027_01_06_000000_create_gateway_payment_ledger.php --force
    php artisan migrate --path=database/migrations/2027_01_07_000000_add_checkout_method_to_payment_ledger.php --force
    php artisan optimize:clear

Run from backend. If SSH is unavailable, have the hosting operator execute these exact commands through its supported CLI. Do not expose a public migration installer.

## 3. Configure webhook and scheduler

Register an HTTPS webhook at /api/webhooks/paymongo for checkout_session.payment.paid and available refund events. Use separate test/live webhook registrations and signing secrets. Invalid or missing signatures fail closed. Events are stored and deduplicated; provider retrieval verifies money, currency, mode and association.

Configure exactly one cron every minute, using your actual PHP binary and absolute backend path:

    * * * * * /path/to/php /absolute/backend/artisan schedule:run

Alternatively run /absolute/backend/payments-hostinger-cron.php every minute. The existing pwa-hostinger-cron.php only handles notifications and does not run payment reconciliation. Use persistent shared cache storage for scheduler locks and heartbeat.

Open Orders > Online payments & refunds as Admin or Staff. Verify the reconciliation heartbeat changes across actual scheduled minutes and pending inbox events drain. A manual local command is not evidence that hosting cron runs.

Run these read-only checks from the deployed backend folder; neither creates a checkout or moves money:

    php artisan payments:check
    php artisan payments:check --provider

The second command verifies that the selected method is available to the configured API key. Output contains no secrets. Checks cover private credentials, HTTPS origins, ledger migrations, and a recent reconciliation heartbeat. Disabled new checkout is reported separately and is allowed during preparation. Missing settings, schema, stale heartbeat, invalid or unavailable methods produce a nonzero exit. A passing check is not proof of actual webhook delivery or a real payment.

## 4. Staging acceptance

Enable PAYMONGO_ENABLED=true only in configured staging, clear configuration cache, and enable GCash in the existing payment availability settings. New checkout requires both controls. The school absorbs gateway fees; existing shipping-charge behavior is preserved.

Check iPhone Safari, Android Chrome, desktop QR and installed customer PWA. With `qrph`, select GCash / QR Ph, place the order, and scan the provider's QR using a supported payment app. For same-phone payment, use the checkout's save-QR option and the app's QR-image option if supported. Do not promise an automatic app launch. With separately activated `gcash`, follow the provider's GCash authorization flow. Return to FMRC to see confirmation. Redirect parameters never mark an order paid. Only confirmed provider data does. Paid orders still await Admin/Staff preparation approval.

Exercise cancellation, insufficient funds, expiry, unavailable app, offline return, repeated clicks, concurrent retries, delayed/duplicate/out-of-order events, invalid signatures, amount/currency/mode mismatch, early webhook, payment after cancellation and interrupted reconciliation. Check customer ownership and Staff restrictions. Request partial/full refunds as Staff, approve as Admin, and confirm provider success/failure and reports. Verify stock and order approval separately.

Hosted sessions have no assumed automatic expiry. A QR Ph code normally expires after 30 minutes, while its session may remain active and regenerate a QR on the same checkout URL. FMRC does not treat `qrph.expired` as proof the session expired. Mobile app opening and desktop QR are provider/device-controlled; literal one-tap charging and continuous availability are not guaranteed. [QR Ph](https://docs.paymongo.com/docs/payment-acceptance-qr-ph), [Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout).

## 5. Live activation

After the merchant identity and selected payment rail are approved, set the live key and live webhook secret privately. For the currently active QR rail, use `PAYMONGO_CHECKOUT_METHOD=qrph`. Keep new checkout disabled until migrations, HTTPS/webhooks and the hosting heartbeat are verified. The authorized school owner then enables checkout for a controlled small real payment and refund before general launch. Confirm the order changes to Paid automatically and the payment appears in the matching PayMongo account. No such payment or deployment was performed in this development session.

Payment confirmation is distinct from the school's bank payout schedule. [Payouts](https://docs.paymongo.com/docs/money-movement-payouts).

## Operations and recovery

- Customers can resume a usable checkout. Uncertain creates reuse the original idempotency key within 23 hours; they cannot create a fresh charge while unresolved. [Provider idempotency](https://docs.paymongo.com/reference/idempotent-requests).
- Admin can reconcile and attach a missing checkout/refund provider ID from the merchant dashboard. FMRC verifies association before accepting it. After the safe retry window, use this recovery or PayMongo support; never guess that a timeout means failure.
- Staff can request refunds; only Admin can approve/issue or reject. Pending and uncertain refunds reserve the refundable balance. Confirmed partial refunds remain visible; full refunds update the payment summary. Duplicate successful receipts are recorded separately and can be refunded against their original charge. [Refund resource](https://docs.paymongo.com/reference/refund-resource).
- Late payment on a cancelled order stays an exception for refund review and does not reopen fulfillment.
- Review historical simulated/linked records using the review filter. Their original financial status is preserved; simulated and pending transactions are excluded from confirmed receipts. Investigate against provider/bank records outside the automated ledger.
- Refunds initiated directly in the PayMongo dashboard outside FMRC are not automatically imported into FMRC's refund-request ledger. Reconcile these administratively before further refunds.
- To stop new payments, set PAYMONGO_ENABLED=false and clear configuration cache. Keep hardened code, ledger, webhook and cron running for existing confirmations/refunds. Do not roll back financial tables or restore simulator code.

## Verification boundary

Automated tests use provider HTTP fixtures and SQLite. They do not establish live provider acceptance, MySQL concurrency, phone authorization, rendered browser behavior or hosting cron operation. The local browser fixture is backend/tests/Frontend/fixtures/gateway-payments.html; it moves no money and is excluded from release. Device, browser, production and real-payment acceptance remain mandatory before launch.

Local verification on 2026-10-09: 82 targeted payment/PWA backend tests passed (495 assertions); after two additional edge cases, the gateway suite passed 25 tests (101 assertions). All 43 payment frontend tests passed. Syntax checks and git diff --check passed. The full backend run initially reported 526 passes and five failures; its payment/PWA failure was corrected and verified in the targeted run. Four remaining failures concern unchanged portal page-count, maintenance-preview assets, dashboard CSS and announcement theme expectations. Rendered browser/device tests were unavailable in this session.

On 2026-10-14, a read-only live API capability request confirmed `qrph` for the locally configured key. The local readiness command reported incomplete HTTPS origins, pending ledger migrations, and no recent scheduler heartbeat. These are local observations, not a diagnosis or deployment of the hosted site's environment. No payment was created by this capability check.

QR Ph verification on 2026-10-14: the payment/report/readiness suites passed 46 tests (1,443 assertions); the frontend payment suites passed 46 tests. The broader targeted payment/PWA run passed its other 74 tests; its two outdated test expectations were corrected and included in the passing rerun. Sixteen changed PHP/JS files passed syntax checks. Tests cover signed v2 notifications, duplicate delivery, receipt source/amount/currency/mode checks, pinned retry payloads after method changes, QR expiry versus session expiry, refunds, and accurate QR Ph reporting. Browser inventory was empty, so rendered browser/mobile and real-payment verification remain outstanding.
