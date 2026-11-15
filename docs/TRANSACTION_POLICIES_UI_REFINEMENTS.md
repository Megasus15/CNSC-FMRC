# Transaction Policies and related editor refinements

Admin Transaction Policies opts into the approved Inventory cards and compact
popups through `data-portal-policy-dialogs`, `data-portal-popups="refined"` and
the Transaction Policies popup context. Cream cards have 12px corners, maroon
icon headings, neutral dividers, semibold field labels, readable previews and
44px controls. Confirmation popups retain their existing callbacks and have no
X or red accent line; success notifications keep the original X and timing.

`website-policies-ui.css` and `website-policies-ui.js` are presentation only.
They decorate the existing published, draft, preview and approval controls
without replacing fields. Policy wording, limits, validation, revision checks,
private drafts, explicit approval and publication are unchanged. Failed saves
retain the draft. Published links keep their version query. Staff retains the
existing published-only page and is not opted into the Admin editor.

## Payment Methods loading

The shared loader has a Payment Methods-only renderer. It measures each actual
card, icon, button, rendered text line and switch track instead of placing a
large skeleton bar over a complete payment label. Wrapped copy, responsive
columns and late font loading are measured again. Larger switch touch targets
remain intact; their skeletons follow the 46px by 26px visible tracks.

The loader's request transformation, deadlines, pending counter, retry behavior
and other pages' skeleton renderer remain unchanged. The shared dialog helper
now exposes background inert-state access for loaders: completing a load while
an error popup is open updates the state restored after that popup closes. The
background remains unavailable while the popup is open and becomes usable
after acknowledgement and Retry, including the save bar. Existing popup and
modal close handlers, focus restoration and scroll locking remain authoritative.

## Province-linked cities and municipalities

The Admin Shipping editor loads `shipping-city-picker.js` before its existing
owner script. Cities / municipalities is a required searchable multiselect
linked to Province, using the existing
`GET /api/psgc/provinces/{code}/cities-municipalities` endpoint and server cache.
No list of real place names is embedded in the application.

The explicit **All cities and municipalities** choice preserves province-wide
coverage as the existing `cities: []` payload. Saved empty arrays display that
choice. Named selections remain arrays; names containing commas are preserved.
Changing Province clears the previous locations and requires a new explicit
choice. Search text alone does not edit the draft. Pending choices block saving
and publication, remain discardable and are included in the existing unsaved
changes guard. Published coverage stays unchanged until normal approval and
publication.

Locations are cached per Province for the page session. Loading and malformed
or failed responses have inline guidance and Retry without clearing form data.
Named selections require the corresponding list to load successfully. Explicit
province-wide coverage remains available if the city lookup fails. Late
responses for another Province cannot replace the current choices. Names and
selected chips render as plain text. Arrow keys, Enter, Escape and Tab work
within the labelled combobox; selected-chip remove controls are at least 44px.

## Verification and release

- Browser checks cover 320, 390, 768, 1024 and 1440px in both themes for policy
  cards/popups, Payment Methods skeleton geometry and city selection.
- Policy fixture checks cover save/cancel, failed-save retention, duplicate
  submission, safe text, approval, publication, versioned links and Staff readback.
- City fixture checks cover province-wide and multiple named choices, required
  reset, discard, direct form submission, API save/readback, lookup retry,
  delayed responses, keyboard use, cache reuse, safe names and responsive chips.
- Existing shipping/checkout browser checks retain draft publication, Staff
  access, accepted quote totals and courier handover safeguards. Existing shared
  loading tests cover all Website Management editors and timeout/Retry recovery.
- Existing backend CommercePolicyTest and ShippingQuotesTest pass 23 tests and
  242 assertions using isolated data. Browser writes use local API fixtures.

Changed policy, city-picker, shipping-owner/style, loader and shared-dialog
script consumers use `2026.1115.4`. All 43 shared-dialog script consumers and
all shared-loader consumers receive matching cache versions. Other dialog
presentation remains opt-in. No backend change, migration or dependency is
required. Release through commit, push and online deployment, then verify hosted
assets and read-only presentation separately. No live policy/rate publication,
payment, shipment or tracking activation is part of verification.
