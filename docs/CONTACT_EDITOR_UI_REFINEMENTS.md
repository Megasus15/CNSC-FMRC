# Contact editor and consistent website fields

Admin and Staff Contact opt into the approved Inventory presentation through
`data-portal-contact-dialogs` and `data-portal-popups="refined"`. Both shells
reuse `website-home-ui.css` and add `website-contact-ui.js/.css` for section
icons, clearer card titles, associated field labels and balanced field pairs.
The Contact feature script, eleven settings keys, draft baseline, save request,
loading guards, readback and realtime notification remain unchanged.

Contact Information and Message Form use cream cards, maroon SVG icon tiles,
12px corners, shared borders, spacing and responsive controls. Email and phone
share a row; Facebook name and link share a row; longer map/heading fields span
the grid. Fields stack on phones. Existing save, discard, refresh, error,
notification and session popups reuse the shared presentation and guards.
Compact popups have no X; automatic success notifications retain the original X.
The cool blue-gray glass backdrop and background scroll/focus lock are reused.

Home, About, Services and Contact field labels now use 600 weight. Field values
are unchanged. The weight change is scoped to labels in the four opted-in
website editors.

## Vision/Mission galleries

Photo slots share the Home SDG grid, metadata row, balanced card heights, title
spacing and 44px outlined icon controls. They keep 16:10 rectangular thumbnails
and photo fitting. Five existing actions use a centered three-plus-two layout;
no extra action, stored title or caption is introduced. The first photo has a
small First marker. Empty and populated slots align across responsive columns.
All existing IDs, file inputs, action handlers, ten-photo limit, draft behavior,
crop geometry and 1000x625 export remain intact.

## Verification and release

`website-contact-ui.browser.cjs` checks both roles at 320, 390, 768, 1024 and
1440px in both themes, label association/weight, balanced fields and compact
toolbar/popups. It covers unchanged/reverted Save state, confirmation cancel,
refresh discard protection, failed-save retention, duplicate-save protection,
unchanged payload fields and readback. Shared editor suites check semibold
labels, hover outlines, SDG/gallery geometry, gallery ordering/removal, fitting
exports, staged publishing and failure recovery. Products uses the unopted
Payment Methods editor to keep its presentation-boundary regression check.

Release matching shells, shared stylesheet/gallery script and Contact adapter
through commit, push and the existing online deployment. All changed asset
references use 2026.1114.16. No endpoint, migration or new dependency is needed.
Hosted source parity is checked separately from local fixture-based workflows;
no production content is altered during verification.
