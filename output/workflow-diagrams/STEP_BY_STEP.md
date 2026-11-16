# UCN-FMRC: step-by-step workflow guide

Source commit: `c499fa5d03fc89ef8dc10ab828c4f1b3df4b35b4`. Reviewed 15 November 2026.

## F00 - System overview: separate, connected workflows

Use this map to locate the independent workflow files. It does not replace any detailed end-to-end process.

[PDF](pdf/F00-system-overview.pdf) | [Editable](drawio/F00.drawio) | [SVG](svg/F00-system-overview.svg) | [PNG](png/F00-system-overview.png)

**Start:** Choose the journey you need to explain.

This is a navigation map. Its groups are independent entry points, not sequential actions.

- **Customer access (F01 - F08):** Accounts, credentials and workspace preferences. Open F01.
- **Appointments (F09 - F12):** Service consultations and custom-product requests. Open F09.
- **Orders and money (F13 - F23):** Purchase, payment, fulfillment, returns and refunds. Open F13.
- **Customer support (F24 - F25):** Product reviews, FMRC replies and inquiries. Open F25.
- **Shared operations (F26 - F34):** Inventory, products, reports, notifications and archives. Open F26.
- **Website administration (F35 - F45):** Content, branding, policies and operating settings. Open F35.

**Alternatives and exceptions**


**Key rules**

- The six groups are independent entry points, not a mandatory sequence of unrelated tasks.
- Use the index to open an individual workflow. Customer and operator actions are separated by responsibility.
- External email, payment, push and courier services are shown only in the workflows that use them.

**Related workflows:** F01, F09, F10, F13, F26, F35

## F01 - Customer registration and sign-in

Create a Customer account or sign in through the available password or Google path.

[PDF](pdf/F01-customer-access.pdf) | [Editable](drawio/F01.drawio) | [SVG](svg/F01-customer-access.svg) | [PNG](png/F01-customer-access.png)

**Start:** A visitor wants an authenticated Customer session.

1. **Customer / Guest:** Choose sign-in or registration.
2. **Customer / Guest:** Provide required account details.
3. **External Provider:** Verify Google or challenge, if used.
4. **System:** Access valid?.
   Primary route: Yes. See the alternative below before proceeding.
5. **System:** Create account or issue session.
6. **Customer / Guest:** Open Customer workspace.

**Alternatives and exceptions**

- At step 4, **No**: Correct details; try again. Return to step 2.

**Key rules**

- New public registration creates Customer accounts, never Admin or Staff accounts.
- Google sign-in and CAPTCHA depend on configured keys. Failed login and lockout do not grant access.
- Forgotten passwords follow F04; sessions and sign-out follow F07.

**Related workflows:** F04, F07, F13

## F02 - Staff account application and approval

An applicant requests Staff access; an Admin reviews and approves or declines the application.

[PDF](pdf/F02-staff-application.pdf) | [Editable](drawio/F02.drawio) | [SVG](svg/F02-staff-application.svg) | [PNG](png/F02-staff-application.png)

**Start:** A prospective Staff member opens the account-request form.

1. **Customer / Guest:** Submit Staff application.
2. **System:** Validate and queue request.
3. **Admin:** Review applicant.
4. **Admin:** Approve request?.
   Primary route: Yes. See the alternative below before proceeding.
5. **System:** Create Staff account; send decision.
6. **Customer / Guest:** Sign in with approved account.

**Alternatives and exceptions**

- At step 4, **No**: Request declined; read decision. Stop this route.

**Key rules**

- Application alone does not create an active Staff session.
- Admin approval rechecks identifiers; a username or Gmail taken after submission blocks creation.
- Requests are subject to CAPTCHA, rate limits and installed storage.

**Related workflows:** F01, F03, F07

## F03 - Admin user management

An Admin creates separate user accounts or deletes eligible accounts through User Management.

[PDF](pdf/F03-admin-user-management.pdf) | [Editable](drawio/F03.drawio) | [SVG](svg/F03-admin-user-management.svg) | [PNG](png/F03-admin-user-management.png)

**Start:** An Admin opens User Management.

1. **Admin:** Choose create or delete.
2. **Admin:** Enter user details or select account.
3. **System:** Action allowed?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Confirm authority or deletion.
5. **System:** Save account or revoke access.
6. **Admin:** Review refreshed directory.

**Alternatives and exceptions**

- At step 3, **No**: Read protection or validation reason. Stop this route.

**Key rules**

- Only full Admin accounts manage users. A new Admin has separate credentials and personal settings.
- The built-in Admin, signed-in account and last full Admin are protected by current safeguards.
- Deletion eligibility and retained history are enforced by the server; direct requests cannot bypass them.

**Related workflows:** F02, F05, F08

## F04 - Password reset

Recover account access using the existing emailed one-time-code flow.

[PDF](pdf/F04-password-reset.pdf) | [Editable](drawio/F04.drawio) | [SVG](svg/F04-password-reset.svg) | [PNG](png/F04-password-reset.png)

**Start:** An account holder chooses Forgot password.

1. **Customer / Guest:** Enter account identifier.
2. **System:** Check request limits.
3. **External Provider:** Deliver reset code by email.
4. **Customer / Guest:** Enter code and new password.
5. **System:** Code valid?.
   Primary route: Yes. See the alternative below before proceeding.
6. **System:** Update password securely.
7. **Customer / Guest:** Sign in with new password.

**Alternatives and exceptions**

- At step 5, **No**: Correct code or request a new one. Return to step 4.

**Key rules**

- Code expiry, retry limits and throttling remain authoritative; invalid attempts do not reset a password.
- An Admin unable to receive email may use an existing unused recovery code through F06.
- Email delivery depends on the configured mail service.

**Related workflows:** F01, F06, F07

## F05 - Personal profile and credential updates

Each signed-in person updates only the profile and sign-in fields their portal permits.

[PDF](pdf/F05-profile-credentials.pdf) | [Editable](drawio/F05.drawio) | [SVG](svg/F05-profile-credentials.svg) | [PNG](png/F05-profile-credentials.png)

**Start:** A signed-in user opens personal account details.

1. **Account holder:** Open profile or My Account.
2. **Account holder:** Edit permitted fields.
3. **System:** Validate changes and identity.
4. **System:** Email check required?.
   Primary route: Yes. See the alternative below before proceeding.
