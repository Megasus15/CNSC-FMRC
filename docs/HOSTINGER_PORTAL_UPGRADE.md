# Install the portal upgrade together

The files and the database must both be upgraded. Pushing HTML/JavaScript alone does not install the database tables. Missing schema causes Shipping and Transaction Policies to return HTTP 503.

1. Back up the live database and website in Hostinger. Keep the live `backend/.env`, `APP_KEY` and `backend/storage`.
2. Commit and push the changes in GitHub Desktop, then deploy that commit using the existing Hostinger Git connection. Keep the existing directory layout.
3. Open Hostinger SSH and change into the **live backend directory** (the directory containing `artisan`). Run the following block. It stops on failure. PHP must be 8.3 or newer; `composer2` is Hostinger's Composer 2 command.

```sh
composer2 install --no-dev --prefer-dist --optimize-autoloader --no-interaction &&
php artisan config:clear &&
php artisan portal:upgrade --force &&
php artisan optimize:clear &&
php artisan config:cache
```

`portal:upgrade` applies only the four additive upgrade migrations, skips ones already recorded, and checks the required tables, columns and initial records. It does not reset the database, replace orders, publish policy/rates, or enable couriers. Do not use `migrate:fresh`, seed a demo database, or generate a new application key. If a migration fails, retain its error output and resolve it before retrying; a partially executed MySQL migration can need targeted repair.

4. Refresh Shipping & Delivery and Transaction Policies while signed in. Admin reviews and publishes FMRC-approved rates and policy wording. Staff sees the published settings. Without a published policy, new checkout remains blocked; without published delivery rates, delivery remains unavailable.
5. Verify About saves and reloads in both portals, Customer checkout totals and the new-tab policy link, appointment booking/rescheduling/private downloads, and report preview/printing. Set web PHP limits to at least `upload_max_filesize=50M`, `post_max_size=64M`, and `max_file_uploads=5`; ensure `backend/storage` and `backend/bootstrap/cache` are writable by PHP.

Keep `NINJAVAN_ENABLED=false` and `NINJAVAN_PRODUCTION_APPROVED=false` in the live `.env`. Database installation is not courier activation. No real booking, collection, delivery or tracking is verified by this command.

For a read-only recheck: `php artisan portal:upgrade --check`. If it passes but the live API still reports missing schema, the web app and CLI may be using different deployment directories or database configuration. Check that before changing data.
