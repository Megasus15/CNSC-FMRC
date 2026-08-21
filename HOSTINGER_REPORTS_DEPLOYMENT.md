# UCN-FMRC Reports Release - Hostinger Runbook

This runbook deploys the Reports release: the editable official letterhead, the
measured Letter-size print, the professional CSV, dashboard live counts, the
revenue corrections (approved GCash in, approved refunds out), the appointment
and review media viewers, the customer `Others` client type, ten-row tables on
every Admin/Staff page, and the removal of the green Live data chip. It does not
require a historical report-count backfill: `Generated Reports` starts at `0`
when the new audit table is created.

## 1. Record and back up the current production state

1. Schedule a short maintenance window and record the currently deployed Git
   commit or create a dated archive of the active site files.
2. Export the production database from hPanel/phpMyAdmin and verify that the
   backup is readable before changing files.
3. Preserve the production `backend/.env`; never replace it with a local file.
4. Confirm the Hostinger PHP CLI and web runtime satisfy `PHP 8.3+`.
5. From the production `backend` directory, record:

   ```text
   php artisan about
   php artisan migrate:status
   ```

## 2. Deploy migration-first

The migration is additive. The application also guards an unmigrated server,
but the intended sequence is still database first, then the versioned browser
assets.

1. Put Laravel into maintenance mode:

   ```text
   cd backend
   php artisan down --retry=60
   ```

2. Upload or check out the reviewed release, including the new migration,
   model/controller changes, report-template images, and Admin/Staff assets.
   Keep the root `.htaccess` and production `.env` intact. Record the exact
   deployed Git commit (or the checksum/name of the uploaded release archive)
   in the deployment log before continuing.
3. Install optimized production dependencies if the Hostinger workflow does
   not already do so:

   ```text
   composer install --no-dev --optimize-autoloader
   ```

4. Apply and verify the additive migrations:

   ```text
   php artisan migrate --force
   php artisan migrate:status
   ```

   Confirm that `report_generations` is marked as run. Do not seed the old
   hardcoded value `24`. `2026_08_20_000001_add_google_password_state_to_users_table`
   must also show as run: until it does, a first-time Google customer keeps
   seeing `Change Password` instead of `Set Password`.
5. Clear stale Laravel route/config/view caches:

   ```text
   php artisan optimize:clear
   ```

6. Bring Laravel back online:

   ```text
   php artisan up
   ```

The release uses new query-string versions for modified CSS and JavaScript, so
the month-long Hostinger browser-cache rules will fetch the new assets. Every
Admin/Staff asset moves to `?v=5.1` and the customer pages move to `?v=4.6`.
`products-page/products.js` was previously loaded with no version at all, so it
now carries `?v=4.6` too. Spot-check one Admin page and `products-page/` in the
browser Network panel and confirm the served URLs carry the new versions and
return `200`, not a cached `304` for an old file name.

## 3. Authenticated smoke checks

Run these checks once as Admin and once as Staff. Use the browser Network panel
to confirm JSON responses; do not place access tokens in shared notes.

1. Open Dashboard and confirm `Generated Reports` is `0` before the first new
   generation and that `Archived Records` matches the sum of all seven Archive
   tabs: Inventory, Appointments, Orders, Returns, Ratings, Promotions, and
   Announcements.
2. Open Reports and confirm initial loading and the 30-second refresh call the
   read-only `GET /api/admin/reports` route without changing the dashboard
   report count.
3. Click `Generate Report` once. Confirm
   `POST /api/admin/reports/generate` succeeds and the dashboard count becomes
   `1` immediately in another open tab or within 30 seconds on another device.
4. Use Refresh, Report preview, Print / Save PDF, and Export CSV. Confirm none
   of those actions increments the report count.
5. Confirm the preview locks the background page, only the preview body
   scrolls, and closing restores the original page position and focus.
6. Save a Letter-size PDF with browser headers/footers disabled and 100% scale.
   Inspect every page for the official UCN header/footer, FMRC unit block,
   dynamic `Page N of M`, intact rows, and no more than ten detail records per
   sheet.
