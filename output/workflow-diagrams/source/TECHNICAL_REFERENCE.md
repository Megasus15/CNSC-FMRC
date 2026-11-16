# Technical reference and interpretation

Baseline: `c499fa5d03fc89ef8dc10ab828c4f1b3df4b35b4`, reviewed 15 November 2026.
Read `SOURCE_REGISTER.md` for exact code anchors. These are source-reviewed process descriptions,
not evidence of a live provider transaction or a new execution of the application's workflow tests.

## Responsibility and permissions

| Area | Customer / Guest | Staff | Admin |
| --- | --- | --- | --- |
| Service consultation | Public booking where allowed; own booking changes require existing verification | Review, meeting details and completion | Same operator workflow |
| Custom-product request | Signed-in intake, own brief/quotation decisions, payment and status | Consultation, quotation and production actions | Same, plus guarded cash correction/refund actions |
| Normal product order | Own checkout request, payment, cancellation and eligible return/review | Request review, preparation, handover and existing operational actions | Same, plus restricted financial decisions |
| Online refund | Read own eligible payment/refund details and provider claim | Submit eligible refund/retry request and read status | Issue, approve or reject under server guards |
| User Management / Staff requests | Submit Staff application; no user-management access | No user-management page | Full Admin authority, protected accounts retained |
| Shared inventory, products and content | Read permitted public content | Existing shared management permissions | Existing shared management permissions |
| Login branding, payment configuration, email templates, maintenance | Consume published settings | No write authority | Configure within existing guards |
| Personal account / Settings | Own Customer profile | Own operator preferences and credentials | Own preferences and credentials; recovery codes |

Combined `Admin / Staff` lanes mean the shared operational permission only. They do not grant Staff
an Admin-only action. A separate Admin lane or rule marks restricted decisions. Every server endpoint
still rechecks role, ownership, current state and installed storage.

## F09 and F10: the two appointment journeys

F09 is an ordinary service consultation. F10 links consultation to custom-product specifications,
quotation and one resulting Order. Online and face-to-face are meeting methods within a journey.

`AppointmentProductController::outcome()` requires the attended, completed discussion before
`ready_for_quote`. A saved meeting URL does not prove attendance. More information, follow-up and
decline are alternatives to quotation. Only a current eligible quotation can be accepted.

Acceptance creates one linked Order. Switching an eligible unpaid payment choice retains that Order.
Production requires full confirmed online payment or a full advance-cash receipt recorded at FMRC.
Closing and re-quoting must respect existing held money, checkout reconciliation and refund blockers.

Intake, private uploads and old appointment claim links have their existing sign-in, ownership,
feature, storage and validation requirements. The high-level diagram does not waive those checks.

## F13-F17: request approval, payment and completion

- A new normal order starts as an FMRC review request. Approval reserves/decrements stock under
  the existing rules; it is separate from **Start preparation**.
- New normal orders use the enabled online path or eligible cash on pickup. Delivery uses the
  eligible online path. Custom advance cash is a separate path in F17.
- Checkout creation, browser return, a screenshot or a typed reference is not provider-confirmed
  payment. `GatewayPayments` and the webhook/reconciliation controller establish the paid result.
- Pending, unknown, duplicate and late payments need their existing checks before another attempt.
- Pickup completion is recorded by FMRC after code, receipt and hold checks. The Customer endpoint
  cannot force an order complete.
- Current automatic J&T completion uses verified 17TRACK delivery evidence, matching active tracking
  registration and account/carrier configuration. FMRC notes cannot replace courier events.
- An accepted shipping quote remains the Customer's agreement. A later courier charge does not
  silently change it.

## F18-F22: cancellation, returns and refunds

Cancellation availability is rechecked under an order lock. Eligible immediate cases bypass operator
review. Other eligible cases create a pending request; only an approved decision closes that route.
A declined request leaves the order under its current workflow. Cancellation success and refund
success are separate results.

Returns retain the current seven-day completion window and one-open-return safeguard. Refund
eligibility for a completed order requires the approved return to be received and inspected.
Repair/replacement resolution labels exist; recording one does not automatically implement a new
repair/replacement fulfillment lifecycle. Do not present such a lifecycle as completed functionality.

Online refunds require a verified provider receipt and available refundable balance. Staff can submit
an eligible request; issuing, approval and rejection require Admin authority. A requested or processing
refund is not confirmed money returned. Failed or unknown attempts must be checked/reconciled before
retry. QR Ph completion depends on the provider's claim process and an adequately funded merchant
wallet; a scheduled payout is not an available wallet balance.

Refunded-order review (F20) closes eligible normal active orders whose full refund is already confirmed.
It does not issue a second refund. Existing handover, collection, completion, cancellation and money
evidence can block that action. Stock release is accounted for once.

## Other process boundaries

- Walk-in records preserve the existing `WALKIN VIA CASHIER` payment meaning; saving one is not a
  hosted online checkout. Linked product stock uses the current transaction behavior.
- Inventory variant quantities belong to each variant and unit. They are not added into a misleading
  mixed-unit total. Low-stock inheritance is variant, item, category, then default.
- Product visibility retains the actual `is_blocked` meaning. A visual label does not invert the saved value.
- Inquiries have read and resolved states. The documented implementation does not add an in-app
  conversation thread or a new reply transport.
- Operator notification read/dismissal state is personal; shared events are not globally cleared by one
  operator. Customer notification endpoints are separate.
- Archives retain active-work and financial safeguards. Protected online-refund/cancellation history
  does not become eligible for automatic permanent cleanup merely by being archived.
- Shared site settings and personal portal preferences are different data scopes. Previewing a draft
  is not publication. Versioned shipping/policy settings preserve accepted order snapshots.
- Reports derive totals from recorded transactions. Rendering/printing a report does not book revenue.

## Compatibility and deployment boundary

Legacy COD, manual references and older courier implementations may remain for historical records.
They are not the default newly created transaction routes in this pack. Google identity, CAPTCHA,
email, optional custom-product intake, push, checkout and courier tracking require their real server
configuration. No provider credentials or production customer data are included in this documentation.

## Maintaining the pack

Update `workflows.json`, review affected code and tests, then rebuild with `generate.py`.
The generator validates source anchors, role lanes, decision alternatives, node/connector separation,
native draw.io cell references, searchable PDFs, bookmarks and relative links. Follow that with visual
inspection of the rasterized pages. The baseline date/commit must be reviewed whenever process rules change.

The external diagrams.net import check was blocked by automatic approval review because it would
transmit the repository artifact to a third party. Local XML validation and PDF/PNG visual checks are
documented separately; no claim of a completed third-party editor import is made.