5. **Account holder:** Verify emailed change code.
6. **System:** Save authorized changes.
7. **Account holder:** Read saved account details.

**Alternatives and exceptions**

- At step 4, **No**: continue directly to step 6, skipping the intervening primary-route steps.

**Key rules**

- Customer, Staff and Admin use separate account entry points. Only their own permitted fields can change.
- Admin Gmail changes use emailed verification when its storage is installed. Staff and Customer use their existing update path.
- Password changes require the current password; unchanged forms cannot submit. Read-only Staff name stays protected.

**Related workflows:** F04, F06, F08

## F06 - Admin recovery-code generation and redemption

A full Admin generates one-time recovery codes and can later redeem one to recover access.

[PDF](pdf/F06-admin-recovery-codes.pdf) | [Editable](drawio/F06.drawio) | [SVG](svg/F06-admin-recovery-codes.svg) | [PNG](png/F06-admin-recovery-codes.png)

**Start:** An Admin manages or needs existing recovery codes.

1. **Admin:** Choose generate or redeem.
2. **Admin:** Supply password or unused code.
3. **System:** Security check valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Complete selected recovery action.
5. **System:** Send security alert; retain audit.
6. **Admin:** Store codes or sign in securely.

**Alternatives and exceptions**

- At step 3, **No**: Retry within limits; no access granted. Return to step 2.

**Key rules**

- Generate: validate current password, invalidate the old set, then show the new codes once for offline storage.
- Redeem: validate an unused code and new password, consume that code, reset the password and send an alert.
- Recovery-code endpoints are Admin-only; Staff and Customer do not gain this path.

**Related workflows:** F03, F04, F05

## F07 - Session renewal, expiry and logout

Authenticated operators renew an eligible session or safely end access.

[PDF](pdf/F07-session-lifecycle.pdf) | [Editable](drawio/F07.drawio) | [SVG](svg/F07-session-lifecycle.svg) | [PNG](png/F07-session-lifecycle.png)

**Start:** An operator signs in or a session reaches its warning window.

1. **Admin / Staff:** Use authenticated workspace.
2. **System:** Track idle and absolute expiry.
3. **System:** Session valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Renew or choose Logout.
5. **System:** Renew eligible session or revoke token.
6. **Admin / Staff:** Continue or return to sign-in.

**Alternatives and exceptions**

- At step 3, **No**: Session expired: sign in again. Stop this route.

**Key rules**

- Idle warning, renewal and absolute lifetime are distinct. An expired session cannot be renewed as an active one.
- Logout confirmation cancellation preserves the session; confirmed logout revokes its access.
- The diagram shows operator session controls. Customer token-based logout also ends the current device session.

**Related workflows:** F01, F04, F08

## F08 - Personal Settings and sidebar customization

Save account-specific appearance, display, branding and sidebar preferences.

[PDF](pdf/F08-personal-settings.pdf) | [Editable](drawio/F08.drawio) | [SVG](svg/F08-personal-settings.svg) | [PNG](png/F08-personal-settings.png)

**Start:** An operator opens Settings.

1. **Admin / Staff:** Select personal preferences.
2. **Admin / Staff:** Adjust logo or sidebar width.
3. **System:** Values valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Apply local preview and save.
5. **System:** Sync account and same-user tabs.
6. **Admin / Staff:** Use personal workspace.

**Alternatives and exceptions**

- At step 3, **No**: Correct values or cancel editor. Return to step 2.

**Key rules**

- Theme, reduced motion, table density and branding belong to the authenticated user, not every operator.
- A logo editor Cancel leaves the saved logo unchanged; Use logo applies its prepared canvas.
- Offline changes remain local with explicit sync feedback; Restore defaults keeps its immediate behavior.

**Related workflows:** F05, F07

## F09 - Service consultation: booking to completion

Book and attend a consultation without automatically creating a custom-product order.

[PDF](pdf/F09-service-consultation.pdf) | [Editable](drawio/F09.drawio) | [SVG](svg/F09-service-consultation.svg) | [PNG](png/F09-service-consultation.png)

**Start:** A visitor selects Book a consultation.

1. **Customer / Guest:** Choose service and meeting method.
2. **Customer / Guest:** Enter details; choose open slot.
3. **System:** Slot valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Save booking; send reference.
5. **Admin / Staff:** Review; set online link if needed.
6. **Customer / Guest:** Attend online or in person.
7. **Admin / Staff:** Confirm consultation completed.
8. **System:** Retain consultation history.

**Alternatives and exceptions**

- At step 3, **No**: Choose another valid slot. Return to step 2.

**Key rules**

- Online and face-to-face are meeting-method branches, not the two separate appointment business workflows.
- Booking uses shared calendar availability and validation. Private file uploads require the permitted signed-in path.
- A meeting link is not evidence that a consultation happened. Custom-product work is separately tracked in F10.

**Related workflows:** F10, F11, F12

## F10 - Custom-product appointment: request to fulfillment

Connect consultation, agreed specifications, quotation, full payment, production and fulfillment.

[PDF](pdf/F10-custom-product-appointment.pdf) | [Editable](drawio/F10.drawio) | [SVG](svg/F10-custom-product-appointment.svg) | [PNG](png/F10-custom-product-appointment.png)

**Start:** A signed-in Customer requests a custom product with a consultation.

1. **Customer:** Submit brief, files and booking.
2. **System:** Save linked request and consultation.
3. **Admin / Staff:** Attend and confirm discussion.
4. **Admin / Staff:** Ready to quote?.
   Primary route: Yes. See the alternative below before proceeding.
5. **Admin / Staff:** Send quotation and agreed terms.
6. **Customer:** Accept current quote?.
   Primary route: Yes. See the alternative below before proceeding.
7. **Admin / Staff:** Payment, production and handover - F17.
8. **System:** Retain completed linked history.

**Alternatives and exceptions**

- At step 4, **No**: Clarify brief, follow up or close. Stop this route.
- At step 6, **No**: Close declined or expired offer. Stop this route.

**Key rules**

- Only an attended, confirmed consultation may advance to quotation. More information, follow-up or decline are real alternatives.
- Acceptance creates one linked Order; full online or advance-cash payment is required before production.
- Expired or unpaid quotations may need renewal. Resolve prior orders, held money and refunds before re-quoting.

**Related workflows:** F09, F11, F14, F17, F18

## F11 - Appointment rescheduling and cancellation

