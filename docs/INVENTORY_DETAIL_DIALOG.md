# Shared Inventory and Product dialogs

The shared design covers Inventory **View Item**, **Add New Item / Edit Item**,
**Stock Level Rules**, **Edit Letterhead**, and single/bulk **Archive**
confirmation in Admin and Staff, plus Products **View Product**. It uses the
opt-in `portal-detail-dialog.css` / `portal-detail-dialog.js` assets and the
existing shared Admin renderers. Deduct Stock, generated-report previews and
other pages' dialog presentations retain their existing appearance. Further
rollout remains one dialog at a time.

The cream header has no colored top line. The item body scrolls independently
between the fixed header and footer. Background scrolling stays locked through
the existing Edit Item and nested feedback dialogs; closing restores the page
position and originating View button focus. Variant cards replace the table
below 640px. Product Details contains the complete cover image, stock and price
tiles, code, visibility, summary, detail tags, availability and recommendations.
Names, paragraphs and tags are rendered as text. Missing and failed images
have explicit empty states. Products retain their existing gallery editor.
Inventory/product data, stock rules and editing permissions are unchanged.

Inventory form dialogs use the same 800px maximum frame. Archive confirmation
uses a compact 480px frame without body separator rules. Restore defaults is
above the Letterhead fields, leaving Cancel and Save Letterhead in the fixed
footer. Empty/hidden errors take no space; real failed-save errors remain
visible. Stock-rule lists have no separate vertical scroll areas.

`PortalDetailDialog.registerClose(root, handler)` routes header Close and Escape
through the existing Cancel/discard or saving guard. Guarded dialogs cannot be
closed by the shared controller without their registered handler. Letterhead's
legacy keyboard handler defers to the shared one only for opted-in dialogs.

`showAdminConfirmPopup` accepts optional `presentation: "inventory"` and
`trigger` options for Inventory archive confirmation. Other callers retain the
default presentation. Archive pending state blocks dismissal, and the shared
popup resets its presentation before showing an unrelated confirmation/error.
Backend endpoints and request payloads are unchanged.

The shared controller discovers opt-in dialogs dynamically, so Staff's existing
Products loader can clone the Admin modal after page startup without a second
renderer or duplicate event handlers.

## Local verification

Run from the repository root:

```powershell
node --check admin-page/inventory.js
node --check admin-page/portal-detail-dialog.js
node --check admin-page/products.js
node --check staff-page/products-loader.js
node --check admin-page/admin-common.js
node --check admin-page/reports.js
node --test backend/tests/Frontend/inventory-detail-dialog.browser.cjs
node --test backend/tests/Frontend/inventory-forms.browser.cjs
node --test backend/tests/Frontend/product-detail-dialog.browser.cjs
node --test backend/tests/Frontend/product-gallery.browser.cjs
node --test backend/tests/Frontend/reports.browser.cjs
node --test backend/tests/Frontend/inventory-report.test.cjs
git diff --check
```

The browser suite uses isolated Chrome sessions and fixture API responses. It
covers both portals, light/dark themes, 320–1440px layouts, short landscape,
a viewport equivalent to 200% zoom, long and literal text, zero/missing stock, mixed-unit
variants, pagination, focus, reduced motion, scroll restoration, nested
feedback, and View-to-Edit unsaved/failed-save recovery. It prints the temporary
directory containing desktop and mobile screenshots. These checks do not prove
authenticated hosted behavior. Inventory form checks additionally cover
guarded Close/Escape, direct SVG icon clicks, fixed/percentage overrides,
inheritance, filtering, delayed reads, failed saves, Letterhead restore and
pending guards, single/bulk archive, and global-popup presentation isolation.

## Release

Commit and push these files through the existing online deployment workflow:

- `admin-page/inventory.html`
- `staff-page/inventory.html`
- `admin-page/inventory.js`
- `admin-page/admin-common.js`
- `admin-page/reports.js`
- `admin-page/products.html`
- `staff-page/products.html`
- `admin-page/portal-detail-dialog.css`
- `admin-page/portal-detail-dialog.js`
- The browser test and this document
- Other Admin/Staff HTML consumers with updated shared-script cache versions

Shared dialog assets, Inventory renderer, shared confirmation helper and Reports
script now use **2026.1114.3**. Their HTML consumers have matching version
references. The unchanged Products renderer and Staff Products loader remain
on **2026.1114.2**. Release the
matching shells, stylesheet, behavior and renderer together. No database
migration, Composer install or ZIP upload is needed. After deployment, check
View Item, View Product, Add/Edit Item, Stock Level Rules, Letterhead save/reset
and archive confirmation in authenticated Admin and Staff sessions. Confirm
that report PDFs and unrelated confirmations still use their existing layouts.
Additional dialogs can adopt the design individually when requested.
