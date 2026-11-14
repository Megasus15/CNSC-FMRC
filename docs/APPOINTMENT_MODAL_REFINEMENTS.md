# Appointment dialogs and shared notification refinements

Release assets: **2026.1114.7**. Frontend-only changes; no endpoint, migration,
Composer dependency, authorization, appointment status, quotation, payment or
archive-rule changes are required.

## Appointment rollout

Admin and Staff share the same dialog markup and `admin-page/appointments.js`
renderer. Their bodies opt in with `data-portal-popups="refined"` and
`data-portal-popup-context="Appointments"`.

The following dialogs reuse the approved Inventory/Products/Promotions design:

- Appointment details
- Manage Calendar
- The nested time-slot picker
- Archive appointment and bulk-archive confirmation
- Confirm consultation and existing shared confirmation/error popups
- Logout and session notices through the existing page opt-in

Full modals use the cream surface, maroon icon tile, 12px corners and 800px
maximum frame. Headers and footers remain fixed while the body scrolls. Compact
confirmations use the 480px frame, with no X and no separator rules around the
message. Full-modal X and Escape call the owner's close/discard/pending handler.
The shared controller handles background locking, scrollbar compensation,
inertness, focus containment, nested ownership and page/focus restoration.
Appointment details' old scroll-lock handler defers to it on this page.

Appointment details preserves all client/schedule fields, department and PR,
private-file controls, meeting editor, custom-product tabs, quotation forms,
conversation drafts, live refresh, consultation and archive eligibility. Long
client names wrap inside the body. The status sits below the name so it does
not squeeze the text. Form and content styles are scoped in the new
`admin-page/appointment-dialogs.css`; Customer appointment styles remain intact.
Expanded comboboxes consume their own Escape before the surrounding dialog.

Manage Calendar retains the existing global/day-specific slot and block/note
operations and the same PUT payload. The page body is its only general vertical
scroll area; left/right panes and rule lists no longer scroll independently.
Desktop uses two content columns and phones stack them. Dates are native
keyboard-accessible buttons with selected state and meaningful labels. The
existing weekend/past-date and booked-slot restrictions remain unchanged.

The shared `AdminEditSave` helper disables Save Changes until stored calendar
values change, and blocks unchanged submissions at the handler. Reverting all
changes disables it again. Date/month selection and picker navigation do not
count as saved changes. Closing a dirty calendar uses the shared discard guard.
Unadded note/slot input is included in that discard check. Failed saves retain
the draft, and pending load/save prevents dismissal or duplicate save. Delayed
reads from a closed or superseded calendar cannot overwrite a new draft.
Calendar reads bypass the browser cache; a failed post-save readback does not
turn a server-confirmed save into a false failure or redraw a reopened draft.
Online meeting details retain their existing unchanged-save state and also
reject an unchanged programmatic submission.

## Minor shared refinements

The **Live Customer Website Announcement Preview** heading and eye icon use
the shared maroon accent in both Promotions portals.

Notification dropdowns keep their existing card and feed structure. Their
check/remove actions form a 44px-wide vertical rail, leaving more room for
titles and messages while keeping 44px hit targets. Titles wrap to two lines,
messages to three, with full title/accessibility text retained. Action icons
use SVG. Common system headings use concise sentence case without altering
references or customer-entered messages. Personal read/remove state, unread
counts, role visibility and destination handling remain in the existing owner.

All Notifications keeps its full-height, flush-right drawer and full-page
backdrop. Clicking that backdrop now closes the drawer on all portal pages,
restoring scroll and focus. A drawer made inert by a nested popup cannot be
dismissed by clicking its backdrop beneath that popup. The close button and
Escape continue to work. General confirmation popups retain explicit actions.

## Verification

```powershell
node --check admin-page/appointments.js
node --check admin-page/appointment-details.js
node --check admin-page/admin-common.js
node --check admin-page/portal-detail-dialog.js
node --test backend/tests/Frontend/appointment-dialogs.browser.cjs
node --test backend/tests/Frontend/notification-layout.browser.cjs
node --test backend/tests/Frontend/appointment-team-workflow.browser.cjs
node --test backend/tests/Frontend/appointment-archive.browser.cjs
node --test backend/tests/Frontend/appointments.browser.cjs
node --test backend/tests/Frontend/appointment-products.browser.cjs
node --test backend/tests/Frontend/appointment-conversation-stability.browser.cjs
node --test backend/tests/Frontend/multiple-admins.browser.cjs
node --test backend/tests/Frontend/products-dialogs.browser.cjs
node --test backend/tests/Frontend/promotions-dialogs.browser.cjs
git diff --check
```

The browser suites use isolated authenticated API fixtures, including failed
and held writes. New coverage includes both roles at 320/390/768/1024/1440px,
dark/light themes, short landscape, an equivalent 200% zoom viewport, keyboard,
long/plain-text details, department/PR separation, meeting confirmation,
calendar unchanged/reverted edits, dates/notes/day slots, nested picker,
failed-save recovery, pending guards, discard, consultation and archive.
Notification checks run on Dashboard, Promotions and Appointments in both
roles and test readable text width, actions, personal read state and actual
outside clicks. Screenshot directories are printed by the suites.

Existing custom-product tests retain the quotation/attendance gates,
conversation drafts/scroll positions and Customer booking checks. Receipt
layout assertions now measure visible fields, excluding existing conditional
university/PR rows when those rows are hidden. The Customer receipt workflow
and application markup are unchanged.

## Delivery

Release the matching Appointment shells, new scoped stylesheet, Appointment
renderer, shared meeting editor, common helper, shared modal stylesheet and
controller together via **commit → push → online deployment**. Their changed
asset references use **2026.1114.7**. Promotions shells include the heading class;
other page shells contain cache-version changes only.

No ZIP upload, migration or Composer install is needed. Compare public hosted
assets and opt-ins to the commit after deployment. Treat this separately from
authenticated hosted dialog/save verification; local fixtures and matching
public files do not establish live private workflow behavior. Do not use real
customer records for destructive deployment tests.