Change an eligible consultation schedule or cancel it while keeping linked work protected.

[PDF](pdf/F11-appointment-changes.pdf) | [Editable](drawio/F11.drawio) | [SVG](svg/F11-appointment-changes.svg) | [PNG](png/F11-appointment-changes.png)

**Start:** A Customer opens an owned appointment.

1. **Customer:** Choose reschedule or cancel.
2. **System:** Change allowed?.
   Primary route: Yes. See the alternative below before proceeding.
3. **Customer:** Select new slot or confirm cancel.
4. **System:** Lock and recheck latest schedule.
5. **System:** Commit schedule or cancellation.
6. **Admin / Staff:** See updated calendar and history.
7. **Customer:** Read confirmed result.

**Alternatives and exceptions**

- At step 2, **No**: Read blocker; keep current booking. Stop this route.

**Key rules**

- Rescheduling is restricted by the existing time and ownership rules; a stale schedule must be refreshed.
- A slot change preserves the consultation identity and respects current availability.
- Custom jobs, accepted orders and held payments use their own guards; cancelling a meeting is not an automatic refund.

**Related workflows:** F09, F10, F12, F18

## F12 - Calendar availability management

Manage bookable dates, notes and time slots while protecting current appointments.

[PDF](pdf/F12-calendar-management.pdf) | [Editable](drawio/F12.drawio) | [SVG](svg/F12-calendar-management.svg) | [PNG](png/F12-calendar-management.png)

**Start:** An operator opens Manage Calendar.

1. **Admin / Staff:** Choose calendar date.
2. **Admin / Staff:** Edit blocks, notes or time slots.
3. **System:** Changes valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save calendar changes.
5. **System:** Persist shared availability.
6. **Customer:** See updated bookable slots.

**Alternatives and exceptions**

- At step 3, **No**: Correct changes; preserve draft. Return to step 2.

**Key rules**

- Default schedules, day-specific changes and existing reservations are checked by current scheduling rules.
- Calendar changes do not silently rebook existing Customers.
- Both operator portals read the same shared calendar; personal Settings do not alter it.

**Related workflows:** F09, F10, F11

## F13 - Product purchase: browse to completion

Follow a normal product order through checkout, FMRC review, payment and fulfillment.

[PDF](pdf/F13-product-purchase.pdf) | [Editable](drawio/F13.drawio) | [SVG](svg/F13-product-purchase.svg) | [PNG](png/F13-product-purchase.png)

**Start:** A Customer browses available products.

1. **Customer:** Select products or edit cart.
2. **Customer:** Select fulfillment, payment and terms.
3. **System:** Validate and save order request.
4. **Admin / Staff:** Approve request?.
   Primary route: Yes. See the alternative below before proceeding.
5. **Customer:** Online: pay now. Cash: pay at pickup..
6. **Admin / Staff:** Start preparation when eligible.
7. **Admin / Staff:** Complete pickup or delivery.
8. **System:** Retain completed order and payment.

**Alternatives and exceptions**

- At step 4, **No**: Request declined; read reason. Stop this route.

**Key rules**

- FMRC request review comes before payment availability; approval reserves stock and is separate from starting preparation.
- New normal orders support enabled online payment or cash on pickup. Delivery uses the eligible online-payment path.
- Online payment: F14. Cash pickup and collection: F15. Delivery: F16. Legacy COD is not a new-order default.

**Related workflows:** F14, F15, F16, F18, F19, F21, F22

## F14 - Online payment and provider confirmation

Create an eligible checkout and confirm payment using verified provider evidence.

[PDF](pdf/F14-online-payment.pdf) | [Editable](drawio/F14.drawio) | [SVG](svg/F14-online-payment.svg) | [PNG](png/F14-online-payment.png)

**Start:** An approved normal order or accepted custom quotation is awaiting online payment.

1. **Customer:** Open payment action.
2. **System:** Payment eligible?.
   Primary route: Yes. See the alternative below before proceeding.
3. **System:** Create or reuse checkout attempt.
4. **External Provider:** Host secure QR Ph checkout.
5. **Customer:** Authorize payment; return.
6. **System:** Verify webhook or reconcile.
7. **System:** Confirmed full payment?.
   Primary route: Yes. See the alternative below before proceeding.
8. **Customer:** Follow fulfillment; do not pay twice.

**Alternatives and exceptions**

- At step 2, **No**: Wait for approval or readiness. Stop this route.
- At step 7, **No**: Pending or failed: check status first. Stop this route.

**Key rules**

- Returning from checkout, a screenshot or a manually typed reference does not establish provider-managed payment.
- Pending or uncertain attempts are checked before retry; duplicate or late payments require recorded review.
- Cash on pickup bypasses hosted checkout. Custom advance cash follows F17 instead.

**Related workflows:** F13, F17, F20, F22

## F15 - Pickup fulfillment and collection

Prepare an eligible pickup order and confirm physical collection using the Customer pickup code.

[PDF](pdf/F15-pickup-collection.pdf) | [Editable](drawio/F15.drawio) | [SVG](svg/F15-pickup-collection.svg) | [PNG](png/F15-pickup-collection.png)

**Start:** A pickup order is approved for preparation.

1. **Admin / Staff:** Prepare eligible pickup order.
2. **System:** Publish ready-for-pickup status.
3. **Customer:** Bring pickup code to FMRC.
4. **Admin / Staff:** Record cash if due; verify code.
5. **System:** Collection allowed?.
   Primary route: Yes. See the alternative below before proceeding.
6. **System:** Complete order and retain evidence.
7. **Customer:** Receive collected order.

**Alternatives and exceptions**

- At step 5, **No**: Resolve code, payment or hold. Stop this route.

**Key rules**

- Unresolved payment, cancellation, refund or custom-production holds prevent collection.
- Custom orders must already have full payment and ready production; normal pickup cash is recorded at collection.
- Delivery orders use F16 instead. A Customer cannot manually force completion through the retired receive action.

**Related workflows:** F13, F16, F17, F21

## F16 - Delivery handover and courier tracking

Record genuine J&T handover, track the parcel and complete eligible delivery from verified courier evidence.

[PDF](pdf/F16-delivery-tracking.pdf) | [Editable](drawio/F16.drawio) | [SVG](svg/F16-delivery-tracking.svg) | [PNG](png/F16-delivery-tracking.png)

