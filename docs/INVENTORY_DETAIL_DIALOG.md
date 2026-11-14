# Shared Inventory and Product dialogs

The shared design covers Inventory **View Item**, **Add New Item / Edit Item**,
**Adjust Stocks**, **Stock Level Rules**, **Edit Letterhead**, and single/bulk **Archive**
confirmation in Admin and Staff, plus Products **View Product**. It uses the
opt-in `portal-detail-dialog.css` / `portal-detail-dialog.js` assets and the
existing shared Admin renderers. Generated-report previews and
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
uses a compact 480px frame without an X button or body separator rules. Cancel
and Archive remain available, with Escape following Cancel when not pending.
Restore defaults is
above the Letterhead fields, leaving Cancel and Save Letterhead in the fixed
footer. Empty/hidden errors take no space; real failed-save errors remain
visible. Stock-rule lists have no separate vertical scroll areas. The guide
starts collapsed on every open and uses a keyboard-accessible Show/Hide guide
button with double chevrons below the introductory card text. Toggling the
guide does not reload rules or alter a draft.

Adjust Stocks retains the existing add/deduct and variant-selection workflow,
signed adjustment payloads, journal metadata, validation and failure recovery.
Its Close icon and Escape use the existing Cancel handler. Mode buttons expose
their pressed state, and the form uses the same fixed footer and body scrolling.

Letterhead fields align at the top with uniform 44px inputs, so helper text
cannot stretch an adjacent field. Desktop pairs use equal columns; an odd final
field spans the full row. Phones stack the fields. Names, positions, hints and
stored values keep their existing bindings. Both Inventory search fields use
the compact Search placeholder, a decorative search icon and descriptive
accessible names; filtering behavior remains unchanged.

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
pending guards, single/bulk archive, global-popup presentation isolation,
collapsed-guide keyboard controls, search/icon spacing, Letterhead pair
alignment and single-item/variant stock adjustments with signed payloads.

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

The shared stylesheet, Inventory renderer and confirmation helper now use
**2026.1114.4**. Their HTML consumers have matching version references. The
unchanged shared dialog controller and Reports script remain on **2026.1114.3**;
the Products renderer and Staff Products loader remain on **2026.1114.2**. Release the
matching shells, stylesheet, behavior and renderer together. No database
migration, Composer install or ZIP upload is needed. After deployment, check
View Item, View Product, Add/Edit Item, Adjust Stocks, Stock Level Rules and its
collapsed guide, Letterhead field alignment/save/reset
and archive confirmation in authenticated Admin and Staff sessions. Confirm
that report PDFs and unrelated confirmations still use their existing layouts.
Additional dialogs can adopt the design individually when requested.
