# Customer Inquiries and shared feedback refinement

Admin and Staff Customer Inquiries use the approved Inventory dialog frame:
cream surface, maroon icon, 12px corners, fixed header/footer and one scrollable
body. Names, email and messages retain plain-text rendering and wrapping. Existing
read, resolve, single/bulk deletion, filters, pagination, role checks and live
refresh continue using their existing endpoints. Resolve/delete/error and shared
confirmation popups opt into the compact no-X presentation. There is no separate
order-rejection workflow on Customer Inquiries.

The four summary cards share theme-aware icon tiles and typography. The status
filter and compact icon search align to the table header's right edge. Resolution
failures leave details open with error feedback; a pending resolution cannot be
closed or submitted again from the detail dialog. Only a successful save closes
the detail dialog and displays success.

## Orders follow-up

Orders checkbox labels use an 18px checkbox aligned to the first line of text.
The sizing overrides only checkboxes, leaving ordinary fields unchanged. The
Orders body scrollbar and cancellation-notice border are neutral. Retry refund
uses a concise amount-specific explanation, retains the provider verification,
wallet funding and QR Ph claim instructions, and preserves Admin issuance versus
Staff request actions. No payment/refund API or eligibility rule changes.

## Shared success notifications

The latest user preference supersedes the earlier Dismiss-button design.
All Admin/Staff success notifications retain the original accessible SVG X.
The existing automatic progress animation, 3-second lifetime, callbacks and
manual close behavior remain unchanged. Full modals retain their header X;
compact confirmation/error popups retain the no-X design. Shared notification
dropdowns and All Notifications data/interaction remain unchanged.

## Verification and deployment

`inquiries-ui.browser.cjs` exercises both roles at 320, 390, 768, 1024 and 1440px,
light/dark themes, short landscape, long safe text, keyboard/focus restoration,
nested resolve/error popups, read state, deletion, filters and failed saves.
`portal-success-orders-touchups.browser.cjs` verifies success X controls on refined
and unrefined pages, automatic dismissal/callbacks, all portal cache references,
checkbox geometry, neutral accents and read-only refund-retry previews.
Existing Products dialogs, Orders refresh and refund-restriction suites provide
cross-page regression coverage. Backend regressions cover bulk inquiry actions,
spectator permissions, operator notifications, payments, refunds and tracking.

Release through commit, push and the existing online deployment. Updated Admin
and Staff shells carry matching shared script/style cache versions. No migration,
API, package or Composer change is required. Verify hosted assets separately from
local fixtures; preview checks never submit a live payment or refund.
