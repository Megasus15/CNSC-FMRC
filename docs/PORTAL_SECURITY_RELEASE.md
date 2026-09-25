# Portal sign-in protection: Hostinger File Manager release

Target: `https://ucn-fabmanlab.com`. The local release artifacts are in
`output/portal-security-release/`. Preparing these files does **not** deploy
them. Use an off-peak release window because the File Manager extraction is not
atomic. Do not place SQL, backups, `.env`, or test credentials in `public_html`.

## Install in this order

1. In Hostinger, export the **live** Laravel database with phpMyAdmin and save
   a copy of every path in `FILE-MANIFEST.json`. Confirm that the selected
   database is the one used by the live `backend/.env`; do not share its values.
2. In phpMyAdmin, import `01-INSTALL-SCHEMA.sql` into that database. The final
   `release_status` must be `READY: both portal-security migrations installed`,
   with both `2027_01_08` migration names listed. Stop if it says `STOP` or if
   phpMyAdmin reports any error. The SQL can be imported again after an
   interrupted run; it does not change account or token rows.
3. In File Manager, open the site folder containing `backend`, `admin-page`,
   `staff-page`, `admin-auth`, and `customer-auth` (normally `public_html`).
   Upload `UPLOAD-TO-PUBLIC-HTML.zip` and extract its **contents** there,
   replacing matching files. Confirm that the ZIP did not create an extra
   nested folder. Do not replace `backend/.env`, `backend/vendor`, or uploaded
   media. Check the extracted file count against `FILE-MANIFEST.json` and
   remove the uploaded ZIP from the public folder afterward.
4. In `backend/bootstrap/cache`, remove any generated `routes-*.php` and
   `config.php` cache files if present; leave `.gitignore` and other files
   alone. This makes Laravel read the new routes. If Hostinger provides a PHP
   terminal, `php artisan optimize:clear` from `backend` is equivalent, but
   the File Manager steps do not require one.
5. After confirming the complete upload and cache clear, import
   `02-REVOKE-OLD-ADMIN-STAFF-TOKENS.sql` into the **same** database. It revokes
   old Admin/Staff API tokens once so every operator signs in under the new
   limits. Its final result must say `customer_tokens = NOT TARGETED`. Repeating
   it is harmless but would sign out newly issued Admin/Staff tokens too, so
   import it only once during this release.

The code ZIP contains the new backend classes and migrations, both sign-in
portals, shared Admin/Staff session assets, and all pages that load those
assets. It also carries the already pending Inventory/Reports CSV and Customer
sign-in divider changes in those same edited frontend files. Tests, credentials,
SQL, dependencies, and generated Laravel files are excluded from the public ZIP.

## Production checks after import

- Open both official sign-in pages in a fresh browser session; confirm the
  forms and Turnstile load. Sign in with one ordinary Admin account, one Staff
  account, and one Customer account. Existing Admin/Staff saved tokens should
  be sent back to sign-in; Customer sessions should remain valid.
- With an Admin/Staff bearer token, `GET /api/admin/session` should return UTC
  `server_time`, `idle_warning_at`, `idle_expires_at`, and
  `absolute_expires_at`. Without a token it should return 401. The absolute
  deadline should be six hours after the new token's issue time.
- `POST /api/login-lockout/status` with a random 64-character ticket should
  return `locked: false`, not a 404. With a **dedicated test account**, ten
  consecutive wrong passwords across its email/username and both portal
  endpoints should return 429, a five-minute `locked_until`, and a ticket.
  Refresh or reopen the same browser and confirm the countdown returns.
  Do not run this test on an operational Admin or Staff account.
- On a test Admin/Staff session, verify real interaction renews the idle time,
  background polling does not, the warning is keyboard usable, and **Stay
  signed in** renews the session. The local clock-controlled tests cover the
  exact 60-minute, 63-minute, and six-hour boundaries; live timing still needs
  a browser check.

If the site has a problem, restore the backed-up application files. The two
schema additions can remain; removing them while the new code runs would break
sign-in. Token revocation cannot be undone, so affected operators sign in again.

## Local verification

From `backend`, run:

```text
php artisan test --compact --filter="LoginLockoutTest|AdminSessionLimitsTest|RevokePortalSessionsTest|AdminSpectatorTest"
node --test tests/Frontend/admin-session.test.cjs tests/Frontend/admin-spectator.test.cjs
```

This verifies application behavior in isolated test databases. It does not
verify Hostinger extraction, its live schema, browser layout, or delivery.
