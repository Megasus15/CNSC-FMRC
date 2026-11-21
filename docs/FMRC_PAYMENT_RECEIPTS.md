# FMRC payment receipts

Customers can find eligible receipts in **My Orders → Order Details → Payment → Download Receipt**. The **Orders → Payment confirmed** email template sends the same saved PDF. The receipt identifies the payment and directs customers to the FMRC team for payment inquiries and document requests.

## Hostinger release

Deploy the commit through the existing Git deployment. Open the terminal in this site's backend. Install the locked dependencies and run the receipt migration with issuance disabled.

```sh
cd ~/domains/ucn-fabmanlab.com/public_html/backend &&
composer2 install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-scripts &&
php artisan clear-compiled &&
php artisan package:discover --no-interaction &&
php artisan migrate --path=database/migrations/2027_01_20_000000_create_order_payment_receipts_table.php --force &&
php artisan config:clear &&
php artisan route:clear
```

Hostinger disables `proc_open` on this site. Composer uses PHP's ZIP extension to extract packages. `--no-scripts` skips the attempted child process, and the following Artisan commands register packages directly. [Composer scripts](https://getcomposer.org/doc/articles/scripts.md)

Keep `FMRC_PAYMENT_RECEIPTS_ENABLED=false` or omit the setting until the release check succeeds. The existing every-minute `artisan schedule:run` cron runs payment reconciliation and receipt processing in its PHP process. On hosts using the standalone `payments-hostinger-cron.php` job, that job runs both workers. Use one payment runner per environment. [Hostinger cron jobs](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/)

Check the latest scheduled output in hPanel for both workers. From the production backend, run `php artisan payments:check` and look for `PASS Reconciliation scheduler: Recent heartbeat found`.

Send one sample through the host's configured mail transport, substituting the designated test Gmail address. The command uses fictional order details and needs no customer order or payment.

```sh
php artisan payment-receipts:process --test-to=designated-test@example.com
```

Open the `[Test] Payment confirmed` message in Gmail and download its attachment. Verify the PDF, sender, and FMRC contact footer. Once the schedule and Gmail checks pass, set `FMRC_PAYMENT_RECEIPTS_ENABLED=true` in the private backend `.env` and run `php artisan config:clear`. Use fixture payments or a test environment for a defense demonstration.

## Delivery and corrections

- The receipt table starts with newly confirmed payments. Each document has a separate number and a snapshot of its order prices and payment details.
- The worker saves the PDF under `storage/app/private/order-payment-receipts` before emailing it. Keep that directory in the application's protected backups. A mail failure can still leave a usable download in My Orders.
- Temporary failures retry with increasing delays. The application log reports the receipt ID and error class. A send interrupted after taking ownership of the job is marked `needs_review` after five minutes. Check the mail provider's delivery log before retrying an uncertain send.
- A cash correction removes the voided receipt from the customer's downloads. The correction email states its receipt number. A subsequent full confirmation creates a new record. Refunds use the existing refund workflow.
- To pause new issuance and scheduled receipt sends, set `FMRC_PAYMENT_RECEIPTS_ENABLED=false` and clear the config cache. Customers can still download their previously issued PDFs.
