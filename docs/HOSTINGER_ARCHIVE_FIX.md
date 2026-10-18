# Enable confirmed-refund archives on Hostinger

A **Refund confirmed** row can still have a disabled Archive icon when the live database lacks archive storage or the deployed API predates archive eligibility. The live backend needs both `payments.online_refund_archived_at` and `payments.online_refund_archived_by`. Pending claims and unresolved refunds must remain disabled.

Upload the matching archive release files first: `backend/app/Support/OnlineRefundArchive.php`, `backend/app/Http/Controllers/Api/GatewayManagementController.php`, the archive migration, shared `admin-page/gateway-payments.js`, and both Orders HTML files. Include the Archives page/controller files from [the release guide](HOSTINGER_REFUND_RELEASE.md) if they are not already deployed.

Use one database setup method below.

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

If Archive remains disabled, inspect the action's explanation and the current API response before changing any refund record. The response must include `refund_archive_available`, `can_archive_refunds` and `refund_archive_reason`. A missing capability field indicates an older deployed API; an unavailable-storage explanation indicates that the patch was not applied to the database used by the live backend. Outstanding cancellation review or unresolved refund attempts can also legitimately block archival.

These steps add archive metadata only. They do not issue refunds or change payment/refund amounts or statuses. Local checks do not verify the live deployment.
