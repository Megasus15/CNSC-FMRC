# Payment Methods and shared control refinements

The existing Admin-only Payment Methods page opts into the approved Inventory
popup presentation through `data-portal-popups="refined"`. The page-specific
`website-payments-ui.css` adds cream surfaces, 12px corners, maroon icon headings,
balanced payment cards, semibold labels, neutral dividers and 44px controls.
Cash on pickup and QR Ph remain the two current checkout choices. The actual
QR Ph logo, readiness status and checkout-scope descriptions are retained.

Payment controls keep their existing IDs and settings bindings. Their compact
switch track is drawn within a larger transparent touch target in both themes.
The fixed save bar sits outside the content card, retains its explicit form
association, and no longer leaves an empty footer-sized area inside the card.
Discard/logout confirmations and other existing helper popups use the compact
no-X design and cool glass backdrop. Success notifications keep their original
X and automatic dismissal. No new confirmation step is added to saving.

`website-payments.js`, backend permissions and payment rules are unchanged.
Save All Changes still explicitly publishes the selected methods; enabling,
disabling, resetting a draft or cancelling a confirmation does not publish.
Failed saves retain selections, pending saves block duplicate submissions,
cross-tab updates retain drafts, and legacy courier cash collection remains
disabled. No real payment or live settings write is part of verification.

The shared profile stylesheet now gives My Account, Settings and Logout the
same light maroon hover in both themes. Sidebar Logout no longer scales when
pressed, across all 43 authenticated Admin/Staff page shells. Existing sidebar
hover colors, destinations, account identities and logout confirmation remain
unchanged. The shared stylesheet's cache version is `2026.1115.2`; the unchanged
`admin-common.js` remains `2026.1115.1`.

Login Portals' earlier preview-height gate could disable sticking on ordinary
laptop screens. Its card now stays sticky on two-column layouts above 1100px,
uses the measured header/save-bar boundaries, and scrolls its inner preview
when necessary. The heading stays visible, and the scroll region is keyboard
focusable when it overflows. Phone/tablet stacked layouts retain full page flow.
Appearance fields, upload processing, live preview bindings and saves are
unchanged. Both Login Portals UI asset versions are `2026.1115.2`.

## Verification and delivery

- Frontend payment preferences, portal appearance/drafts and personal preferences:
  39 unit tests.
- Existing backend PaymentMethodAvailabilityTest and PortalAppearanceSettingsTest:
  55 tests, 351 assertions, including Admin save/readback and Staff restrictions.
- Payment Methods browser checks at 320, 390, 768, 1024 and 1440px in both themes;
  keyboard switches, compact touch targets, QR Ph ready/unavailable, bulk drafts,
  no-X discard/cancel/focus, failed saves, duplicate saves, readback, success X,
  short landscape and zoom-equivalent/text-spacing checks.
- Shared profile checks audit all 43 shells and exercise both roles, exact
  sidebar icon reuse, light maroon hover, stationary sidebar/profile controls,
  keyboard, long identities, notifications and logout cancellation.
- Login Portals checks cover sticky geometry and reachable preview content on
  1140px/1366px desktop widths, including 450/650/768px screen heights, alongside
  existing responsive, draft, upload, save and discard coverage.
- Products' existing dialog, media, notifications and session regression checks
  retain an unopted Shipping page to check that other popup designs stay intact.

Release through commit, push and the existing online deployment. Compare changed
hosted assets separately from local API-fixture tests. No backend change,
database migration or dependency is needed.