7. Export CSV and confirm institutional metadata, metrics, breakdown, every
   matching detail row, Philippine characters, and safe spreadsheet opening.
8. Check representative 11-record tables in Accounts (Admin), Appointments,
   Archives, Orders, Inventory, Products, Promotions, Announcements, Ratings,
   and Reports. Each first page must show ten rows and the second page one.
9. Archive, restore, and permanently delete a test record in approved test
   data. Confirm the Archive dashboard count refreshes without reloading.
10. Visit every Admin and Staff page, including Staff Products, and confirm no
    green `Live data` chip remains in any toolbar while the neutral
    `Last updated` timestamp still advances. With two tabs open on the Dashboard,
    generate a report in one and confirm `Generated Reports` and
    `Archived Records` still refresh in the other: the chip markup is gone but
    the silent cross-tab bridge must survive.
11. Confirm the Reports hint reads `Choose a category and reporting period, then
    generate a live report` with `Generate Report` in plain bold text, not a
    maroon or yellow highlight pill.
12. Open `Edit Letterhead` on Reports. Every header, footer, certification and
    signatory line must be an editable field pre-filled from `site_settings`,
    with the official template wording shown as the placeholder when a field is
    blank. Change the unit contact line and the form code, save, then confirm
    `PUT /api/admin/site-settings` returns `200` and the new wording appears in
    both the report preview and a fresh `Export CSV`. Click `Restore official
    defaults`, confirm the template wording returns, and confirm a signed-in
    customer token receives `403` from the same endpoint.
13. Appointments (Admin and Staff): open a record with a `File Attach`. An image
    or video attachment must open in the shared media viewer — Escape and the
    backdrop close it and focus returns to the trigger — while a PDF or document
    opens in a new tab. Confirm the attachment URL uses the live
    `https://ucn-fabmanlab.com/storage/...` host, not `localhost`. Do the same
    for the review media grid on Ratings and the return-evidence photos on
    Orders.
14. Customer product page: open `Customer feedback`, then click a review photo
    and a review video. The viewer must open above the reviews overlay, the
    video must play, and closing must pause and clear it.
15. Customer appointment Step 2: pick `Others`, fill `Please specify`, and submit.
    Confirm the combined `Others: <text>` value appears in the Admin and Staff
    appointment table, the view modal, the archived row and the emailed or
    printed receipt.
16. Total Revenue: approve a GCash order and confirm the Dashboard card rises
    without a reload; approve a refund-resolution return and confirm the card
    falls by the approved amount even before the refund is released. Confirm a
    replacement or repair return, a rejected refund, an unapproved GCash order
    and an approved COD order leave the card unchanged, and that the Overall
    Sales report's `Net Sales` agrees with the card for the same period.

## 4. Monitor after release

For the first production session, monitor `backend/storage/logs/laravel.log`
and browser Network responses for:

- `POST /api/admin/reports/generate`
- `GET /api/admin/dashboard/live-counts`
- `GET /api/admin/dashboard/summary`
- `PUT /api/admin/site-settings`
- archive/restore/delete mutations
- order approval and return decision mutations

Any missing-table condition must return the controlled availability response,
not an SQL exception. A failed refresh must preserve the last-good dashboard
values and leave the `Last updated` timestamp at its previous value rather than
blanking the cards; there is no longer a status chip, so a stalled refresh is
visible only in that timestamp and in the Network panel.

## 5. Rollback

1. Put Laravel into maintenance mode.
2. Restore the previous reviewed application files or Git revision.
3. Run `php artisan optimize:clear`, then `php artisan up`.
4. Leave the additive `report_generations` table in place so audit records are
   preserved and a later redeployment remains compatible.
5. Leave any `report_letterhead_*` rows in `site_settings` in place. They are
   inert for the previous code, which resolves only its own keys, and deleting
   them would discard the operator's corrected letterhead wording.

Do not roll back or drop `report_generations` while any version of the new code
is active. Only remove it after restoring the database backup and confirming a
separate, reviewed database rollback is actually required.
