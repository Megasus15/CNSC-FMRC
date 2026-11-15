# Admin Email Templates refinement

The existing Admin-only Email Templates page adopts the Inventory design through
`data-portal-email-dialogs`, `data-portal-popups="refined"` and the Email Templates
popup context. No Staff editor or permissions are added.

`website-emails-ui.css` scopes the presentation to this page: cream 12px cards,
maroon icon tiles and headings, semibold labels, balanced fields, a search icon
with the compact Search placeholder, readable helper text and themed colors.
Template selection, tokens, color controls and swatches have 44px touch targets.
The existing two-pane layout stacks on smaller screens. Refresh aligns right;
the existing docked save bar retains Restore Default and Save All Changes.

Save, Restore Default, unsaved-change/discard, error, logout and session popups
reuse their existing shared helpers. Compact popups have no X, red accent line
or horizontal message rules. Background scroll locking, focus containment,
cancel, Escape and restoration remain owned by the shared controller. Success
notifications retain their original X, automatic dismissal and callbacks.
Error feedback is explicitly classified as an error.

All field IDs, limits, input values and preview sandboxing remain intact. Labels,
defaults, tokens and template groups still come from the server registry. The
owner script only gains presentation/accessibility metadata and clearer Admin
access/search wording. Independent template drafts, original-wording restoration,
explicit multi-template saving, color normalization, preview ordering, retry
and realtime notices retain their behavior. No email is sent by previewing.

## Related settings presentation

- Shipping city options use a centered 14px SVG check inside the existing 18px
  selection box. Names, selection, keyboard behavior and coverage payloads are
  unchanged, including explicit province-wide coverage.
- Payment Methods removes the card outline and persistent pointer-focus ring
  from its switches. A visible switch focus ring remains for keyboard users.
  Compact tracks, 44px touch targets and checked values remain unchanged.
- Published policy document buttons align at the right of their subtitle row
  on desktop. Policy and Shipping approval labels stay left while publish
  actions align right, with the status hint directly beneath the button. Narrow
  layouts stack without clipping or changing approval/publication conditions.

## Verification and delivery

- Email browser fixtures cover 320, 390, 768, 1024 and 1440px in both themes;
  search, independent drafts, tokens, color/optional fields, sandboxed preview,
  failed-save retention, duplicate-save protection, readback, staged restoration,
  discard/cancel, delayed previews, focus restoration, short landscape and
  zoom-equivalent text spacing.
- Settings browser fixtures measure desktop/mobile action alignment and hints,
  exercise both payment switches with real pointer events, and verify keyboard
  focus remains visible in both themes. Existing policy, shipping and Payment
  Methods workflow tests retain save/readback, approval and failure coverage.
- Shared loading and Products regressions retain nested popup/notification,
  keyboard and scroll behavior. Maintenance is the unopted page used to check
  that unrelated popup presentation stays unchanged.
- EmailTemplateTest passes 16 tests and 677 assertions, including server
  rendering, override validation and Admin-only access. Browser mutations use
  local API fixtures. No live email, policy/rate publication or payment is sent.

Changed Email Templates, Shipping picker/style, Payment Methods style and Policy
style references use `2026.1115.6`. Shared modal/notification assets are reused
without modification. No backend change, migration or dependency is required.
Release by commit, push and the existing online deployment. Verify hosted assets
and read-only presentation separately from local fixture-based mutation checks.
