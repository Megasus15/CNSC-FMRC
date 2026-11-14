# Services editor presentation

Admin and Staff Website Services opt in through `data-portal-services-dialogs`
and `data-portal-popups="refined"`. They reuse `website-home-ui.css`, the shared
Inventory dialog controller and popup helper, plus `website-services-ui.js/.css`
for Services-specific sections. Other website editors retain their current
presentation.

Page Content, Service Categories and Service Cards use cream surfaces, maroon
icon headings, neutral borders, balanced fields and the portal font. Service
card Edit/Delete actions align right. Add/Edit keeps the existing fields,
image preparation, feature chips, limits, custom-request checkbox and handlers.
The full dialog uses the 800px frame, 12px corners, fixed header/footer and one
scrolling body, with background locking and focus restoration. Its X and Escape
route through the existing discard guard. Delete Service, Delete Category,
discard, save and error popups use the compact no-X presentation; success
notifications retain their original X and automatic timing. The cool glass
backdrop is unchanged.

There was no separate image-adjustment dialog in Website Services. Its existing
upload and full-image preview remain intact. This refinement adds no new image
processing or publishing step.

Services, categories and page copy still publish only through Save All Changes.
Failed saves retain drafts. No endpoint, schema, permissions or business rule
changes are required, and customer-facing pages are unchanged.

## Home/About follow-up

Home SDG slots use consistent metadata, 64px artwork, two-line title space and
two rows of equal controls. Filled and empty slots share balanced heights; a
Hidden label sits beside the slot number so it cannot displace the controls.
Long titles retain full tooltips and accessible names. Home/About/Services
outlined buttons retain their accent border and a subtle tinted hover surface,
including overrides for legacy dark-mode filled hover rules.

## Validation and release

`website-services-ui.browser.cjs` exercises both portals at 320, 390, 768, 1024
and 1440px, both themes, short landscape and zoom-equivalent text spacing. It
checks card alignment, outlined hover, fixed dialog geometry, unchanged-edit
disabling, focus restoration, nested discard confirmation, readable/unreadable
image uploads, feature chips, category/service removal, failed-save recovery
and explicit publishing/readback. Existing Home/About suites check SDG card
geometry and image/save regressions; `website-editor-outlines.browser.cjs`
checks Home/About hover styles in both roles/themes. Products keeps an
unopted Contact editor regression check. Shared page-draft and backend content
tests cover persistence.

Update all consumers of the changed shared editor assets, commit and push using
the existing online deployment, then compare hosted assets separately from local
fixture tests. No migration or new dependency is needed.
