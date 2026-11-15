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
header and fixed save bar are measured. On fitting desktop layouts above 1100px,
the full card remains sticky. Its miniature portal scales proportionally when
needed; the guidance below it retains normal text size and remains visible.
There is no inner scrollbar or capped content area. Very short screens or long
copy that would require excessive shrinking use full-size page flow instead of
clipping. Stacked phone/tablet layouts also retain normal page scrolling.

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
links use a light maroon surface. Logout matches the sidebar's darker hover,
and both stay stationary when pressed. Keyboard focus indicators, outside dismissal and logout confirmation
remain available.

## Verification

- Existing frontend appearance, draft and personal-preference tests.
- Existing backend `PortalAppearanceSettingsTest`, including Admin save/readback,
  matching limits and Staff/Customer restrictions: 28 tests, 199 assertions.
- `website-portals-ui.browser.cjs`: 320, 390, 768, 1024 and 1440px, both themes,
  short landscape, zoom-equivalent width, text spacing, sticky geometry at
  1140px through 1920px desktop widths and 650/760/768/784px screen heights,
  complete bottom guidance, no inner scrolling, very-short-screen fallback and save
  bar clearance; tab keyboard access, safe/multiline copy, upload/default staging,
  failed saves, duplicate submission, readback, realtime draft retention and
  discard confirmation/focus restoration.
- `portal-profile.browser.cjs`: shared assets in all 43 authenticated shells;
  both roles, sidebar icon parity, stationary hover/pressed controls, five
  widths, both themes, long identities, keyboard, notifications and logout.
- Existing Products dialog regression covers nested confirmations, media,
  notifications, session guards and an unopted page.

The editor assets and shared stylesheet now use `2026.1115.3`; the unchanged
shared profile script retains `2026.1115.1`. All 43 consumers
of the changed shared assets receive matching cache versions. Delivery uses
commit, push and the existing online deployment, followed by hosted file
comparison. Local API-fixture tests are distinct from hosted asset verification;
no live appearance save is performed. No API change, migration or dependency is
required.