**Start:** A paid order is ready for courier dispatch.

1. **Admin / Staff:** Check parcel and paid order.
2. **Admin / Staff:** Record J&T waybill and handover.
3. **System:** Tracking ready?.
   Primary route: Yes. See the alternative below before proceeding.
4. **External Provider:** Deliver parcel; publish scans.
5. **System:** Verify and apply 17TRACK events.
6. **System:** Delivered and eligible?.
   Primary route: Yes. See the alternative below before proceeding.
7. **System:** Complete eligible delivery.
8. **Customer:** View delivered order and timeline.

**Alternatives and exceptions**

- At step 3, **No**: Resolve setup; do not invent scans. Stop this route.
- At step 6, **No**: In transit or exception: await review. Stop this route.

**Key rules**

- The current automatic tracking integration is 17TRACK for J&T; activation and provider credentials are configuration-dependent.
- FMRC notes do not rewrite courier events. Exceptions, corrected waybills and unverified evidence need review.
- The accepted shipping fee stays recorded; later actual courier charges do not silently change the Customer agreement.

**Related workflows:** F13, F15, F17, F42

## F17 - Custom production and advance cash

Record full custom-order payment before starting production and then complete fulfillment.

[PDF](pdf/F17-custom-production-cash.pdf) | [Editable](drawio/F17.drawio) | [SVG](svg/F17-custom-production-cash.svg) | [PNG](png/F17-custom-production-cash.png)

**Start:** A Customer accepts an eligible custom quotation.

1. **Customer:** Choose online or advance cash.
2. **Admin / Staff:** Read online receipt or record cash.
3. **System:** Full payment cleared?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Start production.
5. **Admin / Staff:** Mark finished product ready.
6. **Admin / Staff:** Collect or dispatch finished product.
7. **System:** Retain payment and production log.

**Alternatives and exceptions**

- At step 3, **No**: Resolve payment, correction or refund. Stop this route.

**Key rules**

- Online: provider confirmation (F14). Advance cash: record the full amount actually received at FMRC before production.
- Only Admin may correct an eligible cash receipt or issue a custom cash refund; these are auditable separate actions.
- Paid work is not silently rewritten. Close and reconcile the existing order before a new quotation.

**Related workflows:** F10, F14, F15, F16, F18, F22

## F18 - Order cancellation

Cancel an eligible order directly or request an operator decision when required.

[PDF](pdf/F18-order-cancellation.pdf) | [Editable](drawio/F18.drawio) | [SVG](svg/F18-order-cancellation.svg) | [PNG](png/F18-order-cancellation.png)

**Start:** A Customer opens Cancel order.

1. **Customer:** Request cancellation with reason.
2. **System:** Change allowed?.
   Primary route: Yes. See the alternative below before proceeding.
3. **System:** Cancel directly?.
   Primary route: No. See the alternative below before proceeding.
4. **Admin / Staff:** Review pending request.
5. **Admin / Staff:** Approve request?.
   Primary route: Yes. See the alternative below before proceeding.
6. **System:** Cancel; restore stock once.
7. **System:** Queue refund review if due.
8. **Customer:** Read saved cancellation status.

**Alternatives and exceptions**

- At step 2, **No**: Read blocker; keep order. Stop this route.
- At step 5, **No**: Decline; tell Customer why. Stop this route.
- At step 3, **Yes**: continue directly to step 6, skipping the intervening primary-route steps.

**Key rules**

- Eligible immediate cancellations bypass operator review. Other eligible requests wait for an explicit decision.
- Cancellation and refund are separate outcomes. A paid order can be cancelled while its money still needs review (F22).
- Paid cancellations require the applicable refund process; recording cancellation alone does not return money.

**Related workflows:** F13, F17, F22, F34

## F19 - Order rejection

Decline an eligible order request or reject eligible unfulfilled work with a recorded reason.

[PDF](pdf/F19-order-rejection.pdf) | [Editable](drawio/F19.drawio) | [SVG](svg/F19-order-rejection.svg) | [PNG](png/F19-order-rejection.png)

**Start:** An operator identifies an order that cannot be fulfilled.

1. **Admin / Staff:** Review current order and reason.
2. **System:** Rejection allowed?.
   Primary route: Yes. See the alternative below before proceeding.
3. **Admin / Staff:** Confirm rejection.
4. **System:** Record decision and release eligibility.
5. **System:** Queue refund review if money held.
6. **Customer:** Read declined order and reason.

**Alternatives and exceptions**

- At step 2, **No**: Refresh or resolve fulfillment blocker. Stop this route.

**Key rules**

- Request review and later fulfillment rejection use their own current server safeguards.
- A recorded rejection does not by itself certify that held money has been refunded.
- Bulk decisions recheck each selected record; protected records are not forced through.

**Related workflows:** F13, F18, F22, F34

## F20 - Refunded-order review

Resolve a normal active order whose payment has already been refunded before fulfillment.

[PDF](pdf/F20-refunded-order-review.pdf) | [Editable](drawio/F20.drawio) | [SVG](svg/F20-refunded-order-review.svg) | [PNG](png/F20-refunded-order-review.png)

**Start:** An order displays Refunded - FMRC review required.

1. **Admin / Staff:** Identify refunded active order.
2. **Admin:** Review refund and delivery evidence.
3. **System:** Closure eligible?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Confirm closure and stock decision.
5. **System:** Record closure without new refund.
6. **Admin / Staff:** Read resolved order history.

**Alternatives and exceptions**

- At step 3, **No**: Reconcile evidence; keep review hold. Stop this route.

**Key rules**

- Only eligible normal orders use this path; it is not a second refund or a replacement checkout.
- Courier handover, collection, pending cancellation or incomplete refund evidence blocks closure.
- Stock decisions respect any quantity already released; refresh stale records before confirming.

**Related workflows:** F19, F21, F22, F34

## F21 - Returns and resolution

Review a Customer return, receive the item and apply the approved resolution.

[PDF](pdf/F21-returns-resolution.pdf) | [Editable](drawio/F21.drawio) | [SVG](svg/F21-returns-resolution.svg) | [PNG](png/F21-returns-resolution.png)

**Start:** A Customer requests help with a completed order.

1. **Customer:** Select items, evidence and reason.
2. **System:** Return eligible?.
   Primary route: Yes. See the alternative below before proceeding.
