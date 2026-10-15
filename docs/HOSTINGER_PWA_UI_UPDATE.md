# Notification UI update 1.5

Use **output/fmrc-notification-ui-update.zip** on the existing working official site.
Rebuild it with `python tools/pwa/build-ui-update.py`.

## What changed

- Customer app name: **UCN–FMRC**. Admin/Staff app name: **FMRC Team**.
  The existing app IDs and scopes remain the same; installation screens, Apple
  title metadata, offline pages and phone notification titles use these names.
- One shared installation check for Customer, Admin and Staff. A successful
  supported Android Chrome inventory corrects old installed flags after removal.
  Checks run on page load, return to the browser, and while the page stays open.
- Admin/Staff **Install App** sits inside **Phone notifications**.
- Settings cards use one consistent **16px gap** instead of stacked margins.

## Brave and other Home Screen shortcuts

A website cannot reliably inspect whether a Brave/iOS Home Screen shortcut was
removed. Saved installation confirmation is not proof that the shortcut still
exists. Perfect automatic detection on those browsers is not implemented or
promised. Both apps now expose the same recovery controls in their phone panel:

- Already installed: hides Install App in this browser.
- I removed this app: restores Install App immediately in this browser.

Customer: sidebar → App Notifications. Admin/Staff: Settings → Phone notifications.
These controls appear when automatic inventory is unavailable or inconclusive.
An actual app window hides installation controls. Current positive inventory
results hide Install App, and supported negative results restore it automatically.
Browser refresh/restart preserves explicit fallback choices separately per app.
Different browsers, origins, profiles or cleared site data may need confirmation.

[Chrome installation detection requirements](https://developer.chrome.com/docs/capabilities/get-installed-related-apps)
[Brave WebAPK support tracking](https://github.com/brave/brave-browser/issues/7357)

## Upload

1. Back up the matching website files.
2. Upload the ZIP into the official **public_html** and choose **Extract**.
3. Keep **Currently navigating on** at **/files/public_html/**.
4. Enter **.** (one dot) as **Choose folder name**.
5. Enable **Overwrite existing files**, then extract.
6. Refresh both browser websites and reopen the two apps.

This is a frontend-only package for the existing working installation. No SQL,
backend files, environment edits, route-cache cleanup or Composer commands are
needed. Keep the existing notification configuration and cron. Existing launcher
names/icons may take time to update because the browser/OS manages them.

## Verification

On October 7, 2026, the local Chromium regression passed with controlled native
installation, inventory and permission responses. It covers Customer/Team
isolation, legacy flags, removal, hard refresh, actual browser close/reopen,
shortcut recovery in both cards, a delayed-check/install race, notification tap
routing, and 320/390px layouts. The three worker/manifest tests also passed.
Phone screenshots were inspected for card placement, spacing and button fit.
These tests do not constitute an actual Brave/Android or iPhone installation test.

The prior 1.4 manual release matched 61 public runtime files on the official site.
The 1.5 changes are local until uploaded/deployed. After deployment, test on the
phone: fresh install, reopen browser, delete app, and return to both websites.
Use the recovery control above if the browser cannot report shortcut removal.
Confirm Customer and Team notifications still arrive and open the correct page.

After verification, remove the uploaded ZIP and the two FMRC_PWA_UI_UPDATE
metadata/readme files from public_html. Keep the rollback backup.
