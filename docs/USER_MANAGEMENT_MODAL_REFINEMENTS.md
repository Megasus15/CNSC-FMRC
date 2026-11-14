# User Management dialogs and Appointment spacing

Release assets: **2026.1114.8**. Frontend presentation and dialog-owner guards
only. No API, database migration, dependency, account authority, deletion rule,
appointment status or financial workflow changes.

## Admin-only User Management

`admin-page/accounts.html` opts in to the shared Inventory/Products/Promotions
popup presentation with `data-portal-popups="refined"` and context
`User Management`. No Staff User Management page or access is added. The
existing Staff redirect and API authorization remain in place.

- User details reuses the cream 800px frame, maroon tile, 12px corners, fixed
  header/footer and scrollable body. The full name is safely rendered in the
  body, with account and sign-in information in responsive sections. Existing
  Google/password indicators and protection reasons are retained.
- Delete Account and staff-request Approve/Reject use compact 480px popups:
  no X, no horizontal message rules, explicit Cancel/action buttons. The
  rejection reason remains optional, keeps its 300-character limit and is
  retained after failure. Existing endpoints and request payloads are unchanged.
- Owners register close handlers once. Escape and Cancel respect pending
  mutations; repeat submissions are blocked. Network/API errors keep the
  dialog reviewable. Nested feedback retains focus and page locking.
- Existing bulk-delete, Admin-creation, logout, session, validation and error
  helpers inherit the page opt-in; automatic success timing/callbacks remain.
- Add System User keeps all original fields, IDs, validation, role behavior,
  live refresh and failure retention. Clear sections, equal field columns,
  required markers, consistent spacing, password controls and a compact
  icon/search treatment match the Inventory design. The conditional Staff
  username picker's hidden wrapper also disappears when switching roles.

The built-in Admin and current-account deletion protections, personal settings,
credentials, notifications and shared operational records are unchanged.

## Appointment refinements in both portals

Appointment details and Manage Calendar have a scoped **1120px** maximum width
and additional body spacing. Other full modals keep their existing widths.
Details fields and custom-product workflow steps wrap without splitting words
into fragments. Existing meeting, quotation, files, PR, conversation and archive
owners remain responsible for their content and actions.

On desktop windows at least 900px wide and 700px high, Calendar keeps its month
grid fixed on the left. Only the right settings pane scrolls vertically; the
outer body, header, footer and background stay fixed. Laptop-height grids use
compact date cells. On phones, short landscape and narrow zoomed viewports,
the panes stack and the body scrolls so no calendar dates or settings become
unreachable. The right pane has a named keyboard-focusable region.

The shared controller supports an opt-in `data-portal-detail-scroll` region
for keyboard scrolling and resets it when the owner opens. Existing pages
without that attribute continue using their normal modal body.

Client Appointments groups type, stage and search controls together with the
same width/44px height, a short Search placeholder and accessible names. The
stage field and its wrapper hide together for All appointments, including the
decorative chevron. Search, pagination and stage-filter values are preserved.

## Verification and deployment

```powershell
node --check admin-page/accounts.js
node --check admin-page/appointments.js
node --check admin-page/portal-detail-dialog.js
node --test backend/tests/Frontend/accounts-dialogs.browser.cjs
node --test backend/tests/Frontend/multiple-admins.browser.cjs
node --test backend/tests/Frontend/appointment-dialogs.browser.cjs
node --test backend/tests/Frontend/appointment-team-workflow.browser.cjs
node --test backend/tests/Frontend/inventory-forms.browser.cjs
node --test backend/tests/Frontend/products-dialogs.browser.cjs
node --test backend/tests/Frontend/notification-layout.browser.cjs
git diff --check
```

Browser suites use isolated API fixtures, including failed and held writes.
They cover 320/390/768/1024/1440px, keyboard, light/dark themes, long plain-text
values, short landscape and a viewport equivalent to 200% zoom. Account checks
include protection, form balance, conditional username controls, create
confirmation cancellation, deletion and staff-request failure/retry, no-X
popups, pending guards, exact page-position and focus restoration. Existing
multiple-Admin tests cover independent state and failed creation. Appointment
checks cover a stationary calendar, right-pane wheel/keyboard scroll, laptop
heights, filter alignment/visibility, meeting/custom-product workflows and
Calendar save/discard/readback guards. Screenshot paths are printed by tests.

Release through **commit → push → online deployment**. Deploy the matching
Accounts shell/CSS/renderer, both Appointment shells, Appointment CSS/renderer
and shared controller together. Updated references use **2026.1114.8**. Other
portal shell changes update only the shared controller's cache version.
No ZIP upload, migration or Composer command is required.

Compare hosted public files to the commit after deployment. This confirms
asset delivery separately from authenticated hosted actions; local fixtures
do not establish real account mutations or live appointment save/readback.