3. **Admin / Staff:** Review return request.
4. **Admin / Staff:** Approve request?.
   Primary route: Yes. See the alternative below before proceeding.
5. **Customer:** Send item; record return shipment.
6. **Admin / Staff:** Receive and inspect item.
7. **Admin / Staff:** Record agreed resolution.
8. **System:** Retain return and financial history.

**Alternatives and exceptions**

- At step 2, **No**: Read eligibility reason. Stop this route.
- At step 4, **No**: Record rejection and explanation. Stop this route.

**Key rules**

- The current return window is seven days after completion; only one open return is allowed per order.
- Online refunds follow F22 after the approved return is received and inspected; custom cash refunds require Admin authority.
- Repair or replacement is recorded as a resolution; that label alone does not create automatic replacement fulfillment.

**Related workflows:** F15, F16, F17, F22

## F22 - Online refund request, approval and retry

Request an eligible refund, obtain Admin authorization and confirm its actual provider result.

[PDF](pdf/F22-online-refunds.pdf) | [Editable](drawio/F22.drawio) | [SVG](svg/F22-online-refunds.svg) | [PNG](png/F22-online-refunds.png)

**Start:** A closed order, approved return or verified extra payment needs a refund.

1. **Admin / Staff:** Identify receipt, amount and reason.
2. **System:** Refund eligible?.
   Primary route: Yes. See the alternative below before proceeding.
3. **Admin:** Approve request?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Submit authorized refund once.
5. **External Provider:** Process refund and QR Ph claim.
6. **System:** Confirmed succeeded?.
   Primary route: Yes. See the alternative below before proceeding.
7. **Admin / Staff:** Read confirmed refund and balance.

**Alternatives and exceptions**

- At step 2, **No**: Resolve eligibility before requesting. Stop this route.
- At step 6, **No**: Check status; review retry or rejection. Stop this route.
- At step 3, **No**: Record decline; no refund issued. Stop this route.

**Key rules**

- Staff can request a refund; issuing, approval and rejection follow Admin-only authority.
- A confirmed receipt and remaining refundable amount are required. Requested or processing is not Refund confirmed.
- Check failed/unknown attempts before retry. QR Ph completion depends on the provider claim and funded merchant wallet.

**Related workflows:** F18, F19, F20, F21, F34

## F23 - Walk-in sales

Record a walk-in transaction and its existing cashier-based payment information.

[PDF](pdf/F23-walk-in-sales.pdf) | [Editable](drawio/F23.drawio) | [SVG](svg/F23-walk-in-sales.svg) | [PNG](png/F23-walk-in-sales.png)

**Start:** An operator opens Add Walk-in.

1. **Admin / Staff:** Enter Customer and project details.
2. **Admin / Staff:** Select item, cost and cashier record.
3. **System:** Record valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Save sale; adjust linked stock.
5. **Admin / Staff:** Update or mark work completed.
6. **System:** Include eligible totals in reports.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields and save again. Return to step 2.

**Key rules**

- Walk-in payment is recorded as WALKIN VIA CASHIER, not as hosted checkout.
- A linked product quantity updates product stock through the existing transaction behavior.
- Completion and archiving preserve their existing eligibility and reporting rules.

**Related workflows:** F29, F32, F34

## F24 - Product reviews and FMRC replies

Publish an eligible Customer product review and allow operators to respond or archive it.

[PDF](pdf/F24-product-reviews.pdf) | [Editable](drawio/F24.drawio) | [SVG](svg/F24-product-reviews.svg) | [PNG](png/F24-product-reviews.png)

**Start:** A Customer opens the review action for an order.

1. **Customer:** Enter rating and review.
2. **System:** Review eligible?.
   Primary route: Yes. See the alternative below before proceeding.
3. **System:** Save Customer review.
4. **Admin / Staff:** Read review; reply if needed.
5. **Customer:** Browse reviews or like a review.
6. **Admin / Staff:** Keep or archive eligible review.
7. **System:** Refresh visible review totals.

**Alternatives and exceptions**

- At step 2, **No**: Read eligibility reason. Stop this route.

**Key rules**

- Order ownership and review eligibility are checked server-side; a public visitor cannot impersonate a purchaser.
- Replying and archiving are operator actions; Customer likes and public visibility follow existing rules.
- Archiving is distinct from editing a Customer rating or changing a product purchase.

**Related workflows:** F13, F34

## F25 - Customer inquiry submission and resolution

Send a signed-in Customer inquiry and track the operator read/resolution process.

[PDF](pdf/F25-customer-inquiries.pdf) | [Editable](drawio/F25.drawio) | [SVG](svg/F25-customer-inquiries.svg) | [PNG](png/F25-customer-inquiries.png)

**Start:** A Customer opens the Contact inquiry form.

1. **Customer:** Enter name, email and message.
2. **System:** Message valid?.
   Primary route: Yes. See the alternative below before proceeding.
3. **System:** Save inquiry; notify operators.
4. **Admin / Staff:** Open details; mark read.
5. **Admin / Staff:** Mark inquiry resolved.
6. **System:** Refresh inquiry counts and history.

**Alternatives and exceptions**

- At step 2, **No**: Correct message and resubmit. Return to step 1.

**Key rules**

- Submitting an inquiry requires the existing signed-in Customer path.
- The inquiry module records read and resolved states; it does not include an in-app conversation thread.
- Delete actions require explicit confirmation and existing permissions.

**Related workflows:** F33, F38

## F26 - Inventory items and variants

Create or edit inventory records while preserving variant-level stock ownership.

[PDF](pdf/F26-inventory-records.pdf) | [Editable](drawio/F26.drawio) | [SVG](svg/F26-inventory-records.svg) | [PNG](png/F26-inventory-records.png)

**Start:** An operator opens Add or Edit Item.

1. **Admin / Staff:** Enter item information.
2. **Admin / Staff:** Add units and optional variants.
3. **System:** Record valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Save item and variant records.
5. **Admin / Staff:** View item and variant details.
6. **System:** Refresh shared inventory.

**Alternatives and exceptions**

- At step 3, **No**: Correct values; keep draft. Return to step 2.

**Key rules**

- Variant stock is tracked separately; mixed units must not be shown as one misleading combined quantity.
- Editing identity fields does not bypass read-only stock controls; adjustments use F27.
- Failed saves retain entered values; archiving uses the existing confirmation flow.

**Related workflows:** F27, F28, F34

