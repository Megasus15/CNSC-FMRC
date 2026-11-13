# Inventory Item Details pilot

This pilot applies only to **View Item** on Admin and Staff Inventory. It uses
the shared `admin-page/inventory.js` renderer and opt-in
`portal-detail-dialog.css` / `portal-detail-dialog.js` assets. Other dialogs keep
their existing appearance.

The cream header has no colored top line. The item body scrolls independently
between the fixed header and footer. Background scrolling stays locked through
the existing Edit Item and nested feedback dialogs; closing restores the page
position and originating View button focus. Variant cards replace the table
below 640px. Inventory data, stock rules and editing permissions are unchanged.

## Local verification

Run from the repository root:

```powershell
node --check admin-page/inventory.js
node --check admin-page/portal-detail-dialog.js
node --test backend/tests/Frontend/inventory-detail-dialog.browser.cjs
node --test backend/tests/Frontend/inventory-report.test.cjs
git diff --check
```

The browser suite uses isolated Chrome sessions and fixture API responses. It
covers both portals, light/dark themes, 320–1440px layouts, short landscape,
a 200%-sized viewport, long and literal text, zero/missing stock, mixed-unit
variants, pagination, focus, reduced motion, scroll restoration, nested
feedback, and View-to-Edit unsaved/failed-save recovery. It prints the temporary
directory containing desktop and mobile screenshots. These checks do not prove
authenticated hosted behavior.

## Release after visual approval

Commit and push these files through the existing online deployment workflow:

- `admin-page/inventory.html`
- `staff-page/inventory.html`
- `admin-page/inventory.js`
- `admin-page/portal-detail-dialog.css`
- `admin-page/portal-detail-dialog.js`
- The browser test and this document

Both Inventory shells reference asset version **2026.1114.1**. Release the
matching shells, stylesheet, behavior and renderer together. No database
migration, Composer install or ZIP upload is needed. After deployment, check
View Item and its Edit handoff in authenticated Admin and Staff sessions.
Additional dialogs can adopt the design individually after pilot approval.
