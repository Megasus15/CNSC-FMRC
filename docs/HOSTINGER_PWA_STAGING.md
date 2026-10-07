# Create the FMRC phone-notification test site

Use **`staging.ucn-fabmanlab.com`** as an independent PHP/HTML website. You chose
to test both apps here before enabling production phone delivery. The live site's
completed SQL, dependencies, VAPID keys and cron can stay in place with
`PWA_PUSH_ENABLED=false`. That setting explains its disabled notification buttons.
Installation and the website inbox work independently of phone delivery.

## 1. Create the independent website

1. Open hPanel and choose **Websites**.
2. Locate your existing hosting plan and click **Create website** (some layouts show **Add website**).
3. Select **Custom PHP/HTML website**.
4. Enter **`staging.ucn-fabmanlab.com`** as the website domain and finish setup.
5. Open the new staging website's Dashboard and confirm it has its own File Manager.

Hostinger recommends this method for a standalone application because it creates
an independent website with its own settings. If your plan has no remaining
website slot, check the plan limit before proceeding; do not replace the existing
live website. [Hostinger's subdomain instructions](https://www.hostinger.com/support/1583405-how-to-create-and-delete-subdomains-in-hostinger/).

## 2. Connect the address and HTTPS

If the main domain uses Hostinger nameservers, Hostinger creates the DNS record
automatically. If it uses Cloudflare or another DNS provider, add an **A record**
there: name **`staging`**, value **the Hostinger hosting IP shown in hPanel**.
Keep the live domain's records unchanged. DNS changes can take up to 24 hours.
[Hostinger's DNS guidance](https://www.hostinger.com/support/1583405-how-to-create-and-delete-subdomains-in-hostinger/).

In the staging Dashboard, finish its SSL setup and confirm you can open
**`https://staging.ucn-fabmanlab.com`**. A default welcome page is fine at this step.

## 3. Prepare the separate FMRC installation

The October 6 hPanel screenshots confirm the independent staging website and its
empty database **`u799987132_fmrc_staging`**, with user
**`u799987132_fmrc_stage`**. Keep its password private.

For this installation, a complete staging ZIP is prepared locally:
**`output/fmrc-hostinger-staging.zip`**. It includes the latest frontend, both apps,
locked production dependencies, all FMRC migrations, public default content and
a one-time CLI initializer. It contains no developer `.env`, live database dump,
website login tokens, uploaded customer files or private VAPID keys.

### Upload and configure this new staging site

1. Keep **staging.ucn-fabmanlab.com** selected in hPanel. Open **Files → File
   Manager** and enter its own **`public_html`**.
2. Upload `fmrc-hostinger-staging.zip`, then extract it into this `public_html`,
   without an extra enclosing folder. At its root, you should see `.htaccess`,
   `apps`, `home-page`, `admin-page`, `staff-page`, and `backend`.
3. In **staging `backend`**, rename **`.env.staging.example`** to **`.env`**.
   Open it in the File Manager editor. Replace only:

   ```dotenv
   DB_PASSWORD="YOUR_STAGING_DATABASE_PASSWORD"
   FMRC_STAGING_TEST_PASSWORD="YOUR_NEW_PRIVATE_TEST_LOGIN_PASSWORD"
   FMRC_STAGING_SETUP_ENABLED=true
   ```

   The test-login password needs at least 12 characters with uppercase, lowercase
   and numbers. Use a fresh password; it will initially apply to all three staging
   test accounts. Leave push disabled. Do not copy the production `.env`.
4. For the **staging website**, open **Advanced → Cron Jobs → PHP**. The PHP
   binary must be 8.3 or later. When hPanel already prefixes `/home/u799987132/`,
   enter this in its editable command field:

   ```text
   domains/staging.ucn-fabmanlab.com/public_html/backend/pwa-hostinger-staging-setup.php
   ```

   Set Minute, Hour, Day, Month and Weekday all to `*`; save. Verify the full path
   shown in the saved job. Wait for the next minute, refresh hPanel and view output.
   The expected first line is **Staging setup completed.** Keep the production
   cron unchanged. The initializer runs only from this staging folder, refuses
   a nonempty database on first use, and never runs `migrate:fresh` or a live dump.
5. After successful output, delete **only the staging one-time setup cron**.
   The initializer disables its setup flag and clears the test-password entry;
   already-completed reruns retain accounts, passwords and keys. Test sign-in:

   | Portal | Test username | URL |
   | --- | --- | --- |
   | Admin | `admin_test` | `https://staging.ucn-fabmanlab.com/admin-auth/auth` |
   | Staff | `staff_test` | same operator sign-in page |
   | Customer | `customer_test` | `https://staging.ucn-fabmanlab.com/customer-auth/auth` |

   Use the private test-login password you chose. Guest browsing needs no login.
6. Add the permanent **staging** notification cron, with every field `*`:

   ```text
   domains/staging.ucn-fabmanlab.com/public_html/backend/pwa-hostinger-cron.php
   ```

   Its output should end with **FMRC notification cron completed.** In File
   Manager, open staging `backend/storage/app/private/pwa-vapid.json`. Copy its
   `publicKey` into staging `.env`'s `PWA_VAPID_PUBLIC_KEY`, and its `privateKey`
   into `PWA_VAPID_PRIVATE_KEY`. Keep `PWA_VAPID_SUBJECT` as the staging HTTPS URL.
   Do not regenerate or share these keys. Remove the uploaded ZIP after extraction.

The upload and setup steps were checked locally against a fresh MySQL database
and the packaged production dependencies. The October 6 hPanel results also
confirm staging initialization and its recurring cron completed successfully.
The user confirmed Customer phone delivery through Brave on Android, initially
with a delay of about one to one-and-a-half minutes. After the delivery update
was copied into the active backend on October 7, they reported realtime phone
alerts for both Customer and Team. iPhone delivery remains untested. Use staging
test records for phone tests.

### General requirements for other staging deployments

Before enabling notifications, staging needs the following:

- The same source revision and original frontend folder layout as FMRC, deployed
  into **the staging website's own `public_html`**, including the root `.htaccess`.
- A **new staging database and database user**, initialized with the FMRC schema
  and test accounts. Do not point staging at `u799987132_ucn_fmrc_db` or import live
  customers, orders, subscriptions or authentication tokens into a public test site.
- A separate `backend/.env` with the staging database credentials, its own `APP_KEY`,
  `APP_DEBUG=false`, and both `APP_URL` and `FRONTEND_URL` set to
  `https://staging.ucn-fabmanlab.com`. Keep `SESSION_DOMAIN=null` so staging cookies
  do not span the live domain. Use test accounts, log mail and manual/test payments.
- The prepared production dependency ZIP installed inside staging's `backend`.
- A staging cron running its own `backend/pwa-hostinger-cron.php` every minute,
  using the real path shown by staging's FTP Accounts section.
- A **separate staging VAPID key pair**, generated once by that cron and copied
  only into staging's `.env`. Set its subject to `https://staging.ucn-fabmanlab.com`.

The existing phpMyAdmin PWA script installs only five additional PWA tables. It
does not initialize a fresh FMRC database. Do not run its production-qualified SQL
on staging; any manual schema installer must target the actual staging database.
Do not use the repository's default account seeder on an internet-facing site.

After the staging database, source and environment are ready, follow
[the File Manager / PHP cron guide](HOSTINGER_PWA_NO_SSH.md) using the staging
directory and domain throughout. For example, if FTP Accounts confirms an
independent domain folder and hPanel prefixes `/home/u799987132/`, the PHP entry is:

```text
domains/staging.ucn-fabmanlab.com/public_html/backend/pwa-hostinger-cron.php
```

Verify the actual directory first. The File Manager `/files/` address is virtual.

## 4. Enable and verify staging delivery

When its cron completes successfully, change **only staging's**
`PWA_PUSH_ENABLED` to `true`. Remove staging's generated
`backend/bootstrap/cache/config.php` if present. Wait for the next cron run.
Open **`https://staging.ucn-fabmanlab.com/api/pwa/config`** and confirm
`push_available: true` and `inbox_available: true`. Recheck after four minutes.

Install both staging apps on a real modern iPhone and Android phone. Enable
Customer notifications through **sidebar → App Notifications** and operator
notifications through **Settings**. Close the apps and publish a new staging
announcement or create a test account update. Follow
[the complete real-device checks](PWA_RELEASE.md#real-device-acceptance-before-production-enablement)
before enabling the live site's phone delivery.

### Apply the prompt-delivery update to the existing staging site

The initial release waited for the next minute cron before sending phone alerts.
The updated backend attempts committed events after the HTTP response, using
high push urgency. Keep the minute cron for retries, scheduled publication and
deliveries beyond the bounded request budget (100 devices / approximately 10
seconds, excluding an in-progress network call). Device/network delivery time
can still vary. [Web Push urgency](https://www.rfc-editor.org/rfc/rfc8030.html#section-5.3).

1. Build the small update with `python tools/pwa/build-push-update.py`.
2. In **staging.ucn-fabmanlab.com** File Manager, upload
   **`output/fmrc-staging-realtime-push.zip`** into its own **`public_html`**.
3. Extract into a new folder named **`pwa-push-update`** within this `public_html`.
   Confirm the resulting source directory is
   `public_html/pwa-push-update/backend/`. Copy the six individual PHP files
   into their corresponding existing `public_html/backend/` folders, adding
   the two new classes first and copying `bootstrap/app.php` last. The file list
   is in the ZIP's README and the recovery table below (replace that table's
   nested source prefix with `public_html/pwa-push-update/backend/`). The archive
   contains no `.env`, schema changes or dependencies.
4. Keep the existing staging notification cron. No new keys, SQL import,
   environment changes or app reinstallation are needed for this update.
5. Close the enrolled Customer app and save a **new enabled announcement** in
   staging. Compare the save time with the phone alert; inspect
   `diagnose-staging-push.sql` if it still waits for cron. Provider acceptance
   time is available in the outbox's `delivered_at`; that is not the device's
   display time. After verification, remove the uploaded ZIP and only the new
   `pwa-push-update` extraction folder.

On October 7, after copying the six update files into the active staging backend,
the user reported that Customer and Team phone notifications through Brave on
Android were now realtime. These are user-reported successful staging tests; no
exact elapsed seconds were supplied. Notification-tap navigation, iPhone and
the remaining device acceptance checks are not established by these results.
For the already-initialized official website, use
[the small live update guide](HOSTINGER_PWA_LIVE_UPDATE.md).

### Recover an update extracted into an extra public_html folder

On October 7 the user reported a 40–50 second delay after the update upload.
A read-only HTTPS check returned 404 for `/FMRC_PUSH_UPDATE.json` but found
the matching six-file update metadata at `/public_html/FMRC_PUSH_UPDATE.json`.
This shows an extra enclosing directory; the marker alone does not verify
which PHP files the active application is executing. Correct the file locations
before attributing the remaining delay to Brave or Android.

In the staging File Manager, copy **individual files** from the nested update
into the corresponding existing backend folders. Preserve the current backend
directory and its environment, dependencies, storage and other application files.
Use the following order so the new classes exist before registration:

| Source under `public_html/public_html/backend/` | Destination under `public_html/backend/` |
| --- | --- |
| `app/Services/PwaOutboxProcessor.php` | `app/Services/PwaOutboxProcessor.php` |
| `app/Http/Middleware/PwaImmediateDelivery.php` | `app/Http/Middleware/PwaImmediateDelivery.php` |
| `app/Services/PwaNotifications.php` | `app/Services/PwaNotifications.php` |
| `app/Services/PwaPushTransport.php` | `app/Services/PwaPushTransport.php` |
| `app/Console/Commands/ProcessPwaPush.php` | `app/Console/Commands/ProcessPwaPush.php` |
| `bootstrap/app.php` | `bootstrap/app.php` (copy last) |

Choose overwrite for the four existing files. Copy the nested
`FMRC_PUSH_UPDATE.json` into the outer `public_html` too, then verify
`https://staging.ucn-fabmanlab.com/FMRC_PUSH_UPDATE.json` returns the matching
metadata. Repeat the new-announcement phone test. The read-only
`diagnose-staging-push.sql` reports `server_wait_seconds` between enqueueing and
provider acceptance, separating server waiting from later device delivery.
Do not move or replace the whole backend folder. Keep the recurring cron.

The user subsequently confirmed copying the Services files, middleware, command
and finally `bootstrap/app.php`; the resulting Customer phone test was reported
as realtime. The existing Services directory screenshot also showed the new
outbox processor and updated service files. The nested release metadata has not
been confirmed moved or removed, and metadata location alone is not proof of
the active PHP version.

## Installation-button behavior

Supported Android browsers can report an installed app; native installation and
installed app windows also record the app's state. Customer/Guest share one state;
Admin/Staff share the other. Signing out changes notification bindings without
resetting installation. The state is local to the device's browser and site origin.
Staging and production installations remain separate.

Browsers without installation detection, including Safari, cannot reliably report
the Home Screen app inventory to an ordinary tab. After adding the icon, confirm
**I've added FMRC to my Home Screen** in the guide. For an existing installation,
open `/apps/customer/install` or `/apps/team/install` and choose
**I've already installed this app**. If you remove the icon, that same page offers
**I removed this app** to restore installation. Cancelling the guide never marks
the app installed. Clearing browser data or using a different browser can require
confirmation again. [Browser installation detection](https://developer.chrome.com/docs/capabilities/get-installed-related-apps),
[API availability](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getInstalledRelatedApps).

Installation detection on Android also uses `/.well-known/assetlinks.json`.
Deploy the root rewrite, backend route/controller, both manifests and frontend
asset versions together. The asset links resolve the current site origin, so
the staging response refers to staging's own manifests.
