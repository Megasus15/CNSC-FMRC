# Shared Admin and Staff Archives refinement

Both Archives shells opt into the approved Inventory design through
`data-portal-archive-dialogs`, `data-portal-popups="refined"` and the Archives
popup context. The shared `archives-ui.css` and `archives-ui.js` scope this
presentation without restyling other pages.

Cards use cream surfaces, 12px corners, maroon icon headings, neutral category
badges and consistent controls. Existing operational status-pill meanings stay
intact. Tabs and action controls use comfortable touch targets, stationary
pressed states, matching theme colors and visible keyboard focus.

The existing search input moves into the active table's header, aligned to the
right edge. Its ID, input listener, query and cross-tab filtering stay intact;
there are no cloned or competing search fields. The helper moves each existing
category icon into its heading tile instead of adding a duplicate.

## Dialogs

- Auto-Delete Settings uses the shared 800px full-modal frame, header X, fixed
  header/footer and scrollable body. The existing 30/60/90-day radio choices,
  personal preference and immediate cleanup request remain authoritative.
- Permanent deletion uses a compact no-X popup with Cancel and Delete
  Permanently. Existing target-label and action IDs are retained. Restore and
  bulk-action confirmations/errors use the existing shared popup helper.
- Cancellation record details use the same full-modal frame with an X and
  footer Close. Its read-only fields and safe text rendering remain unchanged.
- Background scroll/focus handling, keyboard containment, inertness and focus
  restoration use the existing shared controller. Pending save/delete requests
  block duplicate submission and closing; failed requests retain their dialog
  and selection for retry. Rejected retention requests display an error and do
  not overwrite the personal preference before success.
- Success notifications keep the original X and automatic dismissal. Compact
  popups have no X or horizontal message rules; the cool glass backdrop and
  reduced-motion behavior are reused.

No retention periods, eligibility checks, permissions, archive payload fields,
endpoints or financial-record safeguards change. Online refunds and cancellation
history retain restore-only behavior and remain excluded from automatic cleanup.
The existing on-load cleanup request is preserved, including its spectator guard.
No new API, migration or dependency is required.

## Verification and delivery

Browser fixtures cover both roles at 320, 390, 768, 1024 and 1440px in light/dark
themes, short landscape and a zoom-equivalent viewport with adjusted text
spacing. Checks include all ten tabs' header search, shared query, pagination,
inventory variants, full/compact dialogs, Escape, focus return, pending close
guards, failed save/delete recovery, single restore/delete, bulk delete/cancel,
retention readback and safely rendered cancellation history.

Existing archive backend suites pass 49 tests and 406 assertions, including
financial-history and role restrictions. Products' existing shared-dialog
regression retains Dashboard as an unopted page. Local browser mutations use
isolated API fixtures. Hosted checks block real restore/delete and cleanup
requests; no production records are changed during verification.

Archives scripts use cache version `2026.1115.9`; both shells load the corrected
search alignment stylesheet as `2026.1115.10`. Search icons use a centered 18px
container and reset the legacy independent translation to avoid a double shift.
Release by commit, push and the existing online deployment, then compare hosted
assets and read-only presentation separately from local mutation tests.
