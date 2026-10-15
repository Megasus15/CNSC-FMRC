# FMRC production QR payment release

Target: https://ucn-fabmanlab.com/ (not staging).
Prepared October 15, 2026. This is a deployment guide, not evidence of deployment.

## GitHub Desktop

Refresh Changes. Local browser profiles and PDF render outputs are now ignored.
Review the remaining changes, including payment source, tests, documentation and
build tools. Do not add private .env files, browser profiles, registration document
images or deployment ZIPs. Suggested commit: `Add hosted QR Ph checkout and payment status recovery`.
Commit and push using GitHub Desktop. Before pushing, check whether Hostinger Git
auto-deployment is enabled. A push alone is not proof of deployment; no tracked
GitHub Actions workflow was found during this preparation.

## Production preparation

1. Select `ucn-fabmanlab.com` in Hostinger's website selector.
2. Back up this site's files and export its production database.
3. Preserve production `backend/.env`, storage, uploads and dependencies. Never
   copy staging's environment or database over production.
4. In production's private environment set `PAYMONGO_ENABLED=false` during setup.
   Keep `PAYMENT_GATEWAY=paymongo` and `PAYMONGO_CHECKOUT_METHOD=qrph`.
   Production APP_URL and FRONTEND_URL must be `https://ucn-fabmanlab.com`.
   Retain the production database settings. Do not use test API keys on production.
5. Clear cached configuration after environment changes using `php artisan config:clear`
   from the production backend directory through SSH or a temporary Hostinger cron.

## Files and schema

Build `python tools/pwa/build-payments.py`. Upload
`output/fmrc-gcash-payment-update.zip` to the official site's `public_html`.
Extract into that same directory with overwrite, not a nested `public_html` folder.
The archive contains the complete payment update, including the latest button fixes;
the smaller modal/button ZIPs alone do not install the backend integration.

Check `php artisan migrate:status` in production's backend first. If prerequisites
are present, run only pending payment migrations:

```sh
php artisan migrate --path=database/migrations/2027_01_05_000000_add_paymongo_columns_to_payments.php --force
php artisan migrate --path=database/migrations/2027_01_06_000000_create_gateway_payment_ledger.php --force
php artisan migrate --path=database/migrations/2027_01_07_000000_add_checkout_method_to_payment_ledger.php --force
php artisan optimize:clear
```

If these schemas were already imported manually, verify the schema and migration
history before running migrations. Do not blindly import the staging SQL or rerun
CREATE migrations against manually installed tables. The production SQL in output
also assumes existing PayMongo columns: inspect the actual database before using it.

## Live configuration and verification

Use production's live API key and a matching live webhook registration at:
`https://ucn-fabmanlab.com/api/webhooks/paymongo`.
Subscribe to `checkout_session.payment.paid`, `payment.refunded`, and
`payment.refund.updated`, as available in the dashboard. Save its signing secret
only in production's private environment.

Verify one payment cron for the production backend, using either its existing
`payments-hostinger-cron.php` or `artisan schedule:run`. Do not duplicate a running
payment cron. The PWA notification cron alone does not run payment reconciliation.

Run `php artisan payments:check --provider` from the production backend and inspect
the output. This checks configuration, schema, scheduler heartbeat and method
capability; it does not prove actual webhook delivery or merchant authorization.

The merchant classification correction is still pending according to the support
conversation. QR Ph capability being Active does not itself resolve the school
merchant identity. Confirm authorization to collect FMRC funds with the authorized
university representative and PayMongo before accepting real customer payments.

Once those items are resolved, set `PAYMONGO_ENABLED=true` in production, clear
configuration cache, and enable the online payment option in FMRC payment settings.
Keep staging on test credentials. Direct GCash is a separate future activation;
do not change production checkout_method to gcash while it is inactive.

Run a controlled small real QR payment with the authorized account owner. Verify:
PayMongo shows paid, webhook delivery succeeds, FMRC confirms the same order and
amount, live receipts appear in the applicable revenue report, order fulfillment
still requires staff approval, and a controlled refund is handled correctly.
Refresh desktop/mobile pages and verify the Check payment result and timestamp.

If new checkout must be stopped, disable PAYMONGO_ENABLED and clear config cache.
Keep the ledger, webhook and reconciliation running for existing payments/refunds.
Do not restore an old database over newly recorded payments.
