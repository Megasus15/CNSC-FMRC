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

Light, dark, and device appearance; compact tables; and reduced motion work
across both portals. Device reduced motion is always respected. Restore defaults
resets only the signed-in account. Official print layouts stay light.

## Deployment

Ship the source Admin/Staff HTML, shared assets, controller, routes, and migration
together. Run the new migration on the target installation:

```sh
php artisan migrate --path=database/migrations/2026_10_04_000001_create_user_portal_preferences_table.php --force
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
loading surfaces, and Product Performance footer placement. Screenshots and
surface measurements are written to a temporary directory printed by the test.
External fonts and chart CDNs are blocked in this fixture; chart theme and motion
behavior is checked separately by the frontend test. This is local verification,
not a production or physical-device acceptance test.
