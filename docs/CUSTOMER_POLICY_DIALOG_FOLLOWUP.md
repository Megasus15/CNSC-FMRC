# Customer policy readers and dialog borders

Prepared November 16, 2026.

## Changes

- Refund Policy and Transaction Terms retain one shared reader, heading icons,
  sticky contents card and responsive layout. Published wording, version IDs,
  links and section anchors remain unchanged.
- Both reader shells now revalidate instead of caching a historical link's UI.
  Affected CSS/reader asset versions are `2026.1116.3` across their consumers.
- Fixed the separate announcement-card stylesheet that still supplied a yellow
  frame, footer divider and focus outline after the shared dialog tokens changed.
  The Customer notification tabs also use the neutral divider.
- Removed remaining amber frame borders from checkout, cancellation, return and
  payment notices; matched My Appointments and payment-dialog border fallbacks.
- Customer sign-in/recovery dialogs use visible maroon keyboard focus. The dark
  announcement header retains a contrasting cream focus outline.
- Gold brand badges/actions and meaningful status/warning backgrounds and text
  retain their colors. Admin/Staff announcement preview styling remains intact;
  its shared stylesheet cache references were refreshed.
- Corrected the contents indicator to consider all visible sections when the
  observer reports only a subset of visibility changes.

## Verification

The focused test set covers:

- Customer Home, Products, Services, About, Contact, both versioned policy pages,
  and the Customer PWA route at 320, 390, 768, 1024 and 1440 CSS pixels.
- The actual notification/announcement shell, account/password dialogs, My
  Appointments, My Orders details, cancellation, return/refund request, product
  review, payment details, shared confirmation and booking steps 1–5.
- Sign-in/recovery frames and keyboard focus; policy layouts at a viewport
  equivalent to 200% zoom with increased text spacing.
- Notification filtering, read/delete/clear state, failure recovery and personal
  versus public announcements; hosted-payment UI, return evidence/draft retention,
  protected history removal, policy versions and safe plain-text rendering.

Financial and booking mutations use isolated local API fixtures. No real order,
payment, refund, account edit or booking is submitted by these tests.

Final local result: all 20 focused tests passed with no skips. Changed CSS parsed,
the shared reader passed JavaScript syntax validation, and `git diff --check`
reported no whitespace errors.

Run from the repository root:

```powershell
node --test --test-concurrency=1 backend/tests/Frontend/customer-dialog-borders.browser.cjs backend/tests/Frontend/customer-policy-consistency.browser.cjs backend/tests/Frontend/customer-notifications.browser.cjs backend/tests/Frontend/customer-order-payment.browser.cjs backend/tests/Frontend/customer-order-records.browser.cjs backend/tests/Frontend/policy-reader.test.cjs
```

The browser tests skip when neither Chrome nor Edge is installed. Optional font
fixture environment variables enable screenshots with the site's actual fonts.
Previews for this run are in `output/customer-policy-dialog-refinement/` locally.

## Release

This follow-up is a frontend/cache update and requires no additional migration.
Commit and push the focused files, deploy that commit through the existing
Hostinger Git connection, and verify the served files and both clean policy URLs.
Refresh an already-open page after deployment to load the new asset versions.

The initial read-only production check found the refined reader markup and shared
assets on both policy URLs. It also confirmed long-lived CSS caching, while the
separate notification-card stylesheet still contained the yellow frame. Final
hosted verification is recorded separately from local fixture checks.
