# Update the official notification UI

The user reported realtime Customer and Team phone delivery on the official
website on October 7, 2026. This package changes permission panels, installation
state, app launch presentation and Team icon artwork.

Build with `python tools/pwa/build-ui-update.py`. Use
**`output/fmrc-notification-ui-update.zip`** on the existing official website.
Its allowlist contains the shared app assets, updated original HTML consumers,
Team icon/manifest files, app gateways and the Customer notification-tap resolver.
It contains no environment, SQL, dependencies, storage or delivery-processor files.

1. Select **ucn-fabmanlab.com** in hPanel and open its File Manager.
2. Back up the matching files listed in `FMRC_PWA_UI_UPDATE.json`, especially
   `backend/routes/api.php` and `CustomerNotificationController.php`.
3. Upload the ZIP inside the official **public_html** and open **Extract**.
4. In the extraction dialog, keep **Currently navigating on** at
   **`/files/public_html/`**. Enter **`.`** (one dot) in **Choose folder name**
   to extract directly into that current directory.
5. Enable **Overwrite existing files**. The destination must resolve to
   **`/files/public_html/`**, with exactly one `public_html`. Click **Extract**.
   The archive contains individual matching files and no enclosing folder.
   [Hostinger documents selecting an existing destination folder and overwriting files](https://www.hostinger.com/support/1583613-how-to-extract-archives-using-the-file-manager-in-hostinger/).
6. If present, remove only the generated
   **`backend/bootstrap/cache/routes-v7.php`** to expose the added Customer tap
   route. With SSH, `php artisan route:clear` from `backend/` does this instead.
7. Refresh the website and reopen both apps. Keep the existing push setting,
   VAPID pair, notification subscriptions and permanent cron.

Entering `public_html` while already inside `/files/public_html/` creates a
nested directory. The current-directory dot method was confirmed working in
this Hostinger session after the earlier parent-folder instructions repeatedly
left the release inside `public_html/public_html`.
Do not replace or delete the entire existing frontend or backend directories.

Check the Customer sidebar panel and Admin/Staff Settings at phone width. Each
panel should show preference checkboxes, compact single-line actions and a
device status. The original website announcement/workspace bell still works.
Phone taps should open the original update rather than a preferences panel.
Open Customer and Team from their Home Screen icons: the extra opening page is
gone and the existing UCN-FMRC loader remains. Browser/OS splash screens are
controlled by the platform.

The Team source icons now have opaque maroon edges, including the adaptive icon.
An existing phone launcher may retain the old icon. Remove and reinstall **Team**
only if its artwork stays stale; check its notification permission afterward.

Installation is remembered separately for Customer and Team across refreshes,
logout and browser reopening. A supported related-app inventory confirms actual
installation/removal. Some browsers cannot inspect Home Screen shortcuts, so
perfect automatic uninstall detection is unavailable there. The installation
pages retain **Already installed** / **I removed this app** confirmation controls.
Clearing website data or using a different browser can require reconfirmation.
[Browser detection support](https://developer.chrome.com/docs/capabilities/get-installed-related-apps),
[Safari storage and installation detection](https://web.dev/learn/pwa/detection).

Local checks cover the real Chromium DOM/workers, controlled installation and
permission responses, narrow layouts, dark mode, browser restart and notification
tap routing. They do not establish actual Brave/Android or iPhone UI acceptance
for this new package. They remain separate from manual deployment verification.

After the user extracted using the dot method on October 7, read-only requests
to the official site matched all 61 public runtime files against the release.
The release marker was present at the active root. All four version-3 Team icon
images matched the local decoded pixels, including opaque maroon corners.
The numeric notification-target route also reached its controller and returned
the expected not-found response for ID 0, while a nonnumeric probe was rejected
as an unknown route. The added route is active, so no manual route-cache cleanup
was needed in this session. Backend source bytes were not publicly fetched;
actual-phone UI/tap acceptance still needs the device check.

After verification, delete the uploaded ZIP and the two `FMRC_PWA_UI_UPDATE`
metadata/readme files from `public_html`. Keep the rollback backup.
