# FMRC Help UI refinement

This release changes the shared Customer support widget and the Admin/Staff
Customer Inquiries presentation. It adds no backend migration, endpoint,
permission, payment, booking or message-storage changes.

## Result

- Other Customer dialogs, including all five booking steps, hide the entire
  widget. Closing the last dialog restores it and retains unsent drafts. The
  widget's own confirmation remains usable. Account changes clear private state
  and cancel any deferred opening.
- The launcher starts as a circle, expands on hover or keyboard focus, and shares
  the Back to top column. It moves above the arrow when needed. Narrow screens,
  the visual viewport and reduced-motion preferences are respected.
- The chat uses the Customer maroon header band, subtle corner rings and FMRC
  logo. Customer conversation headings and history no longer show raw database
  numbers. Filled actions retain white text with a darker hover.
- Customer Inquiries keeps Refresh at the right. The separate FMRC Support card
  has an aligned heading/settings row and availability/status row. Staff retain
  availability controls; Support Settings remain Admin-only.
- The profile-image picker has a preview and labelled Choose Image action.
  Existing image validation/resizing, default-logo restoration, draft recovery
  and save/discard behavior are preserved. Use defaults sits at the footer's
  left, with Cancel/Save on the right; mobile actions stack cleanly.
- Close/Reopen and settings secondary actions use readable light-maroon hovers.
  Shared support consumers use cache version **2026.1117.3**.

## Local verification

| Check | Result |
| --- | --- |
| Support, matcher, Inquiries, notifications and Customer dialog browser suites | 14 checks passed |
| Focused checks after the final card alignment | Admin, Staff and launcher checks passed |
| Support backend regression | 11 tests, 176 assertions passed |
| Responsive layout | 320, 390, 768, 1024 and 1440px |
| Additional presentation checks | Operator light/dark themes, short landscape, 200% equivalent layout, reduced motion |
| Dialog behavior | Account, orders, appointments, notifications, payment/refund and booking dialog inventory; class-based, hidden-based and nested native overlays |
| Preserved workflows | Failed-send recovery, safe text, greeting replies, Contact integration, end/reopen, single/bulk history removal, Admin-only settings, upload/default restoration, background availability |

These use isolated HTTP fixtures. No production messages, presence changes,
orders, payments, refunds or published settings are submitted by these tests.

## Previews and hosted checks

Desktop/mobile screenshots are in
[`output/customer-support-controls`](../output/customer-support-controls/).
They show local fixture data and the default FMRC appearance.

After push/deployment, verify the eight Customer shells and both Inquiries
shells reference the new version, then compare the five changed shared assets
with the local release. Public availability and knowledge endpoints are read-only
setup checks. Hosted asset/presentation checks do not establish production
message delivery or validate a real authenticated operator session.
