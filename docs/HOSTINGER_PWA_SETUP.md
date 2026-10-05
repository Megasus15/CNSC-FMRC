# FMRC apps: Hostinger setup, step by step

These steps activate the existing website as two Home Screen apps. Installation
and phone push are separate: the icons can work before phone delivery is enabled.
The Customer announcement bell and its original popup stay in the navbar.
Customer app notifications and Install App are in the phone sidebar. Admin/Staff
also have phone controls inside Settings. Desktop browsers get no phone controls.

On October 5, 2026, a read-only check of the live
`https://ucn-fabmanlab.com/api/pwa/config` returned:

```json
{"push_available":false,"inbox_available":false,"public_key":null}
```

The live Customer inbox returned HTTP 503. At least one required notification
table is absent from the database used by the deployed backend. This explains
why deploying the source files alone did not make the new inbox work. The
original announcement feed uses its existing tables and is independent.

## 1. Back up the current website and database

In the hPanel screen you showed, click **Enter phpMyAdmin** for your existing FMRC
database. Choose that database, then **Export → Quick → SQL → Go**. Save the
download. Keep a backup of the deployed files and `backend/.env` as well.
[Hostinger's database export instructions](https://www.hostinger.com/support/4529011-how-to-export-a-database-with-phpmyadmin-in-hostinger/).

Do not replace the live database with your local database export. The PWA installer
adds five tables and preserves existing accounts, orders, products and settings.
Test the setup on an HTTPS staging copy before enabling production push. Use the
staging domain/database in these examples when working on staging.

## 2. Push the correction and deploy it through your existing Hostinger Git setup

Commit and push the current source changes to the branch Hostinger deploys. In
hPanel, open your website's configured Git deployment and deploy that branch,
or wait for its configured automatic deployment to finish. The local correction
does not change the live site until that deployment completes.

The deployed tree must retain the existing layout:

```text
public_html/
  .htaccess
  apps/customer/
  apps/team/
  apps/shared/
  home-page/  about-page/  services-page/  products-page/  contact-page/
  customer-auth/  admin-auth/  admin-page/  staff-page/
  backend/
```

Ship the HTML asset-version changes too: PWA assets use `v=1.1`, and the Customer
announcement script uses `v=6.8`. Refresh the browser after deployment. Preserve
the existing server `backend/.env`; `.env.example` is documentation, not its
replacement. Dependencies in `backend/vendor/` are not included by a normal Git
push. Do not recursively copy `backend/public/frontend`; app aliases use the
original frontend folders.

## 3. Connect to Hostinger SSH and check PHP

In your website dashboard, search for **SSH Access**, enable it if necessary,
and copy the SSH command shown there. Paste that command into PowerShell and
sign in. Your hosting plan must include SSH access.
[Hostinger SSH instructions](https://www.hostinger.com/support/1583245-how-to-connect-to-a-hosting-plan-via-ssh-in-hostinger/).

After connecting, run these on **Hostinger**, not in your local project terminal:

```sh
cd ~/domains/ucn-fabmanlab.com/public_html/backend
pwd
command -v php
php -v
composer2 --version
```

Adapt the directory if your Git deployment uses another location. Save the full
backend path from `pwd` and PHP path from `command -v php` for the cron job. Both
web PHP and command-line PHP must be 8.3 or later. If the CLI uses an older
version, select a supported PHP binary with Hostinger before continuing.

## 4. Install the locked PHP dependencies

While still in the deployed `backend` folder, run:

```sh
composer2 install --no-dev --prefer-dist --optimize-autoloader
composer2 check-platform-reqs --no-dev
```

This installs `minishlink/web-push` and its dependencies from `composer.lock`.
Use `install` here; do not update unrelated package versions during this setup.
[Hostinger Composer instructions](https://www.hostinger.com/support/5792078-how-to-use-composer-at-hostinger/).

## 5. Install the notification tables: choose one method

**With SSH (recommended):** confirm the deployed `backend/.env` has the correct
existing FMRC `DB_DATABASE`, then run:

```sh
php artisan config:clear
php artisan migrate --path=database/migrations/2026_10_05_000001_create_pwa_notifications.php --force
```

**With phpMyAdmin instead:** open the existing FMRC database, click **SQL**, paste
the entire contents of
`backend/database/manual/2026_10_05_install_pwa_notifications.sql`, then click
**Go**. It is qualified for `u799987132_ucn_fmrc_db`, the database in your
screenshot. For staging, replace that name throughout with the staging database.
Leave stop-on-error enabled. If any statement fails, resolve the error before
continuing; do not manually mark a failed migration complete.

The file also records this migration so a later Artisan migration does not try
to recreate its tables. Running it twice does not duplicate records. Existing
PWA tables are retained; this file does not upgrade an incomplete older schema.
Use the SQL method or the Artisan method for the initial installation.

Verify these five tables exist:

```text
pwa_runtime
pwa_subscriptions
customer_notifications
customer_notification_reads
pwa_delivery_outbox
```

Open `https://ucn-fabmanlab.com/api/pwa/config`. `inbox_available` should now be
`true`; `push_available` stays `false` until the remaining push setup is complete.
If the inbox remains unavailable, confirm the database installed is the one the
deployed Laravel configuration uses.

## 6. Generate persistent VAPID keys and configure the server

Run once from the deployed backend:

```sh
php artisan pwa:keys
```

The command saves the keys in `backend/storage/app/private/pwa-vapid.json` and
preserves a file that already exists. Open that protected file in Hostinger File
Manager. Copy its `publicKey` and `privateKey` values into the server's
`backend/.env`:

```dotenv
PWA_PUSH_ENABLED=false
PWA_VAPID_SUBJECT=https://ucn-fabmanlab.com
PWA_VAPID_PUBLIC_KEY=copy_the_publicKey_value_here
PWA_VAPID_PRIVATE_KEY=copy_the_privateKey_value_here
```

Use the actual HTTPS origin for `APP_URL` and `FRONTEND_URL` too. Replace example
values; do not paste the placeholder text as keys. Keep the private key and
environment file out of Git, frontend folders, screenshots and public downloads.
Keep one stable key pair per deployment; changing it breaks existing device
subscriptions. Staging and production should use their own stable pairs.

Initialize the inbox with current live campaigns while delivery is still off:

```sh
php artisan config:cache
php artisan route:clear
php artisan pwa:process
```

Expected output includes: **Inbox publication complete; phone delivery is
disabled.** Existing live campaigns enter the inbox without a phone-alert backlog.

## 7. Add the one-minute cron job

In hPanel's website dashboard, search for **Cron Jobs**, choose **Custom**, and
enter the following command using the paths saved in step 3:

```text
FULL_PHP_PATH FULL_BACKEND_PATH/artisan schedule:run
```

For example, **only if those are your verified paths**:

```text
/usr/bin/php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/artisan schedule:run
```

Set Minute, Hour, Day, Month and Weekday to `*` (every minute), then save. Enter
only the command in the command field; the schedule belongs in the schedule
fields. A Custom cron job runs Artisan with its `schedule:run` argument. Check
its output in hPanel after a minute. If Laravel scheduling is already configured
for this backend every minute, reuse that job instead of creating a duplicate.
[Hostinger cron setup](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/).

This processor handles scheduled publication and queued phone deliveries. There
is no permanent queue-worker process required. Campaign dates still use the
existing Philippine-time rules; a cron that runs every minute works regardless
of hPanel's displayed timezone.

## 8. Enable and verify push on HTTPS staging, then repeat for production

Change only this setting in the server's `.env`:

```dotenv
PWA_PUSH_ENABLED=true
```

Refresh configuration and run the processor once:

```sh
php artisan config:cache
php artisan pwa:process
```

Check `/api/pwa/config`. Expect `inbox_available: true`, `push_available: true`,
and a nonempty **public** key. The private key is never returned. Recheck after
four minutes: push should still be available, proving the cron continues to run.
It becomes unavailable if processing stops or fails. Resolve errors in the
protected Laravel log and hPanel cron output before enrolling devices.

## 9. Install and enable on a real phone

Customer: open `https://ucn-fabmanlab.com/apps/customer/`.
Admin/Staff: open `https://ucn-fabmanlab.com/apps/team/`.

**iPhone, iOS 16.4 or later:** open in Safari, open the sidebar and tap **Install
App**. Follow Share → Add to Home Screen. Keep **Open as Web App** enabled if
shown, tap Add, and launch the new Home Screen icon. Customer then opens the
sidebar → **App Notifications** → **Enable Notifications**. Admin/Staff sign in,
open **Settings** → **Enable Notifications**. Accept the system permission.

**Android phone:** open in Chrome, open the sidebar → **Install App**, and accept
the native installation prompt. If the browser provides no prompt, use its menu
→ Install app/Add to Home screen. Launch the icon, use the same Customer sidebar
or operator Settings controls, and allow notifications.

The navbar bell continues opening the original announcements. Install App hides
inside installed app windows. Laptops/desktops get no install or phone panels.
Sign in before enabling private account/workspace alerts. Guests can enable
public announcements/promotions only.

## 10. Verify closed-app delivery

With both apps installed, enroll each separately, close them, and create a new
live announcement or update an owned Customer order/appointment. The cron queues
and sends eligible generic phone previews. Provider/device delivery time varies;
aim for roughly one minute plus the phone platform's delivery time.

Tap the preview and verify it opens the matching app and inbox item; private
details require sign-in. Test operator session expiry, explicit logout, account
switching, and permission denial. The complete acceptance checklist is in
[PWA_RELEASE.md](PWA_RELEASE.md). Editing an already-published campaign does not
produce another broadcast, so use a new campaign when testing publication.

## If you only have File Manager and phpMyAdmin

The corrected UI, app installation and website inbox can work after deploying
the source files and running the SQL installer. File Manager/phpMyAdmin alone
do not install Composer dependencies or prove a background processor is running.
Arrange SSH access, a deployment build with the locked vendor dependencies, or
Hostinger assistance for steps 4, 6 and 7. Keep `PWA_PUSH_ENABLED=false` until
those steps are complete; there is no public setup page that runs arbitrary
Artisan commands or exposes keys.

If Laravel configuration/routes were cached, have the deployment run the cache
commands above. With File Manager only, the exact generated cache files
`backend/bootstrap/cache/config.php` and `backend/bootstrap/cache/routes-v7.php`
can be removed when present; preserve `.gitignore` and the rest of the directory.
Do not clear storage, uploads, application keys, or the existing environment file.

The manual SQL installer was verified against the migration using isolated local
MySQL scratch databases, including repeat installation and private-record
deletion. Browser checks verify the original announcement popup on all five
Customer pages, phone-sidebar placement and desktop exclusion. These local
checks do not establish real-phone or deployed push delivery.
