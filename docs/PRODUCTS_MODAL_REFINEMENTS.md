# Products dialogs and shared notification refinements

Release assets: **2026.1114.5**. This is a frontend-only release: no migration,
Composer install, new dependency, or ZIP upload is required.

The following [Promotions rollout](PROMOTIONS_MODAL_REFINEMENTS.md) extends the
design and introduces the opt-in unchanged-edit save rule for Inventory,
Products and Promotions in assets **2026.1114.6**.

## Scope

Inventory and Products opt in with `data-portal-popups="refined"` on their
Admin and Staff page bodies. Confirmations, validation/errors, informational
messages and logout use the compact cream frame, semantic icon, 12px corners,
explicit actions and no header X. Success notifications keep their existing
timer and callbacks; the manual action is **Dismiss**. Inventory Letterhead
Restore defaults now uses the styled confirmation and retains its existing
immediate-save behavior after confirmation.

Products additionally uses `data-portal-product-dialogs` for its media preview.
Add/Edit Product, image editing and permanent deletion reuse the shared dialog
assets. Product details keeps its existing renderer. Full forms and preview
use an 800px maximum frame; deletion and other compact popups use 480px.
Only full modals have a header X. Add/Edit and image-editor X/Escape call their
existing discard handlers. Save/delete pending states block duplicate actions
and dismissal. The checkbox still means `is_blocked=true` when checked.
Gallery limits, drafts, upload/save failure recovery and API payloads remain
unchanged. The gallery's icon controls are now at least 44px and wrap in pairs.

Following the user's rollout clarification, **notifications alone are refined
across every Admin and Staff page**. The dropdown retains its existing card,
positioning, feed and View All action. All Notifications retains its right-side
drawer, flush against the right edge and filling the viewport height, with a
full-page backdrop. It has no floating outer margins or rounded frame; filter
tabs, action toolbar and scrolling feed keep their existing arrangement. Shared colors,
typography, 44px controls, neutral borders and theme-aware surfaces refine
these existing layouts. Personal notification read/clear state, role filtering,
unread/app badges and record navigation keep their existing handlers. Errors
opened within All Notifications use the compact popup above the drawer.
Other pages' forms, popups, media previews, logout and session presentation
retain their current appearance.

## Overlay ownership

`portal-detail-dialog.css` and `portal-detail-dialog.js` are included by every
shared-header portal shell to support the same notification experience.
Styling for forms/popups stays opt-in. Merely loading the assets does not adopt
other page dialogs.

Keep outer Product containers as `div.modal-overlay`: Staff's existing loader
clones these containers and runs the shared Admin renderer once. Do not replace
field IDs or duplicate portal logic.

- `PortalDetailDialog.registerClose(root, handler)` delegates X/Escape to the
  owner's cancellation, discard or pending guard.
- `PortalDetailDialog.adopt(root, {close, visibility})` registers dynamically
  created owners. `visibility: "hidden"` supports media previews; normal roots
  continue to use `.show`.
- `data-portal-detail-guarded` fails closed when no close handler is registered.
- `data-portal-detail-keyboard-owner` lets session warnings retain their existing
  non-dismissible keyboard behavior. Session timing and renewal are unchanged.
- `data-portal-detail-escape-owner` lets the expanded Product picker consume
  Escape before its parent form. Arrow keys and native Enter select options.

The controller locks the page once for the complete overlay flow, compensates
for scrollbar removal, inerts the background and lower layers, contains focus,
and restores styles, page position and opener focus when the flow closes.
Preview close still pauses and unloads video through the original owner.
No global `window.confirm` override is introduced.

## Verification

Run from the repository root:

```powershell
node --check admin-page/admin-common.js
node --check admin-page/admin-session.js
node --check admin-page/portal-detail-dialog.js
node --check admin-page/products.js
node --check admin-page/reports.js
node --check staff-page/products-loader.js
node --test backend/tests/Frontend/products-dialogs.browser.cjs
node --test backend/tests/Frontend/inventory-forms.browser.cjs
node --test backend/tests/Frontend/product-detail-dialog.browser.cjs
node --test backend/tests/Frontend/inventory-detail-dialog.browser.cjs
node --test backend/tests/Frontend/product-gallery.browser.cjs
node --test backend/tests/Frontend/multiple-admins.browser.cjs
node --test backend/tests/Frontend/admin-session.test.cjs
node --test backend/tests/Frontend/admin-spectator.test.cjs
node --test backend/tests/Frontend/reports.browser.cjs
node --test backend/tests/Frontend/inventory-report.test.cjs
git diff --check
```

Browser suites use isolated Chrome profiles and local API fixtures, including
intentional failed and held requests. They print the screenshot directories.
Coverage includes both roles, 320/390/768/1024/1440px, light/dark themes,
short landscape, a viewport equivalent to 200% zoom, existing/new product
selection, image editing, hidden/stock values, pending guards, failed-save
retention, gallery uploads/reordering/discard, deletion rejection/success,
nested previews, media cleanup, notification actions, logout cancellation and
simulated session warning/renewal/expiry. Other-page notification and popup
checks establish the scope boundary. PDF/report fixtures retain their existing
output checks. These tests do not mutate hosted inventory or products.

## Deployment

Commit and push the matching files through the existing online deployment:

1. Release the shared CSS/controller, common helper, session script, Products
   renderer/shell, Staff loader, Reports script, and updated HTML consumers
   together. Changed asset references use **2026.1114.5**.
2. Verify hosted source assets match the committed files and the four selected
   shells contain their opt-ins. Check a second page includes the notification
   assets without enabling that page's general popup rollout.
3. In authenticated Admin and Staff sessions, check read-only dialog behavior,
   notification dropdown/drawer, appearance and scroll/focus restoration.
   Perform destructive/mutation scenarios only with suitable test records.

Public asset verification and local fixture tests are separate evidence.
Authenticating against the live deployment is required to verify hosted private
UI and save flows; a matching asset response alone does not prove those flows.
