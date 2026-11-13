# Multiple Admin accounts and personal operator state

Use **Admin → User Management → Add System User → Admin**. Full Admins share operational authority, including User Management, with one protected account: **the built-in Admin can never be deleted by another Admin**. The built-in Admin can delete any other Admin, Staff or Customer account, including accounts linked to saved agreements or receipts. Each person needs a separate username, Gmail and password. Signed-in accounts remain protected, and at least one full Admin must remain; presentation accounts do not count toward that minimum.

### Protected built-in account and safe deletion

The account-protection migration permanently marks the earliest existing full Admin by user ID. Presentation accounts are excluded. The marker stays with that account when its name, username or email changes; no client can claim or transfer it. Fresh installations mark the seeded Admin. Do not rerun the database seeder on an existing installation.

The original disabled Customer/Staff rows were accounts with retained custom-product agreements or cash receipts. Those records no longer prevent deletion. User Management now deletes account access using `users.deleted_at`, hides the removed account from the directory, and revokes its API tokens, browser sessions, recovery codes, pending email changes, password resets and push subscriptions. Existing orders, payments, receipts, agreements, reviews and actor/customer identities remain intact. Deleting an account does not cancel an order, refund a payment, or change stock. Deleted accounts cannot sign in through password, Google, recovery codes or an old token.

Deleted usernames and Gmail addresses can now be reused for a **new** account. Generated `active_email` and `active_username` columns enforce database uniqueness only for active accounts; the original identifiers stay attached to the retained historical user. The new account gets a different ID, its own credentials and normal defaults, and no access to the former account's records, settings, sessions or recovery codes. This applies to already deleted accounts as soon as the identifier migration runs. Active-account duplicates remain blocked. Google sign-in selects the current active identity when an older deleted identity has the same Gmail; it cannot restore the deleted account.

Creation validation shows each field error once, beneath that field, and focuses the first invalid field. The form-level message is reserved for general server/connection failures. Form entries remain intact after either type of failure.

Both individual and bulk deletion recheck the rules on the server under ordered Admin roster locks. Bulk deletion skips the built-in Admin and the signed-in account. The directory labels the built-in Admin, disables its deletion and bulk-selection controls, and shows the protection reason in its tooltip and View User details. Other Admins can continue managing unprotected users.

The creation confirmation identifies the recipient and explains full access. Failed creation keeps the form entries. Account-created emails use the existing notification mechanism with Admin-specific instructions. The existing `admin` role is retained; there is no public Admin registration, owner role or copied credentials.

Profiles, passwords, verified email changes, recovery codes, appearance and workspace settings belong to each user. Browser-only table widths, navigation state, analytics ranges, recent inventory categories, archive preferences and success messages now use user-specific keys. Old unowned device-wide values are left untouched and are not inherited by new accounts. Existing account-specific preferences remain intact. The existing same-role browser session model is retained; use separate browser profiles or devices for simultaneous Admin sign-ins.

System records and operational settings remain shared: orders, appointments, inventory, products, reports, staff-request decisions and website content use the existing permissions and refresh mechanisms. User Directory updates use the existing live-data bridge plus a 15-second visible-page poll that preserves filters, page position and unfinished creation entries.

## Release through Git deployment

Commit the matching backend, migration and frontend changes, push through the existing hosting deployment, then run the migration **inside the active Laravel backend directory containing `artisan`**:

```sh
cd ~/domains/ucn-fabmanlab.com/public_html/backend &&
php artisan migrate --path=database/migrations/2026_11_13_000003_create_admin_notification_states.php --force &&
php artisan migrate --path=database/migrations/2026_11_13_000004_protect_builtin_admin_and_retain_deleted_users.php --force &&
php artisan migrate --path=database/migrations/2026_11_13_000005_allow_reusing_deleted_account_identifiers.php --force &&
php artisan optimize:clear
```

Deploy the migration and code as one release; where the hosting process supports it, run the migrations before switching traffic to the new code. No Composer change or ZIP upload is needed. A release without the notification-state table reports that personal notifications are not installed; it never falls back to deleting shared notifications. A release without account-protection columns keeps sign-in and directory reads available but blocks account deletion with a setup message. The account-protection migration refuses rollback while deleted accounts exist, because removing their deletion state would reactivate access. The identifier migration refuses rollback if an email or username has been reused; it never deletes or merges accounts to make old uniqueness rules fit. Shared portal assets retain `2026.1113.9`; the accounts stylesheet uses `2026.1113.10`, and its validation script now uses `2026.1113.11`.

The `admin_notification_states` table has a unique user/notification key with read and dismissal timestamps. The existing `admin_notifications` rows remain shared events. Their old `is_read` flag is an immutable historical baseline; future read/clear actions use only personal state. Clear and mark-all actions capture the existing IDs before writing so new arrivals remain available. Previously deleted events cannot be reconstructed.

Existing notification URLs and `is_read` response fields remain compatible. Responses also include the authenticated `user_id`, and caches are private/no-store. Staff still cannot see or alter Admin-only account-request events. `GET /api/users` adds `can_delete` and `delete_block_reason`; the server rechecks these rules when a deletion is submitted.

## Verify after online deployment

1. Create a second Admin and sign into it in another browser profile/device. Confirm both Admins can use User Management and see the same operational records.
2. Save different personal preferences for the two accounts; change one account's profile and confirm the other is unchanged.
3. Read/remove a notification in one account and verify the other account's feed and badge are unchanged. Verify Staff visibility restrictions as well.
4. From the second Admin, confirm the built-in Admin is labelled protected and cannot be deleted individually, through bulk selection, or through a direct API call. From the built-in Admin, delete a permitted test account linked to a test agreement/receipt; confirm its sessions are revoked and its historical records remain visible. Confirm self-deletion stays blocked.
5. Check User Management, My Account, Settings and notification dialogs on phone and desktop, including dark mode.
6. Create a new test account using a deleted account's Gmail and username. Confirm it appears once in the directory, can sign in with its new password, and has no old transaction history. Submit a current active Gmail again and confirm one error appears beneath Gmail, with no duplicate at the bottom of the form.

Local browser fixtures do not verify hosted deployment, real email delivery or push delivery. Both are checked separately online.

## Local verification

Focused backend tests cover built-in account protection, multiple Admins, safe account deletion, retained history, direct/bulk actions, missing-migration handling, personal notifications, preferences, recovery, Staff access and spectator restrictions. Frontend fixtures cover protected rows, deletion confirmation and failure recovery, account creation, two browser profiles, stale identity responses, independent notification state and responsive layouts.

The optional real-MySQL race test is `backend/tests/Concurrency/admin-roster.php`. It requires a **disposable, already migrated, empty** MySQL database named `fmrc_test_admin_*` and `FMRC_ISOLATED_MYSQL=1`, plus the usual `DB_*` environment variables. Run it from `backend` with `php tests/Concurrency/admin-roster.php`. It starts two PHP workers simultaneously for ten rounds and verifies one full Admin and its token survive each mutual-deletion race. Never point this fixture at an application database.
