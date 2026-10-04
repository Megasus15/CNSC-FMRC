# Admin and Staff appearance

Authenticated portals share `admin-page/dark-mode.js`, `dark-mode.css`, and
`portal-theme-coverage.css`. Appearance controls live only in each portal's
Settings page. Authentication and public previews retain their own appearance.

Preferences are stored in `user_portal_preferences`, keyed by the authenticated
user ID. GET/PUT `/api/admin/preferences` permit Admin and Staff only and never
accept another user's ID. A per-user browser cache applies the appearance before
paint; same-account tabs update immediately. Account changes load a separate
cache. Other devices refresh on focus and every 30 seconds while visible.
Unavailable saves remain pending and retry automatically.
Sidebar changes are marked saved only when the API confirms all six values;
an older uploaded controller cannot silently discard the new preferences.

Light, dark, and device appearance; compact tables; and reduced motion work
across both portals. Device reduced motion is always respected. Restore defaults
resets only the signed-in account. New accounts and restored preferences use
Light; Dark and device appearance remain explicit personal choices. Official
print layouts stay light.

## Sidebar and personal branding

All 39 authenticated pages load shared `portal-sidebar.css` and
`portal-sidebar.js`. My Account precedes Settings in both the sidebar and the
profile menu. No login or customer page consumes the desktop sidebar layer.
The sidebar's native scrollbar sits on its left edge on every screen, leaving
the right edge available for desktop resizing. Menu content keeps its normal
left-to-right order.

Above 1024px, drag the sidebar's right edge to adjust it. Click the edge to
collapse or reopen; keyboard users can focus it and use Left/Right, Home/End,
or Enter/Space. Escape cancels a drag. The maximum stays at the original 270px;
widths below 180px snap to a 76px icon rail on release. Icons retain accessible
names and tooltips. Selecting Website Management from the rail expands its
navigation. Content and header positions follow the chosen width.

The existing tablet rail and 720px phone drawer keep their automatic behavior.
Desktop sizing controls are hidden at those sizes and the Settings width slider
is disabled. Saved desktop width is restored on a larger screen.

Settings > Sidebar & branding has an 18-character title and Upload / Adjust /
Default logo controls. Title and logo edits apply to the actual sidebar; there
is no separate live-preview card. PNG, JPG, and WebP files up
to 5 MB can be fitted, moved, rotated, and resized inside the circle. The editor
exports a transparent 256px PNG and Cancel leaves the current logo unchanged.
Changing accounts cancels unfinished logo editing. Branding and width are
personal to the signed-in account; Default branding affects only title/logo,
while Restore defaults resets all six preferences.

## Deployment

### Hostinger file uploads / phpMyAdmin

Uploading PHP and frontend files does **not** run Laravel migrations. When
`user_portal_preferences` is absent, its authenticated API returns HTTP 503;
Settings correctly applies the browser cache but cannot save to the account.

1. In hPanel, open **Databases > phpMyAdmin > Enter phpMyAdmin**.
2. Select **u799987132_ucn_fmrc_db**, then open the **SQL** tab.
3. Run `backend/database/manual/2026_10_04_install_portal_preferences.sql`.
   Alternatively, import that file from phpMyAdmin's **Import** tab.
4. The verification results must show `user_portal_preferences` with `user_id`,
   `theme`, `compact`, `reduced_motion`, `workspace`, `created_at`, and `updated_at`.
   If the table was installed earlier and **workspace is missing**, run
   `backend/database/manual/2026_10_04_upgrade_portal_workspace.sql` once. Skip
   its ALTER statement if workspace already exists. The upgrade adds only one
   nullable JSON column and preserves existing preferences.
   Existing installations can also run
   `backend/database/manual/2026_10_04_set_portal_light_appearance.sql` to match
   the new database fallback. This changes no account's saved theme. The
   updated frontend and preference controller already use Light for accounts
   without saved preferences.
5. Upload the revised preference controller, new migration, all changed Admin/
   Staff HTML, and shared appearance, settings, and sidebar assets together.
6. Reload Admin and Staff Settings. Each account's pending changes will retry;
   the status should become **Saved to your account**. Change appearance, reload,
   and confirm that another account retains its own preference.

The SQL targets the database named above even if phpMyAdmin's current selection
changes. It only creates the preferences table if absent, with one row per user
and a foreign key to `users`. It preserves all existing account and preference
data. The migration now skips this already installed table, so running it later
can register the migration safely.

If the table already exists, inspect the failing **GET/PUT /api/admin/preferences**
request in browser DevTools' Network tab instead of repeating the installer.
HTTP 401 means the session needs renewal; HTTP 404 means the route was not
deployed or Laravel's route cache is stale; HTTP 503 with this controller means
the preferences table or the workspace column required by a sidebar save is
absent from the database configured by the deployed backend.
Confirm its `DB_DATABASE` matches the database where the table was installed.
Never publish the backend environment file or bearer token.

### With SSH / Artisan access

Ship the source Admin/Staff HTML, shared assets, controller, routes, and migration
together. Run the new migration on the target installation:

```sh
php artisan migrate --path=database/migrations/2026_10_04_000001_create_user_portal_preferences_table.php --force
php artisan migrate --path=database/migrations/2026_10_04_000002_add_workspace_to_portal_preferences_table.php --force
php artisan migrate --path=database/migrations/2026_10_04_000003_use_light_portal_appearance.php --force
```

The migration has been applied locally. Production deployment is a separate step.
Do not recursively synchronize `backend/public/frontend`; it contains unrelated
nested customer copies.

## Maintenance and checks

After changing legacy portal CSS or inline module colors, rebuild the dark
coverage:

```sh
node tools/design/build-portal-theme.cjs
```

Increment the theme asset cache versions when releasing changed shared assets.
The generator preserves customer previews and print paper, and leaves original
light styles intact. The Dashboard SVG is locally bundled; its Lucide license is
alongside the asset.

From `backend`:

```sh
php artisan test --compact --filter='PortalPreferenceTest|AdminSessionLimitsTest|AdminSpectatorTest'
node --test tests/Frontend/portal-preferences.test.cjs tests/Frontend/admin-session.test.cjs tests/Frontend/admin-spectator.test.cjs tests/Frontend/admin-only-website-settings.test.cjs
node --test tests/Frontend/portal-theme.browser.cjs
```

The browser check uses an isolated local fixture API and Chrome/Edge. It checks
all 39 portal pages in both themes, live account isolation, responsive Settings,
desktop resizing and rails, logo editing, menu order, loading surfaces, and
Product Performance footer placement. Screenshots and
surface measurements are written to a temporary directory printed by the test.
External fonts and chart CDNs are blocked in this fixture; chart theme and motion
behavior is checked separately by the frontend test. This is local verification,
not a production or physical-device acceptance test.
