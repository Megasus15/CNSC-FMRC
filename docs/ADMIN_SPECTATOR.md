# Temporary admin presentation account

The built-in `presentation` account opens the existing Admin portal with live
data. Its role remains `admin` for page access, with `is_spectator` enforced by
middleware across API and web routes. Existing Admin, Staff and Customer
accounts keep their permissions.

The account can browse pages, details, searches, filters, report previews,
downloads and email-template previews. Forms are read-only; saving, creation,
deletion, approvals, uploads, payment changes and settings changes are blocked.
Opening notifications or inquiries does not mark them read. Spectator archive
visits do not run auto-delete. Report previews and downloads do not create
report-generation history. Normal token/session bookkeeping still occurs.

## Install and create

For Hostinger File Manager without SSH, the prepared release is in
`output/admin-spectator-release/`. Follow `START-HERE.txt`: import
`01-DATABASE-FIELDS.sql` in the live phpMyAdmin database, extract
`UPLOAD-TO-PUBLIC-HTML.zip` into the site's root, then import
`03-CREATE-OR-EXTEND-ACCOUNT.sql`. Keep both SQL files outside the public
website. The account SQL must run only after the complete code upload.
The release files are private local artifacts excluded from Git.

Upload the changed backend files, shared Admin scripts and accompanying
Admin/Staff HTML cache-version updates together. This checkout does not deploy
itself to Hostinger; creating an account locally does not create a live account.
From the intended environment's `backend` directory, run only this migration:

```sh
php artisan migrate --path=database/migrations/2027_01_07_000000_add_spectator_access_to_users_table.php --force
php artisan optimize:clear
php artisan admin:spectator --expires=2026-10-05
```

The command prints the generated password once. Use username `presentation`
on `admin-auth/auth.html`. Existing login/CAPTCHA behavior still applies.
`presentation@fmrc.invalid` is an internal identifier, not an email inbox.
No password is committed in source, and there is no universal default password.

The presentation account expires at **October 5, 2026, 11:59:59 PM Philippine
time** (15:59:59 UTC). New accounts default to this date. The explicit
`--expires=2026-10-05` option also updates an existing presentation account
without rotating its password or changing its view-only permissions.
Expiry blocks new logins and
further authenticated reads/writes, including previously issued tokens. Logout
remains available. The expiry is checked on requests, so no scheduled job is
needed. The account row remains until explicitly removed.

Repeated creation commands without `--expires` preserve the existing password
and expiry. Dates use Philippine time and must be valid future dates. The
command refuses to replace an ordinary account with the same username/email
and refuses creation until both restriction columns exist. New restrictions
are not accepted through public registration or profile updates.

The “Spectator · View only” message appears as a white floating notification
with a close button. Dismissing it keeps it hidden for that browser tab's
session, including page navigation; the view-only restrictions remain active.

After deployment, verify login, the dismissible notification, live data,
page navigation, report preview, and disabled save/delete controls. A crafted
authenticated mutation should return HTTP 403 with `SPECTATOR_READ_ONLY`.
Check an ordinary Admin/Staff session still performs its existing actions.

## Remove after the presentation

Run in the same environment where the account was created:

```sh
php artisan admin:spectator --remove
```

This removes only the built-in flagged presentation account and revokes its
tokens. It does not delete any business records. To create another presentation
account later, pass a future `--expires=YYYY-MM-DD` and use its new password.

## Revert this feature

Remove the spectator account **before reverting backend code or the migration**.
Otherwise an account whose role is `admin` could lose its read-only enforcement.
Leaving the two nullable/defaulted database fields after removing the account
is safe. The migration itself refuses rollback while any spectator account
exists; this cannot protect against separately reverting middleware files.

## Verification

```sh
php artisan test --compact --filter=AdminSpectatorTest
node --test tests/Frontend/admin-spectator.test.cjs
```

Run these from `backend`. PHP tests use an isolated in-memory SQLite database;
they do not verify the deployed database or browser layout.
