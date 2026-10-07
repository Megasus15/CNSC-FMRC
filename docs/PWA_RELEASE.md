# FMRC Customer and Admin/Staff apps

The two apps reuse the original frontend files. Their identities, launch pages,
icons, worker registrations and device credentials are separate:

| App | Launch URL / manifest scope | Identity |
| --- | --- | --- |
| FMRC Customer | `/apps/customer/` | `/apps/customer/` |
| FMRC Admin/Staff | `/apps/team/` | `/apps/team/` |

Install App appears above App Notifications in the Customer phone sidebar, and
only inside Admin/Staff Settings on supported phones. Operator sidebars contain
no install action. The Customer app actions remain outside the scrollable links,
above the divider for Appoint Now. Installation is hidden on laptops,
desktops, Android tablets, iPhones below iOS 16.4, insecure origins, and installed
app windows. Installation is remembered per app in the phone's browser, survives
page changes and logout, and is checked against installed related apps where
supported. A narrow desktop window does not enable installation. This is a
product UI restriction; browser manufacturers can independently offer their own
website shortcuts.

Safari and other browsers without installation detection use an explicit
confirmation after adding the icon. The app-specific installation page also
supports confirming an existing install or reporting that the icon was removed.
An empty OS query clears a remembered install only if that browser's inventory
previously recognized the exact app. Repeated install offers never clear it.
Clearing browser data, changing browsers,
and Safari's separate Home Screen storage can require confirmation in the browser.
This does not change either app's notification permission or account binding.
[Installation detection support](https://developer.chrome.com/docs/capabilities/get-installed-related-apps).

The original Customer navbar announcement bell, badge and announcement popup are
retained. Customer **App Notifications** has a separate phone-sidebar button;
it opens phone-permission preferences only. Operator phone preferences remain
in Settings. No phone-notification panel appears on desktops. These panels contain
checkboxes, a device status and compact single-line Enable notifications / Save
preferences / Turn off actions. They have no notification feed or read/refresh
toolbar. A guest sign-in link explains the private-alert requirement.
The Customer Install App action is text only and left-aligned. The Team icon
uses an opaque maroon tile (`#701b2b`) reaching every edge, with version 3 icon
URLs and adaptive-mask metadata; Customer icon artwork is unchanged. Platform icon caches
can require removing and reinstalling an existing Team icon after deployment.
The app launch gateways immediately open the original Customer Home or operator
dashboard/sign-in page. They render no separate opening page. Team launch reuses
the existing UCN-FMRC medallion loader on the same cream field as Customer.
OS-generated splash screens remain platform-controlled. Use
[the notification UI update guide](HOSTINGER_PWA_UI_UPDATE.md) for this package.
See [the Hostinger step-by-step guide](HOSTINGER_PWA_SETUP.md) for Git deployment,
phpMyAdmin installation, VAPID configuration and the one-minute cron job.
If SSH/Composer is unavailable, use [the File Manager and PHP cron guide](HOSTINGER_PWA_NO_SSH.md)
with the locally prepared production dependency ZIP.
To create the selected test site first, use
[the independent staging-subdomain guide](HOSTINGER_PWA_STAGING.md).

Android browsers can provide a native install prompt. iPhone uses Safari Share →
Add to Home Screen, with Open as Web App enabled when that option is shown.
Phone notifications need permission and an installed app on iPhone. Permission
is requested only by Enable Notifications. Installation itself never requests it.
[Apple installation instructions](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios)
and [WebKit's iOS Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## Local development

With the existing Laravel server on port 8000, open:

- `http://127.0.0.1:8000/apps/customer/`
- `http://127.0.0.1:8000/apps/team/`

The Laravel app gateway and root asset routes serve the same allowlisted original
files as Apache. The normal Live Server URLs remain usable. On localhost, their
phone install action opens the Laravel gateway, since Live Server cannot execute
Apache rewrite aliases. Different localhost ports have independent browser login
storage, so sign in again when first opening the app on port 8000. A phone accessing
the computer through a LAN IP requires HTTPS for installation and push.

The new migration was applied to the local development MySQL database. Initial
live campaign publication ran locally. `/api/pwa/config` reports an available
inbox and disabled phone delivery. No local VAPID private key was added to Git or
to the frontend, and no real push delivery was sent.

## Notification behavior

- Public notifications are recorded once on first live publication. A model
  save handles immediate publication; the minute processor handles scheduled
  boundaries using the existing Philippine-time campaign rules. Ordinary edits,
  drafts, disabled and expired campaigns do not create repeated broadcasts.
- Committed HTTP events are attempted after the response, without waiting for
  the minute cron. The request pass handles only its own new events, with a
  100-delivery / approximately 10-second budget; a network call already underway
  can extend that budget. The same leased outbox keeps concurrent cron sends
  from duplicating accepted deliveries. Cron retains scheduled publication,
  remaining deliveries and retries. Failed sends do not fail the business save.
  Push uses high urgency; the device and network still control arrival time.
  [Web Push urgency](https://www.rfc-editor.org/rfc/rfc8030.html#section-5.3).
- Customer alerts use `orders.customer_id`, the owning order for returns/payments,
  and `appointments.user_id`. Matching an email does not establish ownership.
  The public appointment booking route resolves optional Sanctum authentication
  explicitly, so signed-in bookings bind to the account while guests stay unbound.
  Model alerts participate in the business transaction and disappear on rollback.
- Phone taps resolve the visible Customer record to its original order,
  appointment or campaign destination. A dedicated read-only target route applies
  the existing ownership/publication checks and omits message contents. Team taps
  use the existing workspace update handler without an intermediate preview card.
  Public and owned Customer read state persists for signed-in accounts.
  Guests keep a local read watermark and individual read IDs. Read APIs never
  expose another Customer's private update.
- Operator push reuses the existing AdminNotification records and restricts
  account requests to Admin. Existing website inbox visibility/read rules remain.
- Each device uses a random credential, stored hashed by the server. A website
  bearer token is needed to bind an account; the device credential can manage an
  existing grant after session expiry. Workers contain no website login token.
- Explicit Team logout removes its subscription. Customer logout unbinds private
  alerts while retaining public opt-in. A failed/offline logout unsubscribes the
  browser and clears the local worker binding. Password/role/security changes,
  account deletion and `admin:revoke-sessions --force` revoke the affected grants.
- Before sending, the outbox checks current preferences, role and account binding.
  The worker checks the binding again before displaying an account alert. Phone
  payloads contain only category, app identity and inbox reference; titles,
  names, amounts and website message contents are omitted.
- A unique device/event index deduplicates delivery. Transient failures back off,
  404/410 subscriptions are removed, and permanently rejected or repeatedly
  failing deliveries are discarded. Provider acceptance marks delivery complete;
  device/platform delivery time remains outside the server's control.
- Only the offline page, its stylesheet and its icon are cached. API/private data
  and transaction writes are never cached or queued by the app worker. Retry
  reloads the original destination after reconnection.

## HTTPS staging setup

1. Deploy the root `.htaccess`, `apps/`, changed original frontend source files,
   and changed backend files to HTTPS staging. Preserve the root frontend folder
   layout next to `backend/`. Do not recursively copy `backend/public/frontend`;
   app aliases serve the original source folders.
2. Install the locked dependencies on the server or in the release build:

   ```sh
   cd /absolute/path/to/site/backend
   composer install --no-dev --prefer-dist --optimize-autoloader
   php artisan migrate --force
   php artisan pwa:keys
   ```

   PHP 8.3+, OpenSSL with EC support, mbstring and cURL are required. The key
   command preserves an existing `storage/app/private/pwa-vapid.json`; it never
   prints its private key. Copy its `publicKey` and `privateKey` values into the
   protected server environment. Keep these keys stable for that deployment.
   [Web Push library requirements and VAPID configuration](https://github.com/web-push-libs/web-push-php).

3. Set the following environment values, initially with delivery disabled:

   ```dotenv
   PWA_PUSH_ENABLED=false
   PWA_VAPID_SUBJECT=https://your-https-staging-origin.example
   PWA_VAPID_PUBLIC_KEY=your-persistent-public-key
   PWA_VAPID_PRIVATE_KEY=your-persistent-private-key
   ```

   Use the actual staging origin for `APP_URL` and `FRONTEND_URL`, too. Keep the
   private key in protected configuration, never in HTML, JS, the public disk,
   release logs or a public download.

4. Refresh cached configuration and initialize the current live campaign inbox
   before opting in test devices. This avoids broadcasting older campaigns when
   push is first enabled:

   ```sh
   php artisan config:cache
   php artisan pwa:process
   ```

5. Add a one-minute hosting cron job. Adapt the PHP binary and paths to hosting:

   ```cron
   * * * * * /path/to/php /absolute/path/to/site/backend/artisan schedule:run >> /absolute/path/to/site/backend/storage/logs/scheduler.log 2>&1
   ```

   No persistent queue worker is required for this outbox. HTTP termination sends
   new committed events promptly; the recurring command provides recovery and
   scheduled publication. The command uses a lock,
   database leases, a 45-second processing budget and a default limit of 100.
   Large audiences may need a higher limit or additional server capacity. The
   config endpoint requires a processor heartbeat within three minutes. Monitor
   scheduler failures and pending outbox age. A failed processor clears its
   heartbeat so new phone opt-ins remain disabled until processing recovers.

6. Enable `PWA_PUSH_ENABLED=true` on **staging**, refresh configuration, and wait
   for the scheduler. Check that `/api/pwa/config` returns `push_available: true`
   and the public key. Test devices can now explicitly enable notifications.

## Real-device acceptance before production enablement

Use a modern iPhone and Android phone with both apps installed at the same time.
Verify:

- Distinct cream/maroon icons; Customer launches Home; Team launches the last
  valid operator portal and otherwise sign-in. Clean and `.html` links, login,
  My Orders, appointment links, PayMongo and simulator returns stay in the app.
- Android native prompt, iPhone installation instructions, denied permission,
  unsupported devices, already installed behavior, portrait/landscape safe areas,
  dark mode and reduced motion. Install App is absent on desktop, including narrow
  desktop windows. Permission panels have compact single-line controls with no uplift.
- Guest public alerts; owned Customer updates only; cross-device signed-in reads;
  local guest reads; Admin-only account requests; independent app preferences.
- Close both apps, trigger real updates, and receive generic phone previews.
  Tap each preview, authenticate when required and open its original update. Repeat
  after operator session expiry, explicit logout, account switching, disablement,
  password reset, role change and deletion.
- Scheduled first publication and deduplication, transient failures, expired
  subscriptions, unavailable older records, badges and read updates. Verify new
  public campaigns rather than editing an already published campaign to test push.
- Disconnect, open an uncached destination, see the branded offline screen, then
  reconnect and Retry. Confirm a failed transaction is not automatically replayed.
- Publish a worker update and confirm both app scopes update independently.

Only after these staging checks should production keys, migration and cron be
configured and production push enabled. Disabling `PWA_PUSH_ENABLED` and refreshing
configuration stops enqueueing/sending while preserving the website inbox.
App Store/Play Store packaging is outside this release.

## Local validation evidence and remaining checks

New backend tests cover capability gating, ownership, read receipts, endpoint and
credential checks, logout, session expiry, revocation, genuine business changes,
rollback, publication, outbox deduplication, retries, pruning and payment returns.
The PWA-specific tests include origin-correct Android detection links for
production and staging. The delivery update adds HTTP send checks for Customer,
Guest and Team recipients, transaction rollback, current-request priority during
a cron lock, successful-save preservation on delivery failure, retry and private
ownership. Targeted authentication, order,
appointment, campaign and spectator regression batches also passed.
The prompt-delivery validation batch passed 103 tests with 837 assertions across
PwaTest, PromotionExpirationTest, AppointmentCompletionEmailTest,
OrderPaymentVerificationTest, AdminSpectatorTest and AdminSessionLimitsTest.
The production-only dependency fixture also booted the changed backend and
completed the recurring cron while preserving its environment and keys.
Chromium checks exercise the actual app JS, actual workers/cache scopes, phone UA
installation guides, Settings placement, desktop exclusion, permission fixtures,
offline navigation and reconnection. Worker tests check binding isolation and
private previews. The isolated Apache test exercises the actual `.htaccess`.
Native installation/permission responses in automation are fixtures; they do not
establish real iPhone/Android closed-app delivery.
The earlier combined frontend run passed 22 tests, including rendered Website
Management loading/recovery, account-save gating, and phone layouts for both
portals. The latest UI correction passed nine frontend checks, including the
original announcement bell/popup on all five Customer pages, separate phone
sidebar controls, desktop exclusion, both workers and offline recovery. The
phpMyAdmin installer also matched the migration in local MySQL scratch databases.

The latest installation update passed ten targeted frontend checks: Chromium
tested guest/customer/admin/staff refreshes and navigation, install completion,
accepted/dismissed prompts, Safari confirmation, standalone windows, separate
app detection, logout, and notification availability changing without a permission
prompt. Apache verified the asset-links gateway and existing app aliases. These
are local tests with controlled installation/notification APIs, not real OS installs
or closed-app phone delivery.

The notification UI 1.4 checks passed 21 PwaTest cases with 189 assertions and
three worker tests. Chromium verifies permission-only panels at 320/390px,
Admin/Staff dark-mode cards, original sidebar placement, hard-refresh persistence,
per-app inventory and notification taps. A browser-process restart check covers
stored installation confirmation. Launch checks cover Customer, Admin, Staff and
signed-out Team using the existing single medallion loader. Installation APIs and
phone permissions remain controlled fixtures, not native device installations.
The optional Apache rerun could not start in this environment because the
installed Windows Apache binary rejected its temporary configuration path;
the rewrite rules were unchanged in this UI update.

On October 7 the user reported both official-site apps receiving phone previews
in realtime after device notification permissions were enabled. Exact elapsed
seconds and the new UI package's actual-phone appearance are not verified here.
After manual extraction with folder name `.` in the existing `public_html`,
read-only checks matched all 61 public UI release files and the decoded Team
icon pixels. A numeric/non-numeric route probe confirmed the added Customer
target route is active. Phone UI and tap acceptance remain separate from these
deployment checks.

Run from the repository root (PHP commands from `backend/`):

```sh
php artisan test --compact --filter=PwaTest
node --test backend/tests/Frontend/pwa-worker.test.cjs backend/tests/Frontend/pwa.browser.cjs
node --test backend/tests/Frontend/pwa-apache.test.cjs
```

The full PHP suite currently has four pre-existing AdminPortalConsistencyTest
failures: an outdated 37-page count, maintenance-preview treated as a full portal,
a CRLF-sensitive Generate Report CSS regex, and an obsolete announcement theme
selector assertion. The first broad run passed the other 494 tests. These tests
were not changed to suppress their failures. Composer audit also reports existing
advisories in 11 existing dependencies; none are in the four newly added Web Push
packages. Resolve those deployment dependencies before a production release.

On October 6 the user confirmed HTTPS staging initialization, Customer sign-in,
notification preferences and a closed-app phone alert through Brave on Android.
The original minute-processed release took approximately one to one-and-a-half
minutes to arrive. On October 7 an initial 40–50 second test exposed an update
extracted into an extra `public_html` folder. After the user copied the six PHP
files into the active staging backend, with `bootstrap/app.php` last, they
reported realtime Customer and Team phone notifications through Brave on Android. Exact
elapsed seconds were not supplied. This is user-reported staging acceptance;
Notification-tap navigation, iPhone and the remaining device acceptance checks
are still open. Phone delivery remains disabled in the local environment.

A first read-only check of the official site on October 7 returned `push_available:
false` and `inbox_available: true`; the shared app JS, CSS, worker and both
manifests matched the current source. The same tested six PHP files are packaged
in `output/fmrc-live-realtime-push.zip`, without environment, database, dependency
or frontend replacements. Follow [the live update guide](HOSTINGER_PWA_LIVE_UPDATE.md).
The user subsequently reported backing up the four replaced files, copying the
six update files into the active official backend and enabling its existing
production push setting. Read-only configuration checks then returned
`push_available: true`, `inbox_available: true` and an 87-character public key.
The user reported that official-site phone notifications worked after enabling
device notifications; the initial missed alerts occurred before that opt-in.
This is user-reported production delivery, separate from the staging results.
Separate Customer and Team arrival times, notification-tap navigation, iPhone
and the remaining device acceptance checks are still unverified.