## F27 - Inventory stock adjustments

Add or deduct an allowed quantity for an inventory item or a selected variant.

[PDF](pdf/F27-stock-adjustments.pdf) | [Editable](drawio/F27.drawio) | [SVG](svg/F27-stock-adjustments.svg) | [PNG](png/F27-stock-adjustments.png)

**Start:** An operator opens Adjust Stocks.

1. **Admin / Staff:** Select item or variant.
2. **Admin / Staff:** Choose add or deduct; enter amount.
3. **Admin / Staff:** Record person and purpose.
4. **System:** Adjustment allowed?.
   Primary route: Yes. See the alternative below before proceeding.
5. **System:** Save quantity and transaction.
6. **Admin / Staff:** Read updated stock and status.

**Alternatives and exceptions**

- At step 4, **No**: Correct amount or resolve blocker. Return to step 2.

**Key rules**

- A positive amount and existing stock rules govern adjustments; missing data is not treated as zero.
- Select the actual variant when stock is variant-owned.
- An inventory adjustment is not automatically a product catalog purchase or an online payment.

**Related workflows:** F26, F28, F32

## F28 - Low-stock rules

Set fixed or percentage thresholds with the existing override inheritance order.

[PDF](pdf/F28-low-stock-rules.pdf) | [Editable](drawio/F28.drawio) | [SVG](svg/F28-low-stock-rules.svg) | [PNG](png/F28-low-stock-rules.png)

**Start:** An operator opens Stock Level Rules.

1. **Admin / Staff:** Review current stock rules.
2. **Admin / Staff:** Edit default or overrides.
3. **System:** Threshold valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save rule changes.
5. **System:** Apply variant-to-default precedence.
6. **Admin / Staff:** Read updated stock indicators.

**Alternatives and exceptions**

- At step 3, **No**: Correct threshold; keep draft. Return to step 2.

**Key rules**

- Precedence is variant, item, category, then default. Empty overrides inherit the next applicable rule.
- Fixed and percentage thresholds retain their existing calculations; zero stock remains Out of Stock.
- Background refresh does not overwrite an actively edited draft.

**Related workflows:** F26, F27

## F29 - Product catalog and media management

Manage products, prices, stock, visibility and gallery media for the public catalog.

[PDF](pdf/F29-product-catalog.pdf) | [Editable](drawio/F29.drawio) | [SVG](svg/F29-product-catalog.svg) | [PNG](png/F29-product-catalog.png)

**Start:** An operator opens Products.

1. **Admin / Staff:** Add or edit product details.
2. **Admin / Staff:** Prepare cover and gallery media.
3. **System:** Product valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Save product and media changes.
5. **Customer:** Browse visible available products.
6. **Admin / Staff:** Maintain or delete eligible products.
7. **System:** Refresh catalog and reports.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields or media; retry. Return to step 2.

**Key rules**

- Checked visibility controls retain their existing is_blocked meaning; labels must not imply an inverted value.
- Gallery slots, upload limits, cover assignment and draft recovery are preserved.
- Permanent deletion remains guarded by server restrictions and explicit confirmation.

**Related workflows:** F13, F23, F30, F32

## F30 - Promotions management

Create, update and retire promotions while preserving public eligibility and timing.

[PDF](pdf/F30-promotions.pdf) | [Editable](drawio/F30.drawio) | [SVG](svg/F30-promotions.svg) | [PNG](png/F30-promotions.png)

**Start:** An operator opens Promotions.

1. **Admin / Staff:** Select promotion products.
2. **Admin / Staff:** Set offer, dates and appearance.
3. **System:** Promotion valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Save promotion.
5. **Customer:** See currently eligible offers.
6. **Admin / Staff:** Edit, archive or delete as allowed.
7. **System:** Refresh shared promotion state.

**Alternatives and exceptions**

- At step 3, **No**: Correct offer; keep draft. Return to step 2.

**Key rules**

- The active-public query, dates and product eligibility decide what Customers see.
- Promotion changes do not rewrite accepted historical order totals.
- Failed saves preserve drafts; destructive actions require existing confirmations.

**Related workflows:** F13, F29, F34

## F31 - Announcements management

Publish and manage Customer-facing announcements using the existing promotion-page editor.

[PDF](pdf/F31-announcements.pdf) | [Editable](drawio/F31.drawio) | [SVG](svg/F31-announcements.svg) | [PNG](png/F31-announcements.png)

**Start:** An operator opens Add or Edit Announcement.

1. **Admin / Staff:** Enter announcement content.
2. **Admin / Staff:** Review visibility and preview.
3. **System:** Content valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **System:** Save announcement.
5. **Customer:** Read public announcement.
6. **Admin / Staff:** Edit or retire announcement.
7. **System:** Refresh shared announcement state.

**Alternatives and exceptions**

- At step 3, **No**: Correct content; keep draft. Return to step 2.

**Key rules**

- Public visibility follows the current announcement endpoint and saved settings.
- Announcements communicate information; they do not approve appointments, orders or payments.
- Archive and delete actions remain distinct and explicitly confirmed.

**Related workflows:** F30, F34

## F32 - Reports, letterhead and printing

Generate a report from existing shared records and prepare an official print/PDF output.

[PDF](pdf/F32-reports.pdf) | [Editable](drawio/F32.drawio) | [SVG](svg/F32-reports.svg) | [PNG](png/F32-reports.png)

**Start:** An operator opens Reports.

1. **Admin / Staff:** Choose category and period.
2. **System:** Load matching records and totals.
3. **Admin / Staff:** Review summary and transactions.
4. **Admin / Staff:** Edit letterhead if required.
5. **System:** Report available?.
   Primary route: Yes. See the alternative below before proceeding.
6. **Admin / Staff:** Preview and print or export.
7. **System:** Retain operational source records.

**Alternatives and exceptions**

- At step 5, **No**: Review empty results or load error. Stop this route.

**Key rules**

- Reports derive totals from orders, payments, walk-in sales and refunds; generating a report does not mutate revenue.
- Inventory and Product Stock categories retain their existing period and data rules.
- Letterhead settings and print layout are shared; previews do not submit new transactions.

**Related workflows:** F21, F23, F26, F29

## F33 - Notifications and personal feed state

Distribute eligible system events while keeping operator read and dismissal state personal.

