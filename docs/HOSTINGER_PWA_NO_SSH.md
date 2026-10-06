# Finish FMRC phone notifications without SSH

The SQL installation is complete. On October 6, 2026, the live config endpoint
returned `inbox_available: true` and `push_available: false`. Do not repeat the
SQL import. These steps replace the SSH/Composer part using File Manager and
Hostinger's **PHP** cron option.

## 1. Upload the prepared dependency ZIP

Use `output/fmrc-hostinger-pwa-dependencies.zip` from this local project. Git does
not upload this ZIP or the `vendor` folder. It contains the 81 production packages
from the current `backend/composer.lock`, plus `pwa-hostinger-cron.php`.
It contains no `.env`, database dump, account data or VAPID keys.

Confirm **PHP Configuration** uses PHP 8.3 or later. Keep
`PWA_PUSH_ENABLED=false` in the server's `backend/.env` during setup. If that
setting is absent, add it. Keep the existing database and `APP_KEY` settings.

Open **Websites → ucn-fabmanlab.com → Dashboard → File Manager**. Navigate to
`public_html/backend`. Upload the ZIP, right-click it and choose **Extract**.
Choose a new folder named `vendor-pwa-upload` inside `backend`; leave overwrite
off. [Hostinger's extraction instructions](https://www.hostinger.com/support/1583613-how-to-extract-archives-using-the-file-manager-in-hostinger/).

Confirm the extracted files include:

```text
backend/vendor-pwa-upload/vendor/autoload.php
backend/vendor-pwa-upload/vendor/minishlink/web-push/src/WebPush.php
backend/vendor-pwa-upload/pwa-hostinger-cron.php
```

During a quiet period, rename the existing `backend/vendor` folder to
`vendor-before-pwa` (choose a different unused backup name if it exists).
Immediately move `vendor-pwa-upload/vendor` into `backend`, so the final path
is **`backend/vendor/autoload.php`**. Move the extracted `pwa-hostinger-cron.php`
into `backend` too. The website can briefly be unavailable between the folder
rename and move; prepare the extracted folder before starting. Keep the old
vendor folder for rollback until the website is verified.

This is a complete dependency replacement; do not merge it into old vendor files.
The `vendor-` staging and backup names stay behind the existing Apache protection.
The application source must already be deployed from the same Git revision that
contains this PWA feature. Do not replace `.env`, `storage`, or the database.

## 2. Refresh the generated Laravel cache files

In `backend/bootstrap/cache`, make backup copies and remove only these generated
files **if present**:

```text
config.php
packages.php
services.php
```

`packages.php` and `services.php` rebuild automatically using the new production
packages. Removing `config.php` makes subsequent requests read the server's
current `.env`. Preserve `.gitignore` and every other file. This does not clear
accounts, orders, uploads or sessions.

Open the website and check sign-in plus `/api/pwa/config`. If dependency loading
fails, restore the old vendor folder and the saved cache files before proceeding.

## 3. Add the PHP cron job

In the website dashboard, open **Cron Jobs**, choose **PHP**, and enter the file
path for:

```text
public_html/backend/pwa-hostinger-cron.php
```

That short entry works only when hPanel's fixed prefix already points to the
website directory. If the PHP form prefixes just `/home/YOUR_HOSTINGER_USER/`
and FTP Accounts confirms the domain-directory layout, enter this instead:

```text
domains/ucn-fabmanlab.com/public_html/backend/pwa-hostinger-cron.php
```

An error for `/home/YOUR_HOSTINGER_USER/public_html/backend/pwa-hostinger-cron.php`
means the short entry selected the account-root folder. Check the site's real
directory in FTP Accounts, then replace that failed cron job with the correct
path. The File Manager's `/files/public_html/` breadcrumb is a virtual path and
does not establish the absolute cron path.

This is a filesystem path, not an HTTPS URL. Use the home-directory prefix shown
in hPanel. Where a complete path is required, it will resemble:

```text
/home/YOUR_HOSTINGER_USER/domains/ucn-fabmanlab.com/public_html/backend/pwa-hostinger-cron.php
```

Replace `YOUR_HOSTINGER_USER` with the actual hosting username. Do not infer it
from the database name. Hostinger's **FTP Accounts** section shows the directory
structure. If hPanel already shows a fixed home-directory prefix, enter only
the remaining path; do not duplicate the prefix.
[Hostinger path troubleshooting](https://www.hostinger.com/support/1583514-troubleshooting-cron-jobs-at-hostinger/).

Set **Minute, Hour, Day, Month and Weekday to `*`**, then Save. The PHP option
supplies the PHP executable; no `artisan` argument, Composer command, or SSH
connection is needed. The cron PHP version must also be 8.3 or later.
[Hostinger PHP cron instructions](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/).

After one or two minutes, open **View Output** for this job. Expected first-run
output:

```text
Keys saved to protected storage/app/private/pwa-vapid.json. ...
Inbox publication complete; phone delivery is disabled.
FMRC notification cron completed.
```

The helper creates keys once, preserving existing keys, and processes the inbox
each minute. It does not enable push or modify `.env`. Opening the helper in a
browser returns 404 and does nothing. If the output reports missing dependencies,
check the final `backend/vendor/autoload.php` path. PHP-version/extension errors
require correcting hPanel's PHP configuration before continuing.

If you already have a working `artisan schedule:run` cron every minute, use this
helper only until it generates the keys, then remove its cron job and retain your
existing Laravel scheduler. Use one recurring processor, not two.

## 4. Copy the server-generated keys into .env

In File Manager, open **`backend/storage/app/private/pwa-vapid.json`**. Copy
`publicKey` and `privateKey` into the existing server **`backend/.env`**:

```dotenv
PWA_PUSH_ENABLED=false
PWA_VAPID_SUBJECT=https://ucn-fabmanlab.com
PWA_VAPID_PUBLIC_KEY=the_publicKey_value
PWA_VAPID_PRIVATE_KEY=the_privateKey_value
```

Replace the placeholders with the values, without JSON quotes or commas. Update
existing PWA entries rather than adding duplicates. Save the file. Keep these
keys on the server; do not send a screenshot of them or commit them to Git.
Preserve the same key pair for future deployments.

If `backend/bootstrap/cache/config.php` exists again, remove that exact generated
file so the new `.env` values take effect. Wait for the next cron run. With push
off, the original website and Customer inbox continue working.

## 5. Enable delivery after the staging phone checks

No staging site yet? Follow [the independent test-subdomain setup](HOSTINGER_PWA_STAGING.md)
first. Leave production delivery off while preparing that separate website.

Follow this same setup on HTTPS staging with its own database and stable key pair
first. For the deployment being tested, change just:

```dotenv
PWA_PUSH_ENABLED=true
```

Save `.env`, remove `backend/bootstrap/cache/config.php` if present, and wait one
minute. Open **`https://ucn-fabmanlab.com/api/pwa/config`** (use the staging origin
for staging). Expect `inbox_available: true`, `push_available: true`, and a public
key. Recheck after four minutes to confirm the cron keeps running.

Install the Customer app through its phone sidebar, open the Home Screen app,
then use **sidebar → App Notifications → Enable Notifications**. Admin/Staff use
their separate app and **Settings → Enable Notifications**. Verify a new eligible
notification arrives while each app is closed before enabling production delivery.
See steps 9–10 of [the complete setup guide](HOSTINGER_PWA_SETUP.md#9-install-and-enable-on-a-real-phone).

If `push_available` remains false, inspect cron output and the protected Laravel
log. Do not repeat the SQL import or regenerate keys. After success, remove the
uploaded ZIP and the staging extraction folder; retain a protected rollback
backup according to your deployment process.

## Local verification

The dependency archive is built with Composer `install --no-dev` from the lock
file, checked for archive corruption and required push classes, and checked for
absence of application secrets. To rebuild after a lock-file change, run
`python tools/pwa/build-hostinger.py` on the developer's machine. The build does
not change the working `backend/vendor` or `.env`.

The prepared archive passed an isolated production-only Laravel boot and SQLite
cron run. The check generated keys only in that disposable app copy, verified
repeat runs preserve keys and `.env`, confirmed the processor heartbeat, and
confirmed HTTP requests return 404 without creating keys. All 14 existing PWA
feature tests passed (121 assertions). To repeat the isolated upload check, run
`python tools/pwa/verify-hostinger-build.py` locally.

Local checks do not establish the hosting account's PHP configuration, successful
cron execution or real-phone delivery. The live database readiness check confirms
the SQL step only.
