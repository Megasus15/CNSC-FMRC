# Shared My Account refinement

Admin and Staff My Account opt into the Inventory appearance using
`data-portal-account-ui`, `data-portal-popups="refined"` and the My Account popup
context. Both shells load `my-account-ui.css` and `my-account.js` with cache
version `2026.1115.11`. Styles are screen-only and scoped to these pages.

Account overview and Sign-in details use aligned, equal-height desktop cards
with roughly one-third/two-thirds widths, aligned icon headings, 12px frames,
balanced fields and consistent buttons. Below 1200px they stack without forcing
narrow form columns. The
recovery status, one-time reveal and pending Gmail verification retain their
existing IDs and visibility behavior, with theme-aware surfaces and readable
labels. Password toggles use centered 44px targets; labels are associated with
their inputs. Recovery print styling remains unchanged.

The Admin recovery form uses the shared full-modal frame, header X, fixed
header/footer, scrolling body and cool glass backdrop. Cancel, X and Escape
follow the same owner handler; backdrop clicks do not dismiss it. The shared
controller handles focus containment, inert background, scroll locking and
focus/position restoration through nested popups. During generation, close
actions and duplicate submission are blocked. Failed requests retain the form
and password for retry. Generation still requires the current password and
invalidates the previous set immediately, as enforced by the existing backend.

Account error messages use the existing global popup helper instead of native
alerts when that helper is available. Compact popups have no X; automatic success
notifications retain their original X. The existing pending-email informational
popup and callbacks are preserved.

Staff keeps its existing username, read-only full name and credential fields.
Recovery codes and pending Gmail verification remain Admin-only. No API,
permission, validation, credential payload, migration or dependency changes.
The authoritative reload, personal success message and stale-session response
checks remain intact.

Browser fixtures cover both roles at 320, 390, 768, 1024 and 1440px, light/dark
themes, keyboard close/focus return, a short landscape viewport, balanced desktop
card dimensions, form validation, failed-save retention, email verification,
password-only requests, nested errors and guarded recovery generation/reveal.
Existing account-security suites pass 29 tests and 849 assertions. All mutations
use isolated fixtures; hosted checks intercept all API requests and never alter
real credentials, send verification emails or regenerate production codes.

Release through commit, push and the existing online deployment; verify deployed
asset hashes and read-only presentation separately from local mutation tests.
