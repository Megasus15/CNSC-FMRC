# Orders dialog and workspace refinement

Orders in both portals opts into the existing cream / maroon popup presentation.
`orders-ui.js` decorates the existing dialog nodes once; it does not replace forms,
field IDs, financial eligibility, request payloads or operational owners. Staff
uses the same scripts and stylesheet as Admin.

Full dialogs have a header close control, fixed header/footer and one scrollable
body. Complex Order Details uses a 1,040px frame; form dialogs use 800px and compact
confirmations use 480px. Compact confirmations and refund-retry popups have no X.
Closing calls each existing cancel handler, including walk-in/tracking/return
discard guards. Pending requests block dismissal. Native rejection/payment
dialogs retain browser top-layer semantics and now participate in the shared
scroll/focus controller through its additive `native` visibility mode. Other
pages retain their existing presentation.

The Incoming Orders search filters before pagination. Table searches use the
shared icon treatment and short Search placeholder at the right edge. The review
queue now says Priority review; Incoming Orders explains payment requirements
and preparation. Order Records, Walk-in Sales and Online Refunds use consistent
navigation. Cancellations counts all visible, non-archived cancellation records;
the separate urgent alert still counts only pending decisions. Synced records are
deduplicated by order ID.

## Validation and release

Run the browser fixture suites for Orders UI, review, refund restrictions,
dialog refresh, guided workflows, tracking, filters and custom refunds. Run the
payment verification, customer payment, return resolution and rejected-routing
unit suites, plus shared Inventory/Product dialog regressions. The new UI suite
covers both roles at 320, 390, 768, 1024 and 1440px, dark mode, short landscape,
zoom-equivalent layout, text spacing, native payment history, no-X confirmations,
decided cancellation counts and nested walk-in validation/discard recovery.

Backend regression coverage includes OrderRequestReviewTest,
OrderRefundRestrictionsTest, OrderCancellationRulesTest, GatewayPaymentsTest,
OrderReturnResolutionTest, OnlineRefundArchiveTest, OrderPaymentVerificationTest,
OrderDeliveryFlowTest, RejectedOrderRoutingTest, WalkInOrderArchiveTest,
Ship24TrackingTest and AdminOrdersIndexPayloadTest. These run against SQLite
in-memory with provider fakes, never a live payment provider.

Release the matching portal shells and shared scripts via commit, push and the
existing online deployment. Controller consumers carry its new cache version;
the Orders-only assets carry their own version. No API, migration, Composer or
other dependency change is required. Compare hosted assets separately from local
fixture verification; hosted asset parity is not a real refund/payment test.
