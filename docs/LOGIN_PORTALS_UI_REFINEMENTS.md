# Login Portals editor and shared profile controls

The existing Admin-only Login Portals editor opts into the Inventory popup
presentation through `data-portal-popups="refined"` and the Login Portals
context. No Staff editor or new permission is introduced. Existing server
restrictions on Staff, Customer and unauthenticated updates remain intact.

`website-portals-ui.css` supplies cream cards, 12px corners, maroon icon
headings, semibold labels, balanced field pairs, theme colors and 44px controls.
Layout, Image and message, Brand identity and Live preview keep their original
IDs and appearance bindings. Uploads, image focus and overlay adjustments stay
inline; there was no separate image-adjust dialog to replace. Confirmation
popups use the shared compact frame, cool glass backdrop and no header X.
Success notifications retain their original X and timing.

`website-portals-ui.js` only measures presentation. On desktop, the preview
scrolls naturally until it reaches the space below the fixed header, then
sticks beside the settings. The page-specific shell override removes the
ancestor scroll container that otherwise prevents viewport stickiness. The
header and fixed save bar are measured. Desktop layouts above 1100px remain
sticky even on short screens. The card's header stays visible, while an inner
preview region scrolls when its contents exceed the available height; that
region becomes keyboard-focusable only when scrolling is needed. Stacked
phone/tablet layouts retain normal page scrolling with the full preview visible.

The appearance feature script, setting keys, API requests and image processing
are unchanged. Customer and Admin/Staff portal drafts remain independent, both
dirty portals save together, and only changed keys are submitted. Tab changes,
failed saves, default-image staging, refresh/discard guards and realtime notices
retain their existing behavior. Implementation and verification do not publish
any sample portal content.

The shared `admin-common.js` profile handler now copies My Account, Settings and
Logout icon classes from each page's sidebar. Existing account/link/logout nodes,
identity painting and stale-session checks remain in place. Shared profile CSS
removes pressed scaling, opening movement and control animations. Navigation
hover and Logout now use the same light maroon surface. Sidebar Logout also
suppresses its previous pressed scaling. Keyboard focus indicators, outside dismissal and logout confirmation
remain available.

## Verification

- Existing frontend appearance, draft and personal-preference tests.
- Existing backend `PortalAppearanceSettingsTest`, including Admin save/readback,
  matching limits and Staff/Customer restrictions: 28 tests, 199 assertions.
- `website-portals-ui.browser.cjs`: 320, 390, 768, 1024 and 1440px, both themes,
  short landscape, zoom-equivalent width, text spacing, sticky geometry at
  1140px/1366px desktop widths and 450/650/768px screen heights, and save
  bar clearance; tab keyboard access, safe/multiline copy, upload/default staging,
  failed saves, duplicate submission, readback, realtime draft retention and
  discard confirmation/focus restoration.
- `portal-profile.browser.cjs`: shared assets in all 43 authenticated shells;
  both roles, sidebar icon parity, stationary hover/pressed controls, five
  widths, both themes, long identities, keyboard, notifications and logout.
- Existing Products dialog regression covers nested confirmations, media,
  notifications, session guards and an unopted page.

The editor assets and shared stylesheet now use `2026.1115.2`; the unchanged
shared profile script retains `2026.1115.1`. All 43 consumers
of the changed shared assets receive matching cache versions. Delivery uses
commit, push and the existing online deployment, followed by hosted file
comparison. Local API-fixture tests are distinct from hosted asset verification;
no live appearance save is performed. No API change, migration or dependency is
required.
