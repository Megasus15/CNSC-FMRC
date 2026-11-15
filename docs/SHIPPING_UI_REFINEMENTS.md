# Admin Shipping & Delivery presentation

The Admin page opts into the Inventory presentation with
`data-portal-shipping-dialogs` and `data-portal-popups="refined"`. Staff retains
its existing published, read-only Shipping view; its access is not expanded.

`website-shipping-ui.css` adds cream 12px cards, maroon icon headings, readable
semibold labels, balanced fields, outlined actions and 44px controls. Published
rates, delivery areas, working calendar, publication and tracking sections use
the same treatment. Tracking facts remain read-only, complete and naturally
wrapped. Existing published-table pagination and the large delivery-area list
keep their behavior. The province picker retains its search icon, keyboard
selection and associated label, with the compact Search placeholder.

`website-shipping-ui.js` decorates existing owner-rendered headings once and
updates presentation after dynamic table/area renders. Existing heading icons
are replaced rather than duplicated. No form, input, button, value or event
handler is replaced. Confirmation, remove, validation, error, logout and session
popups reuse the existing shared helper and guards. Compact popups have no X
or message rules; success notifications retain their original X and timing.

The shipping feature and tracking scripts, endpoints, expected revisions,
validation, draft/publish separation, approval requirement and provider
activation rules are unchanged. Existing orders retain their accepted shipping
fees. No provider activation, live publication or real shipment is performed
during implementation or verification.

## Shared Logout and Login Portals

Profile Logout now matches Sidebar Logout's darker hover background and border
in each theme. My Account and Settings keep their light maroon hover. Icon
classes, account identities, navigation and logout confirmation are unchanged;
both Logout buttons remain stationary when pressed.

Login Portals no longer caps or scrolls the inside of Live Preview. The complete
miniature portal fits proportionally above normal-size guidance. Its heading,
image/form and bottom notes stay visible together when the card is sticky.
The artwork uses its natural dimensions for fitting, without altering any
appearance bindings. When very short screens or long copy cannot fit without
excessive shrinking, the complete card uses normal page flow. Phone/tablet
layouts also remain fully readable. No content is hidden or clipped to fit.

## Verification and delivery

- Admin Shipping browser checks at 320, 390, 768, 1024 and 1440px in both themes,
  including icons, labels, search, no-X popups, cancel, failed-save recovery,
  duplicate-submit guard, explicit approval/publication, tracking cancellation,
  short landscape, text spacing and Staff read-only access.
- Existing shipping-refresh browser coverage verifies current published rates,
  tracking refresh, draft persistence, last-area removal, publication and Staff
  readback. Existing shipping quote, portal draft and appearance tests remain
  in use. Backend ShippingQuotesTest: 15 tests and 158 assertions.
- Shared profile checks audit all 43 shells and exercise Admin/Staff keyboard,
  hover equality with Sidebar Logout, focus, long identities and logout cancel.
- Login Portals checks cover full artwork and bottom guidance without inner
  scrolling, 1140px through 1920px desktop widths, common short laptop heights,
  very-short-screen fallback, long copy, safe rendering, uploads and save/readback.
- Products' existing popup/media/notifications/session regression retains an
  unopted Email Templates page to check rollout boundaries.

Shared stylesheet, Login Portals UI and new Shipping UI assets use
`2026.1115.3`. All 43 shared stylesheet consumers receive matching versions.
The unchanged shared profile script remains `2026.1115.1`.

Deliver by commit, push and the existing online deployment. Verify hosted files
and read-only presentation separately from local fixture-based mutations.
No backend change, migration or new dependency is required.
