# Footer editor and shared account dropdown

Admin and Staff Footer opt into the Inventory presentation using
`data-portal-footer-dialogs` and `data-portal-popups="refined"`. They reuse the
shared website editor stylesheet and add `website-footer-ui.js/.css`. Six
section cards have maroon SVG icon headings, cream surfaces, 12px corners,
semibold labels and responsive spacing. Contact field pairs are balanced;
long map/copyright fields span the grid. Quick Links has visible, associated
Label/URL fields and 44px outlined add/remove controls that retain their accent
on hover in both themes. Values are assigned through DOM properties so quotes
and markup-like text remain input text.

All Footer keys, legacy aliases, explicit Save All Changes, quick-link order,
pending-save guard, discard confirmation, failure retention, readback and
realtime broadcast remain intact. Remove Quick Link and Save All Changes use
the shared compact no-X popup. Success feedback keeps the existing X and timing.
No footer content is published during implementation or verification.

## Shared profile menu

The existing `admin-common.js` account handler now creates one native avatar
button while retaining the header role label and the existing popup/link/logout
nodes. `portal-detail-dialog.css` supplies the shared dropdown styling across
all authenticated Admin/Staff pages. No per-page copy of the dropdown logic or
new dependency is introduced.

The dropdown has a cream surface, neutral border, 12px corners, restrained
shadow, maroon avatar tile, clear role badge and consistent navigation icons.
Settings reuses the exact gear classes from the sidebar. The full authenticated
email wraps instead of truncating. The same live identity painter
and stale-token response guard are retained; settings/credentials are not copied.
My Account, Settings and logout requests keep their existing destinations and
authorization.

The popup is positioned within the viewport and can scroll on short screens.
It remains a non-modal dropdown. The native button supplies Enter/Space access;
Arrow Down opens and focuses the first link; Escape returns focus to the avatar.
Closed content is inert and hidden from assistive technology. Outside click/focus
and notification switching close it. Logout keeps its existing confirmation;
cancellation returns focus to the avatar. Reduced-motion and both themes are
supported.

## Validation and delivery

`website-footer-ui.browser.cjs` exercises both roles at 320, 390, 768, 1024 and
1440px, both themes, labels/layout, add/remove/cancel, safely retained link text,
failed saves, duplicate-save protection and persistence/readback.
`portal-profile.browser.cjs` audits the shared assets in every profile shell,
checks all five widths, both themes, short landscape/text spacing, long emails,
keyboard/focus, notification switching, current-account repaint and logout
cancellation. Operational and account pages exercise the same handler. Shared
theme/preferences and Products dialog tests cover broader regressions.

Changed shared stylesheet/script references and Footer/editor assets use
2026.1114.17. Commit, push and verify the existing online deployment; compare
hosted sources separately from local fixtures. No endpoint, database migration,
permission change or Composer dependency is required.
