# Personal Settings and shared navigation refinement

Admin and Staff Settings opt into the approved Inventory appearance using
`data-portal-settings-ui`, `data-portal-popups="refined"` and the Settings popup
context. `settings-ui.css?v=2026.1115.12` scopes the cream cards, 12px corners,
maroon icon headings, readable labels, theme-aware controls and touch targets.
No settings fields or preference defaults are added or removed.

The existing native sidebar-logo dialog adopts the shared full-modal frame:
800px maximum width, fixed header/footer, an independently scrolling body,
header X and cool glass backdrop. The shared controller manages keyboard focus,
inert background, scroll locking and restoration. X, Cancel and Escape use the
existing close handler. Existing canvas positioning, image validation, zoom,
rotation, fit, account ownership and Use logo behavior are retained. The
existing immediate reset and default-branding actions remain immediate; this
refinement adds no confirmation steps.

Personal preferences still save automatically through the existing client and
API. Offline feedback, retry, account isolation, cross-tab synchronization,
theme selection, compact tables, reduced motion and sidebar-width behavior stay
unchanged. Compact popups use the shared no-X presentation; automatic success
notifications retain their original X.

`portal-sidebar.css?v=1.4` is loaded by all 43 authenticated Admin/Staff shells.
Navigation uses moderately smaller 13px desktop labels, 16px icons and reduced
vertical gaps. Phone labels remain 14px, and all navigation targets stay at
least 44px high. Logout receives matching compact typography. Logo and brand
title dimensions, sidebar width preferences, rail mode, resizing, collapse,
submenus and role-specific links remain unchanged. Other page shells change
only this shared stylesheet's cache version.

My Account loads `my-account-ui.css?v=2026.1115.12`. Both roles display the
capitalized Account Overview heading. Admin Gmail and Role tiles use natural
content height while the two outer cards still stretch to equal height. Refresh
keeps its maroon text, icon and outline on hover in both themes, fixing the
legacy white-text hover rule.

## Validation and release

Local browser fixtures cover Admin/Staff at 320, 390, 768, 1024 and 1440px in
light/dark themes, plus short landscape. Checks include upload/cancel/apply,
canvas keyboard positioning, fit/zoom/rotation, native Escape, body-only scroll,
background inertness and exact page-position restoration; automatic preference
save/failure/defaults; sidebar rail/width controls; compact navigation on
operational and configuration pages; account-card alignment and compact tiles;
and Refresh hover text/icon/outline visibility. The existing My Account and
shared profile-menu browser regressions also pass.

Existing preference client tests pass all 12 tests. Backend personal-preference
and appearance suites pass 38 tests and 269 assertions. Browser mutations use
isolated fixtures. Hosted verification intercepts every API request, blocks
real preference/account writes and uses sample identities.

No backend, permission, API, database migration or dependency change is needed.
Release through commit, push and the existing online deployment, then compare
the changed hosted assets and verify read-only presentation separately.
