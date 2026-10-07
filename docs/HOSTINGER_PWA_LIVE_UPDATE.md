# Apply prompt delivery to the existing official FMRC site

On October 7, the user reported realtime Customer and Team phone notifications
on staging through Brave on Android after installing the six-file backend
update. Exact elapsed seconds and notification-tap navigation were not reported.
iPhone and the remaining device checks are still unverified.

A first read-only check of `https://ucn-fabmanlab.com/api/pwa/config` returned an
available inbox and disabled phone delivery. After the user reported backing up
the four replaced files, copying all six update files into the active official
backend and enabling its existing push setting, subsequent read-only checks
returned `push_available: true`, `inbox_available: true` and an 87-character
public key. The user then reported official-site phone notifications working
after enabling notifications on the device, and subsequently confirmed both
official-site apps receiving them in realtime. Exact elapsed seconds and
notification-tap navigation were not reported.

Before the later UI 1.4 changes, the shared app JS, CSS, worker and both manifests
matched the local source. The permission-panel and icon package has separate
[UI deployment instructions](HOSTINGER_PWA_UI_UPDATE.md).
The live update contains only the same
six tested PHP files; it does not replace the production environment, database,
dependencies, frontend or accounts. This guide concerns the existing initialized
website, whose additive PWA tables and permanent notification cron were set up
earlier. No fresh-site initializer or staging database export belongs here.

## 1. Upload into a separate extraction folder

Build with `python tools/pwa/build-push-update.py --target production`.
Use **`output/fmrc-live-realtime-push.zip`**.

1. In hPanel select **ucn-fabmanlab.com**, then open its File Manager.
2. Upload the live ZIP into this website's **`public_html`**.
3. Extract into a new folder named **`pwa-push-update`** inside `public_html`.
4. Verify the actual extracted path is **`public_html/pwa-push-update/backend/`**
   before copying. Hostinger's destination selection and folder-name field can
   create an extra enclosing folder; the resulting path is what matters.
   [Hostinger extraction instructions](https://www.hostinger.com/support/1583613-how-to-extract-archives-using-the-file-manager-in-hostinger/).

## 2. Copy only the six update files

Retain backup copies of the existing `PwaNotifications.php`,
`PwaPushTransport.php`, `ProcessPwaPush.php` and `bootstrap/app.php`.
For each row, copy the individual file from the extraction folder into the
existing backend at the same relative path. Choose replace for existing files.
Keep the active backend directory, its `.env`, vendor, storage and other files.

| Order | Relative path inside backend |
| --- | --- |
| 1 | `app/Services/PwaOutboxProcessor.php` |
| 2 | `app/Http/Middleware/PwaImmediateDelivery.php` |
| 3 | `app/Services/PwaNotifications.php` |
| 4 | `app/Services/PwaPushTransport.php` |
| 5 | `app/Console/Commands/ProcessPwaPush.php` |
| 6 | `bootstrap/app.php` — last |

Source prefix: `public_html/pwa-push-update/backend/`.
Destination prefix: `public_html/backend/`.

The global middleware becomes active when `bootstrap/app.php` is copied, so
copy it after the two new classes and the other updated files. The tested
production dependencies can autoload these new application classes without a
new Composer installation. No SQL or schema changes are part of this update.

## 3. Enable the existing production configuration

After all six files are in the active backend, edit the existing production
`backend/.env` entry:

```dotenv
PWA_PUSH_ENABLED=true
```

Retain the production database, `APP_KEY`, domain settings and stable production
VAPID pair. Use the official HTTPS origin for the subject. These settings are
separate from staging; the archive includes no keys or environment file.
If present, remove only the generated **`backend/bootstrap/cache/config.php`**
so requests read the updated environment.

Keep the existing production cron:

```text
/usr/bin/php /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend/pwa-hostinger-cron.php
```

After its next run, check **`https://ucn-fabmanlab.com/api/pwa/config`** for
`push_available: true`, `inbox_available: true` and a public key. If push stays
unavailable, use the protected cron output to check readiness before enrolling
phones. A disabled public response does not establish whether keys are missing.
Retain the existing key pair and inspect the actual production configuration.

## 4. Enroll and verify the official apps

On the phone use the official site's existing accounts and URLs:

- Customer: `https://ucn-fabmanlab.com/`, then sidebar **Install App** and
  **App Notifications**.
- Team: `https://ucn-fabmanlab.com/admin-auth/auth`, then **Settings** to install
  and enable notifications.

Staging installations, sign-ins and phone grants belong to the staging origin.
Install/enroll the official apps separately. Close them and save a new enabled
announcement with empty schedule dates from the official admin portal. Verify
both generic phone previews arrive promptly and taps open the matching app.
Use a suitable real announcement: an enabled production publication is visible
to official-site users and can alert every opted-in eligible device.

Keep the recurring cron for scheduled first publication, retries and any
remaining large-audience delivery. Prompt HTTP sends are bounded to 100 devices
and approximately ten seconds, excluding an in-progress network call. Provider,
network and device delivery time can still vary. For fuller coverage, follow the
[device acceptance checks](PWA_RELEASE.md#real-device-acceptance-before-production-enablement).

After verification, remove the uploaded ZIP and only its `pwa-push-update`
extraction folder. Keep the protected rollback backup. To disable phone
delivery again, set the existing `PWA_PUSH_ENABLED` entry to `false` and clear
only the generated config file if present; the website inbox remains available.
