# Enable confirmed-refund archives on Hostinger

The latest update enables Archive when the row's current refund status is **Refund confirmed**. Pending refunds remain disabled. Older failed or declined attempts stay in history after a later confirmed refund for the same payment; they do not keep the confirmed row disabled.

Deploy these six application files together:

- `backend/app/Support/OnlineRefundArchive.php`
- `backend/app/Http/Controllers/Api/GatewayManagementController.php`
- `admin-page/gateway-payments.js`
- `admin-page/gateway-payments.css`
- `admin-page/orders.html`
- `staff-page/orders.html`

Both Orders pages load script version `3.2-confirmed-archive`. Reload Orders after deployment. Include the Archives page/controller files from [the release guide](HOSTINGER_REFUND_RELEASE.md) if they are not already deployed.

On the first eligible Archive action, the backend prepares missing nullable archive fields, then rechecks the refund under the existing order/payment locks before archiving. Schema setup runs outside the payment transaction and never runs during polling. Normal installations no longer require a separate SQL import to enable the button.

Use a database setup method below only if the hosting database account cannot create the missing fields automatically. The action reports **Archive is unavailable. Please try again later.** if setup cannot finish, and leaves the refund in the active list.

## With Hostinger Terminal / SSH

1. Open the deployed Laravel **backend directory**, containing `artisan`.
2. Run:

   ```sh
   php artisan migrate --path=database/migrations/2027_01_09_000000_add_online_refund_archive_to_payments.php --force
   php artisan optimize:clear
   ```

3. Reload Orders in Admin and Staff. A provider-confirmed, resolved refund should have an enabled Archive icon. Use Archive to move it to **Archives > Online refunds**.

## With phpMyAdmin

1. In Hostinger hPanel, open **phpMyAdmin** for the site's database.
2. Select the database configured for this Laravel backend. Confirm that it contains the application's `payments` and `users` tables.
3. Choose **Import**, select [ENABLE_ONLINE_REFUND_ARCHIVES.sql](sql/ENABLE_ONLINE_REFUND_ARCHIVES.sql), and run the import. The patch safely handles neither, either, or both archive columns already existing. Its final result lists both nullable archive columns.
4. Reload the Admin and Staff Orders pages. Archive storage is checked on each API request, so the SQL patch does not require Terminal/SSH. If Terminal/SSH is available, also run `php artisan optimize:clear` from the deployed backend directory after uploading updated PHP files.

The SQL patch does not insert a Laravel migration-history record. The updated migration also accepts the columns created by this patch, so a later normal migration run can register it without recreating existing archive storage.

Disabled icons now accept hover and show **Available after refund confirmation.** Outstanding cancellation reviews show **Review cancellation first.** Archive eligibility is independent of `refund_archive_available`; that field reports only whether storage already exists. A row with an active requested, pending, unknown or failed refund still needs that refund resolved before archival.

These steps add archive metadata only. They do not issue refunds or change payment/refund amounts or statuses. Local checks do not verify the live deployment.