[PDF](pdf/F33-notifications.pdf) | [Editable](drawio/F33.drawio) | [SVG](svg/F33-notifications.svg) | [PNG](png/F33-notifications.png)

**Start:** An event creates an eligible notification.

1. **System:** Create eligible notification event.
2. **System:** Apply recipient and role filters.
3. **Recipient:** Open dropdown or full feed.
4. **Recipient:** Read, mark or dismiss entries.
5. **System:** Save this recipient feed state.
6. **Recipient:** Read updated personal feed.

**Alternatives and exceptions**


**Key rules**

- Admin/Staff read and dismissal timestamps are personal; one operator does not clear another feed.
- Staff cannot view Admin-only notification types. Missing notification-state setup is an error, not shared-state fallback.
- Customer and operator feeds are separate. Email, in-app and optional push channels are not transaction evidence.

**Related workflows:** F07, F09, F13, F25

## F34 - Archives, restoration and permanent cleanup

Move eligible records into Archives, restore them or permanently delete only permitted records.

[PDF](pdf/F34-archives.pdf) | [Editable](drawio/F34.drawio) | [SVG](svg/F34-archives.svg) | [PNG](png/F34-archives.png)

**Start:** An operator selects an archive or cleanup action.

1. **Admin / Staff:** Select records and action.
2. **System:** Records eligible?.
   Primary route: Yes. See the alternative below before proceeding.
3. **Admin / Staff:** Confirm archive, restore or delete.
4. **System:** Recheck and process eligible rows.
5. **System:** Preserve protected financial history.
6. **Admin / Staff:** Review results and skipped records.

**Alternatives and exceptions**

- At step 2, **No**: Read blocker; retain record. Stop this route.

**Key rules**

- Active work, pending cancellations and unresolved money can block archive actions.
- Online refunds and cancellation history retain restore-only protection and are excluded from automatic deletion.
- Automatic retention uses the existing eligible modules and saved period; permanent deletion is not the same as archive.

**Related workflows:** F18, F20, F22, F26

## F35 - Home content management

Edit shared Home content while preserving the existing preview, validation and save behavior.

[PDF](pdf/F35-website-home.pdf) | [Editable](drawio/F35.drawio) | [SVG](svg/F35-website-home.svg) | [PNG](png/F35-website-home.png)

**Start:** An operator opens Home Page Management.

1. **Admin / Staff:** Edit section text and media.
2. **Admin / Staff:** Adjust images; review preview.
3. **System:** Content valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save existing page changes.
5. **System:** Persist and publish shared content.
6. **Customer:** Read updated Home page.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields; retain draft. Return to step 2.

**Key rules**

- Hero, fabrication scene, brand logos, SDGs, service cards and section text retain existing bindings.
- Image adjustment prepares a draft; Save All Changes remains the publication boundary for draft-managed content.
- Operator changes are shared content, distinct from personal sidebar branding.

**Related workflows:** F33

## F36 - About Us content management

Edit shared About Us content while preserving the existing preview, validation and save behavior.

[PDF](pdf/F36-website-about.pdf) | [Editable](drawio/F36.drawio) | [SVG](svg/F36-website-about.svg) | [PNG](png/F36-website-about.png)

**Start:** An operator opens About Us Page Management.

1. **Admin / Staff:** Edit section text and media.
2. **Admin / Staff:** Adjust images; review preview.
3. **System:** Content valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save existing page changes.
5. **System:** Persist and publish shared content.
6. **Customer:** Read updated About Us page.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields; retain draft. Return to step 2.

**Key rules**

- University name, Vision and Mission keep all editable fields, plain text and paragraph breaks.
- A missing Vision or Mission keeps the Customer university section hidden; loading does not display stale content.
- Gallery and video operations retain validation, draft cleanup and save/readback behavior.

**Related workflows:** F33

## F37 - Services content management

Edit shared Services content while preserving the existing preview, validation and save behavior.

[PDF](pdf/F37-website-services.pdf) | [Editable](drawio/F37.drawio) | [SVG](svg/F37-website-services.svg) | [PNG](png/F37-website-services.png)

**Start:** An operator opens Services Page Management.

1. **Admin / Staff:** Edit section text and media.
2. **Admin / Staff:** Adjust images; review preview.
3. **System:** Content valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save existing page changes.
5. **System:** Persist and publish shared content.
6. **Customer:** Read updated Services page.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields; retain draft. Return to step 2.

**Key rules**

- Service cards and categories retain their existing add, edit and delete controls and permissions.
- Custom-product request availability depends on the service eligibility flag and installed custom-product feature.
- Deleting a service or category does not bypass retained-record checks.

**Related workflows:** F33

## F38 - Contact content management

Edit shared Contact content while preserving the existing preview, validation and save behavior.

[PDF](pdf/F38-website-contact.pdf) | [Editable](drawio/F38.drawio) | [SVG](svg/F38-website-contact.svg) | [PNG](png/F38-website-contact.png)

**Start:** An operator opens Contact Page Management.

1. **Admin / Staff:** Edit permitted text and links.
2. **Admin / Staff:** Review fields and preview.
3. **System:** Content valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save existing page changes.
5. **System:** Persist and publish shared content.
6. **Customer:** Read updated Contact page.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields; retain draft. Return to step 2.

**Key rules**

- Contact details and section copy use existing limits and save/readback behavior.
- Editing the Contact page is separate from resolving submitted Customer inquiries in F25.
- Failed saves keep field entries; public readers see saved shared content.

**Related workflows:** F33

## F39 - Footer content management

Edit shared Footer content while preserving the existing preview, validation and save behavior.

[PDF](pdf/F39-website-footer.pdf) | [Editable](drawio/F39.drawio) | [SVG](svg/F39-website-footer.svg) | [PNG](png/F39-website-footer.png)

**Start:** An operator opens Footer Page Management.

1. **Admin / Staff:** Edit permitted text and links.
2. **Admin / Staff:** Review fields and preview.
3. **System:** Content valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin / Staff:** Save existing page changes.
5. **System:** Persist and publish shared content.
6. **Customer:** Read updated Footer page.

**Alternatives and exceptions**

- At step 3, **No**: Correct fields; retain draft. Return to step 2.

**Key rules**

- Footer text, contact details and links keep their existing fields and validation.
- Shared footer changes affect their existing Customer page consumers, not operator personal preferences.
- Failed saves retain drafts; only a successful save establishes the saved shared state.

