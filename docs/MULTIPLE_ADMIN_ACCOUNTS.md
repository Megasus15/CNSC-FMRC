# Multiple Admin accounts and personal operator state

Use **Admin → User Management → Add System User → Admin**. Each full Admin has the same authority, including managing peer Admins. A separate username, Gmail and password are required. The signed-in account cannot be deleted, at least one full Admin must remain, and presentation accounts do not count toward that minimum. Existing agreement/receipt deletion restrictions still apply.

The creation confirmation identifies the recipient and explains full access. Failed creation keeps the form entries. Account-created emails use the existing notification mechanism with Admin-specific instructions. No new public registration path, owner role, copied credentials or changed seeder is introduced.

Profiles, passwords, verified email changes, recovery codes, appearance and workspace settings belong to each user. Browser-only table widths, navigation state, analytics ranges, recent inventory categories, archive preferences and success messages now use user-specific keys. Old unowned device-wide values are left untouched and are not inherited by new accounts. Existing account-specific preferences remain intact. The existing same-role browser session model is retained; use separate browser profiles or devices for simultaneous Admin sign-ins.

System records and operational settings remain shared: orders, appointments, inventory, products, reports, staff-request decisions and website content use the existing permissions and refresh mechanisms. User Directory updates use the existing live-data bridge plus a 15-second visible-page poll that preserves filters, page position and unfinished creation entries.

## Release through Git deployment

Commit the matching backend, migration and frontend changes, push through the existing hosting deployment, then run the migration **inside the active Laravel backend directory containing `artisan`**:

```sh
php artisan migrate --path=database/migrations/2026_11_13_000003_create_admin_notification_states.php --force
php artisan optimize:clear
```

Deploy the migration and code as one release; where the hosting process supports it, run the migration before switching traffic to the new code. No Composer change or ZIP upload is needed. A release without the new table reports that personal notifications are not installed; it never falls back to deleting shared notifications. Updated portal asset references use `2026.1113.9`.

The `admin_notification_states` table has a unique user/notification key with read and dismissal timestamps. The existing `admin_notifications` rows remain shared events. Their old `is_read` flag is an immutable historical baseline; future read/clear actions use only personal state. Clear and mark-all actions capture the existing IDs before writing so new arrivals remain available. Previously deleted events cannot be reconstructed.

Existing notification URLs and `is_read` response fields remain compatible. Responses also include the authenticated `user_id`, and caches are private/no-store. Staff still cannot see or alter Admin-only account-request events. `GET /api/users` adds `can_delete` and `delete_block_reason`; the server rechecks these rules when a deletion is submitted.

## Verify after online deployment

1. Create a second Admin and sign into it in another browser profile/device. Confirm both Admins can use User Management and see the same operational records.
2. Save different personal preferences for the two accounts; change one account's profile and confirm the other is unchanged.
3. Read/remove a notification in one account and verify the other account's feed and badge are unchanged. Verify Staff visibility restrictions as well.
4. Confirm the signed-in Admin is protected in single and bulk deletion, then verify a permitted peer deletion invalidates only the deleted account's access.
5. Check User Management, My Account, Settings and notification dialogs on phone and desktop, including dark mode.

Local browser fixtures do not verify hosted deployment, real email delivery or push delivery. Both are checked separately online.

## Local verification

Focused backend tests cover multiple Admins, personal notifications, preferences, recovery, Staff access, spectator restrictions, retained records and bulk actions. Frontend fixtures cover account creation confirmation, failure recovery, two browser profiles, stale identity responses, independent notification state and responsive layouts.

The optional real-MySQL race test is `backend/tests/Concurrency/admin-roster.php`. It requires a **disposable, already migrated, empty** MySQL database named `fmrc_test_admin_*` and `FMRC_ISOLATED_MYSQL=1`, plus the usual `DB_*` environment variables. Run it from `backend` with `php tests/Concurrency/admin-roster.php`. It starts two PHP workers simultaneously for ten rounds and verifies one full Admin and its token survive each mutual-deletion race. Never point this fixture at an application database.
