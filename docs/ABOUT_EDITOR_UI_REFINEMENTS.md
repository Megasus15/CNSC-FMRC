# About Us editor and shared glass backdrop

Both About Us portal shells opt in with `data-portal-about-dialogs` and
`data-portal-popups="refined"`. They reuse `website-home-ui.js/.css` and add
`website-about-ui.css`. The profile/video, FMRC Vision, FMRC Mission and editable
section-text cards share cream surfaces, maroon icon tiles, readable labels,
balanced image actions and consistent controls. Gallery actions have explicit
accessible names; their slots retain the existing order, ten-photo limit and
16:10 fitting/export behavior.

The shared image fitter retains its feature owner, IDs, geometry and canvas
calculations. It uses the 800px, 12px-corner full-dialog frame with a fixed header
and footer and a scrolling body. Fit/fill controls live inside the body, leaving
Cancel and Apply in the footer. Close/Escape preserve the current cancel behavior,
page position and focus return. Confirmations/errors use the compact no-X popup;
success notifications keep their original X and automatic timing.

Existing text limits, video upload/retry/cancel, six editable university fields,
draft protection, explicit Save All Changes, failure recovery and readback remain
owned by the existing feature script. No content is seeded or published by this
presentation update. Customer About Us markup/styles and other customer pages
are unchanged.

Home SDG slots now have a compact 64px thumbnail, natural card height, and six
equal 44px icon controls in a three-by-two grid. Tooltips and accessible names
identify each action and badge. Empty slots do not stretch to match populated
ones. The existing ordering, edit, replacement, fitting and removal handlers are
unchanged.

All adopted portal overlays, including shared notifications/media/session
dialogs and native Orders dialogs, use `rgba(17,24,39,.5)` with a 3px blur. The
shared stylesheet overrides dark-mode scrims and makes internal backdrop layers
transparent to avoid applying the tint twice. Non-adopted dialog presentation
is unchanged. Cache references to the shared stylesheet are updated across all
Admin/Staff consumers.

## Verification and release

`website-about-ui.browser.cjs` checks both roles at 320, 390, 768, 1024 and 1440px,
light/dark themes, short landscape, zoom-equivalent viewport/text spacing,
body-only scrolling, focus restoration, cancel/apply, gallery and fallback image
exports, no-X confirmation, failed saves and explicit save/readback.
`website-home-ui.browser.cjs` covers compact SDG controls and the existing Home
draft/image flows. Products/Orders dialog suites assert the cool glass backdrop
through both regular overlays and native dialogs. Existing university-content,
draft and video tests cover content and persistence regressions.

Release source shells, scripts and styles together using commit, push and the
existing online deployment. No database migration, backend API change or new
dependency is needed. Check hosted asset hashes separately from local browser
fixture tests; fixtures do not represent authenticated production mutations.
