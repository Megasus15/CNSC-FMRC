# Admin Maintenance and sticky Email Templates

Maintenance adopts the approved Inventory presentation through
`data-portal-maintenance-dialogs`, `data-portal-popups="refined"` and the
Maintenance popup context. The scoped stylesheet adds cream 12px cards, maroon
icon headings, semibold labels, balanced message fields, neutral dividers and
44px controls. Existing online, maintenance and fault status meanings remain.
The viewport size label now uses the correct multiplication symbol.

Activation, discard/refresh, validation, error, informational, logout and session
popups reuse the shared compact no-X design and cool glass backdrop. Success
notifications retain their original X and timing. No new confirmation step is
introduced. The owner's pending-save inert lock coordinates with the existing
shared dialog controller, so save errors keep the background unavailable until
acknowledged and restore editing afterward.

All 13 scope keys, switches, messages, character limits, image controls, themes,
preview bindings, explicit save behavior, Admin-only permissions and realtime
signals remain intact. Newly enabled maintenance still requires the existing
activation confirmation. Turning maintenance off retains its existing direct
save. Preview and restore operations remain drafts until Save All Changes.
No API, backend, database migration or dependency changes are required.

## Email Templates list

The Templates card sticks 16px below the fixed header in the desktop two-column
layout once it reaches that position. Its heading and search stay visible while
the template entries scroll inside the remaining space above the save bar.
The page owns scrolling; an overflowing shell ancestor no longer prevents
sticky positioning. Header and save-bar measurements update on resize/font
changes without fetching data or replacing form controls.

At stacked widths (1100px and below), or when a very short screen cannot fit
the card comfortably, normal page flow preserves access to all content. Template
selection, filtering, previews, independent drafts, save/restore and discard
guards retain their behavior.

## Verification and release

- Maintenance browser fixtures cover 320, 390, 768, 1024 and 1440px in both
  themes, plus short landscape, adjusted text spacing and a zoom-equivalent
  viewport. Checks include saved/draft status, activation cancellation, failed
  save retention, duplicate saves, readback, direct deactivation, restore drafts,
  discard/refresh, keyboard containment and focus/background restoration.
- Email fixtures check normal-flow-to-sticky positioning at 1101, 1366 and
  1440px, common laptop heights, list scrolling, header/save-bar clearance,
  short-screen fallback and the existing editor's complete workflow checks.
- Existing Maintenance preview/public-screen and machine regressions are
  retained. The keyboard fixture now explicitly focuses its headless browser
  and sends native Enter text so Windows produces the intended button click.
- Backend MaintenancePageSettingsTest, MaintenanceScopeSettingsTest and
  SitePortalMaintenanceTest pass 16 tests and 119 assertions using isolated data.
  Browser saves use local API fixtures. No production maintenance is activated.
- Products retains its shared popup/notification regression, using Dashboard
  as the unopted page now that Maintenance has joined the rollout.

Changed Maintenance and Email presentation assets use `2026.1115.7`; the final
Email stylesheet uses `2026.1115.8` to keep the icon, heading and count on one row.
The Email owner script and shared modal assets are unchanged. Release through commit,
push and the existing online deployment. Compare hosted assets and read-only
previews separately from local fixture-based saves.
