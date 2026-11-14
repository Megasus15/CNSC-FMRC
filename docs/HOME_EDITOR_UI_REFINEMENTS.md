# Home editor presentation refinement

Admin and Staff Home opt into the Inventory dialog presentation through
`website-home-ui.js` and `website-home-ui.css`. Existing feature owners keep the
same form nodes, IDs, image calculations, settings keys, request payloads and
draft handlers. About and Services editors retain their existing presentation.

Hero, 3D Fabrication Scene, Brand Logos, Sustainable Development Goals, What We
Offer and Home Section Text share cream cards, maroon SVG icon tiles, neutral
borders, portal typography, 44px controls and responsive field spacing. Logo
slots use balanced columns and service-card Edit/Delete actions align right.
The customer artwork, logos, scene settings, caption, content and published
service descriptions are not replaced or seeded by this refinement.

Image fitting, SDG Add/Edit and Service Add/Edit adopt the shared fixed header,
scrollable body and fixed footer. Full dialogs keep an accessible X; shared
confirmation/removal/error popups use the compact no-X presentation. Success
notifications retain their original X and timing. Close/Escape call the existing
owner, including unapplied-change confirmation. Crop opens above its parent SDG
dialog and keeps background scroll locked through nested confirmations. Image
holders and canvas export sizes retain their existing dimensions and behavior.

The Walk-in Sales header places the status filter, search and Add action in that
order, with Add at the right edge. On phones, search and Add share a row below
the status filter. Online Refunds keeps its search/status filtering and removes
the Clear filters button and its unused handler.

## Verification and release

`website-home-ui.browser.cjs` covers both roles at 320, 390, 768, 1024 and 1440px,
dark mode, short landscape, section icons, service-footer alignment, full-dialog
geometry, staged service/SDG edits and removals, nested SDG fitting, Escape/focus,
256px SDG and 512px logo export, failed-save retention and explicit save/readback.
`orders-toolbar-followup.browser.cjs` covers both portal header layouts and refund
filter query preservation. Existing Home/About/Services draft, scene editor,
Orders filter and editor-refresh suites guard shared behavior.

Backend regression coverage includes WebsitePageSaveTest,
WebsiteContentValidationTest, SiteSettingsVideoTest, SiteSettingsVideoUploadTest
and AdminSpectatorTest. Release the matching shells/scripts/styles via the
existing commit, push and online deployment. No API, migration or dependency
change is required; verify hosted asset parity separately from local fixtures.