**Related workflows:** F33

## F40 - Login Portal branding

An Admin configures the existing sign-in branding and previews its appearance.

[PDF](pdf/F40-login-portal-branding.pdf) | [Editable](drawio/F40.drawio) | [SVG](svg/F40-login-portal-branding.svg) | [PNG](png/F40-login-portal-branding.png)

**Start:** An Admin opens Login Portals.

1. **Admin:** Choose Customer or operator portal.
2. **Admin:** Edit branding, copy and imagery.
3. **Admin:** Review live preview.
4. **System:** Branding valid?.
   Primary route: Yes. See the alternative below before proceeding.
5. **Admin:** Save portal appearance.
6. **System:** Persist shared portal settings.
7. **Customer / Guest:** See updated sign-in portal.

**Alternatives and exceptions**

- At step 4, **No**: Correct branding; keep draft. Return to step 2.

**Key rules**

- Login Portal configuration is Admin-only; it does not create or authenticate an account.
- Saved portal branding is shared; personal sidebar title and logo remain separate in F08.
- Preview and discard operations preserve existing drafts and upload limits.

**Related workflows:** F01, F08

## F41 - Payment Methods configuration

An Admin controls the payment methods available to eligible new Customer product orders.

[PDF](pdf/F41-payment-method-settings.pdf) | [Editable](drawio/F41.drawio) | [SVG](svg/F41-payment-method-settings.svg) | [PNG](png/F41-payment-method-settings.png)

**Start:** An Admin opens Payment Methods.

1. **Admin:** Review cash and QR Ph readiness.
2. **Admin:** Enable or disable available methods.
3. **System:** Settings valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Save method availability.
5. **System:** Publish allowed checkout choices.
6. **Customer:** Choose eligible enabled method.

**Alternatives and exceptions**

- At step 3, **No**: Resolve configuration or validation. Stop this route.

**Key rules**

- Payment availability is Admin-only and does not confirm, refund or rewrite existing payments.
- Cash on pickup applies to eligible pickup orders; online readiness depends on the real provider configuration.
- Disabling all methods can pause new product orders. Existing payments retain their recorded workflow.

**Related workflows:** F13, F14, F17

## F42 - Shipping, delivery and tracking settings

Configure delivery coverage, pricing, preparation periods and the current automatic-tracking connection.

[PDF](pdf/F42-shipping-settings.pdf) | [Editable](drawio/F42.drawio) | [SVG](svg/F42-shipping-settings.svg) | [PNG](png/F42-shipping-settings.png)

**Start:** An Admin opens Shipping & Delivery.

1. **Admin:** Edit areas, fees and working days.
2. **Admin:** Review tracking connection readiness.
3. **System:** Draft valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Save draft; approve publication.
5. **System:** Publish current delivery settings.
6. **Customer:** Get eligible shipping quotation.
7. **System:** Keep accepted order snapshot.

**Alternatives and exceptions**

- At step 3, **No**: Correct coverage or configuration. Return to step 1.

**Key rules**

- City choices follow Province; the explicit province-wide option preserves broad coverage.
- Draft and published settings differ. New quotations use published values; accepted quotes are retained.
- Tracking requires the configured 17TRACK account and J&T carrier verification; a preview is not a live delivery test.

**Related workflows:** F13, F16, F43

## F43 - Transaction Policy drafting and publication

Publish an approved version of transaction and refund terms for new Customer acceptance.

[PDF](pdf/F43-transaction-policies.pdf) | [Editable](drawio/F43.drawio) | [SVG](svg/F43-transaction-policies.svg) | [PNG](png/F43-transaction-policies.png)

**Start:** An Admin opens Transaction Policies.

1. **Admin:** Edit transaction and refund text.
2. **Admin:** Review draft and public preview.
3. **System:** Draft valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Confirm approved policy; publish.
5. **System:** Create published policy version.
6. **Customer:** Read and accept at checkout.
7. **System:** Save accepted version on order.

**Alternatives and exceptions**

- At step 3, **No**: Correct draft before publication. Return to step 1.

**Key rules**

- Admin publication creates a version; editing a draft alone does not replace the published policy.
- An order retains its accepted terms/version rather than silently adopting later policy wording.
- Publishing text does not override implemented payment, cancellation or refund guards.

**Related workflows:** F13, F21, F22

## F44 - Email Template customization

Customize permitted notification copy while preserving required transaction data and actual event triggers.

[PDF](pdf/F44-email-templates.pdf) | [Editable](drawio/F44.drawio) | [SVG](svg/F44-email-templates.svg) | [PNG](png/F44-email-templates.png)

**Start:** An Admin opens Email Templates.

1. **Admin:** Choose template.
2. **Admin:** Edit permitted copy and appearance.
3. **System:** Preview valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Save template changes.
5. **System:** Render template when event occurs.
6. **External Provider:** Deliver through configured mail.
7. **Admin:** Read saved template state.

**Alternatives and exceptions**

- At step 3, **No**: Correct content; retain draft. Return to step 2.

**Key rules**

- Email Templates are Admin-only. Template editing does not send a Customer transaction or approve its state.
- Required tokens and protected transactional content retain their existing rules.
- A successful save or preview is not proof of actual SMTP delivery.

**Related workflows:** F09, F13, F33

## F45 - Maintenance controls

An Admin applies existing Customer-facing maintenance scopes and page notices.

[PDF](pdf/F45-maintenance.pdf) | [Editable](drawio/F45.drawio) | [SVG](svg/F45-maintenance.svg) | [PNG](png/F45-maintenance.png)

**Start:** An Admin opens Maintenance.

1. **Admin:** Select affected scopes and notice.
2. **Admin:** Review intended restrictions.
3. **System:** Changes valid?.
   Primary route: Yes. See the alternative below before proceeding.
4. **Admin:** Confirm and save maintenance.
5. **System:** Enforce scopes on requests.
6. **Customer / Guest:** See maintenance notice or open page.

**Alternatives and exceptions**

- At step 3, **No**: Correct settings; keep draft. Return to step 2.

**Key rules**

- Maintenance settings are Admin-only and are enforced by existing request middleware, not only frontend visibility.
- Customer scopes retain their current boundaries; Staff account applications are not blocked by Customer-site maintenance.
- A preview is separate from saving the actual maintenance configuration.

**Related workflows:** F01, F02, F09, F13
