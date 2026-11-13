# Shared Item and Product Details dialogs

The Inventory **View Item** design is also applied to Products **View Product**
in Admin and Staff. Both use the opt-in `portal-detail-dialog.css` /
`portal-detail-dialog.js` assets and their existing shared Admin renderers.
Other dialogs keep their existing appearance. Further rollout remains one
dialog at a time.

The cream header has no colored top line. The item body scrolls independently
between the fixed header and footer. Background scrolling stays locked through
the existing Edit Item and nested feedback dialogs; closing restores the page
position and originating View button focus. Variant cards replace the table
below 640px. Product Details contains the complete cover image, stock and price
tiles, code, visibility, summary, detail tags, availability and recommendations.
Names, paragraphs and tags are rendered as text. Missing and failed images
have explicit empty states. Products retain their existing gallery editor.
Inventory/product data, stock rules and editing permissions are unchanged.

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
node --test backend/tests/Frontend/inventory-detail-dialog.browser.cjs
node --test backend/tests/Frontend/product-detail-dialog.browser.cjs
node --test backend/tests/Frontend/product-gallery.browser.cjs
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

## Release

Commit and push these files through the existing online deployment workflow:

- `admin-page/inventory.html`
- `staff-page/inventory.html`
- `admin-page/inventory.js`
- `admin-page/products.html`
- `admin-page/products.js`
- `staff-page/products.html`
- `staff-page/products-loader.js`
- `admin-page/portal-detail-dialog.css`
- `admin-page/portal-detail-dialog.js`
- The browser test and this document

All four shells reference shared dialog assets **2026.1114.2**. The Products
renderer and Staff loader also use **2026.1114.2**; the unchanged Inventory
renderer remains on **2026.1114.1**. Release the
matching shells, stylesheet, behavior and renderer together. No database
migration, Composer install or ZIP upload is needed. After deployment, check
View Item, View Product and their Edit handoffs in authenticated Admin and Staff
sessions. Additional dialogs can adopt the design individually when requested.
