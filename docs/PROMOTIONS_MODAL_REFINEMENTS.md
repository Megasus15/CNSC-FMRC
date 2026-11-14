# Promotions dialogs and edit-save behavior

Release assets: **2026.1114.6**. This release changes frontend presentation and
edit-save availability. No API, database migration, Composer dependency, role,
discount calculation, placement rule, schedule conversion or archive endpoint
changes are required.

## Promotions rollout

Both Admin and Staff Promotions shells use the same three modal structures and
the existing shared `admin-page/promotions.js` renderer:

- Add/Edit Promotion
- Add/Edit Announcement
- Promotion Card Theme

The cream 800px frame, maroon icon tile, 12px corners, fixed header/footer and
scrolling body match Inventory and Products. Full modals have a guarded X;
their X and Escape call the owner's existing Cancel/discard handler. Controls
are at least 44px. Fields stack on phones. Product choices have no independent
vertical scroll area; the modal body owns scrolling. Theme presets use native
buttons with pressed state and retain the existing color values and preview.

`data-portal-popups="refined"` and
`data-portal-popup-context="Promotions"` opt the two shells into the shared
compact popup presentation. Archive, bulk archive, discard, validation/error,
informational and logout popups have no X or message separator rules. Success
feedback retains its automatic timing and Dismiss action. Pending saves and
archives prevent duplicate submissions and dismissal. The existing global
notification dropdown and full-height, flush-right All Notifications drawer
retain their established layout.

Search uses the shared icon and **Search** placeholder. The two saved-record
tables filter independently and retain their own pagination and bulk-selection
controllers. The product-picker search hides matching rows without clearing
selected products. Search fields and preview navigation do not count as edits.
Live refresh preserves product selections in an open draft. Late theme reads
cannot overwrite edits or re-seed a closed/reopened editor.

Customer announcement cards and their renderer, footer actions, campaign dates
and Asia/Manila conversion keep their existing behavior. Theme saving still
persists the same five settings. Cancellation restores the original browser
theme preview; a failed save retains the draft for retry.

## Shared edit-save rule

`AdminEditSave` is opt-in and lives alongside `PortalDetailDialog`. It is used by
Edit Item, Edit Product, Edit Promotion, Edit Announcement and Promotion Card
Theme. Unchanged edit forms start with Save/Update disabled. Changing a stored
field enables it; reverting every change disables it again. Fields, checkboxes,
stock toggles, gallery changes, variants and preset controls participate through
the owner's existing snapshot. Pending requests and gallery readiness remain
separate blocking conditions. Failed saves retain edits and allow retry.

Creation forms keep their existing required fields and constraints. Feedback
uses the shared no-X error popup, retains the entries and returns focus to the
invalid field. The helper does not add confirmation steps or change backend
validation. Edit snapshots compare field values directly without serializing
large cover-image data on each keystroke.

## Adoption pattern for subsequent pages

The subsequent [Appointment rollout](APPOINTMENT_MODAL_REFINEMENTS.md) adopts
the shared frame and calendar save rule in **2026.1114.7**, while preserving its
operational workflows. Future pages should adopt one owner at a time:

```js
const saveState = AdminEditSave.bind({
  root: modal,
  button: saveButton,
  getSnapshot: getExistingFormSnapshot,
  isEditing: () => Boolean(editingId),
  isBlocked: () => saving || loading || uploadsPending,
});

// Populate fields and settle initial reads first. Capture the same normalized,
// ordered stored values that the discard guard and existing save payload use.
saveState.capture();

// Recheck at the owner handler too, so Enter/requestSubmit cannot bypass it.
if (!saveState.canSave()) return;

// After changing a programmatic property or an external pending flag:
saveState.sync();
```

Exclude search, focus, preview navigation and cosmetic-only state from the
snapshot. Preserve meaningful ordering for variants/files; normalize unordered
IDs consistently. Never capture a late server response over a dirty draft.
Capture a fresh baseline on every open and only after an acknowledged save if
the owner remains open. Keep failed requests dirty. Continue using the owner's
discard guard and server authorization. The helper binds input/change/click and
observes dynamic child changes; programmatic changes without DOM events must
explicitly call `sync()`. Rebinding the same button cleans its previous binding.
Loading the helper does not enable this rule on unrelated pages.

## Verification and delivery

```powershell
node --check admin-page/promotions.js
node --check admin-page/inventory.js
node --check admin-page/products.js
node --check admin-page/portal-detail-dialog.js
node --check admin-page/admin-common.js
node --test backend/tests/Frontend/promotions-dialogs.browser.cjs
node --test backend/tests/Frontend/inventory-forms.browser.cjs
node --test backend/tests/Frontend/product-detail-dialog.browser.cjs
node --test backend/tests/Frontend/products-dialogs.browser.cjs
node --test backend/tests/Frontend/product-gallery.browser.cjs
node --test backend/tests/Frontend/inventory-detail-dialog.browser.cjs
# Set FMRC_CHROME to the local Chrome/Edge executable for this older suite:
node --test backend/tests/Frontend/announcement-layout.browser.cjs
git diff --check
```

The isolated browser fixtures exercise both roles at 320, 390, 768, 1024 and
1440px, short landscape, an equivalent 200% zoom viewport, keyboard and dark
mode. They test unchanged/reverted edits, unchanged submission bypass attempts,
search, scope/product selection, dates, failed-save retention, pending guards,
theme save/readback/discard, stale reads, archive, scroll/focus and customer-card
parity. Screenshot directories are printed by the suites. Fixture tests do not
write to hosted records.

Release the matching shared CSS/controller/helper, Promotions shells/renderer,
Inventory and Products renderers, Staff Products loader and cache-version
consumers together through **commit → push → online deployment**. Changed asset
references use **2026.1114.6**. Unrelated page shell changes contain shared-asset
version updates only. No ZIP upload, migration or Composer install is needed.
Verify hosted public assets separately from authenticated private dialog and
save behavior; public file equality does not establish a live save/readback.
