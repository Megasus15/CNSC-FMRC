# Custom-product payment and fulfillment flow

Custom products use the same Orders, Payments, PayMongo checkout, signed payment confirmation, online refund ledger, and customer Payment details as Product Page orders. Custom production has additional consultation and quotation checks.

## Customer and FMRC steps

1. The customer requests custom work with an appointment and attends the consultation.
2. Admin/Staff confirms the discussion and sends a quotation containing the final specifications, quantity, price, shipping fee, fulfillment arrangement, and lead time.
3. The customer accepts the quotation and current transaction terms. This creates one linked custom order in My Orders. Retrying acceptance reuses that order.
4. The customer chooses either online payment or full advance cash payment at FMRC. Online availability follows Website Payments and the configured provider. Advance cash is distinct from ordinary cash on pickup and can fund a delivery order.
5. Online payment opens the same provider-hosted checkout used for catalog orders. Only a verified provider payment confirms it; a redirect, screenshot, or typed reference cannot mark it paid. For advance cash, Admin/Staff records the exact full amount and receipt after receiving the money.
6. Admin/Staff starts production only after the full agreed payment is confirmed, then marks the product ready.
7. For pickup, Admin/Staff checks the customer's pickup code and confirms physical collection. For delivery, staff records the genuine J&T handover and tracking number once; the current verified 17TRACK shipment supplies courier updates and Delivered completion.
8. Completion starts the existing seven-day return window. Customers cannot complete orders themselves. External TikTok parcel tests do not complete genuine FMRC orders.

The accepted quotation remains the order's price and specification snapshot. A paid agreement cannot be silently edited: resolve the old order and its funds before closing and re-quoting. Catalog inventory is not deducted for the custom order's fabrication line.

## Payment changes and exceptions

- An unpaid customer can switch between online and advance cash. FMRC first reconciles and closes the old checkout so two methods cannot collect the same amount.
- Disabling online payment prevents new online quotation acceptance and cash-to-online switching. It does not erase existing payments or refund records.
- Unknown checkout outcomes stay under review. A late payment for expired or withdrawn specifications is recorded but does not authorize production.
- Admin can correct an advance-cash receipt before production. After production begins, use the appropriate cancellation or return/refund process.

## Returns and refunds

The customer requests a return from the completed custom order in My Orders. Admin/Staff reviews the request and records receipt and inspection of the returned item.

**Online payment:** use the shared Returns & Refunds / Online refunds controls. Staff can request a refund; Admin approves issuance. The refund remains pending until the provider confirms success. A QR Ph claim link, when supplied by the provider, appears in the same customer Payment details used by regular orders. A pending claim is not a completed refund.

**Advance cash:** Admin uses **Record cash refund**, confirms the item was received and inspected, and enters the amount and cash refund receipt reference only after returning the cash. This records an actual payment out; it does not send an online transfer. The action is limited by both the remaining approved return amount and the unrefunded cash held for the order. Partial refunds accumulate and keep the return open; duplicate receipt requests do not record a second refund. Each release appears in the cash ledger and return history.

Cancellation refunds for advance-cash orders remain available to Admin in the custom-order section after cancellation/rejection. An online payment always uses the online refund workflow.

## Local verification and hosted rollout

`OptionalAppointmentProductsTest` covers quotation acceptance, one linked order, online availability, hosted QR Ph checkout, duplicate signed confirmations, payment-method switching, expired agreements, cash receipts, production, pickup, 17TRACK delivery, and connected cash/QR Ph/GCash returns and refunds. Shared gateway tests cover additional payment identity, refund approval, amount, wallet, retry, and provider-failure checks.

The browser fixtures exercise the actual shared portal scripts without using live customer data:

```powershell
# From backend:
php artisan test --compact --filter="OptionalAppointmentProductsTest|GatewayPaymentsTest|OrderReturnResolutionTest"
php artisan test --compact
# From the repository root, one browser suite at a time:
node --test backend/tests/Frontend/appointment-products.browser.cjs
node --test backend/tests/Frontend/custom-order-refunds.browser.cjs
```

Deploy the changed application and versioned canonical assets together. This payment review adds no database migration. Existing orders, receipts, agreed prices, and provider refund records are retained.

For the hosted tracking configuration, `TRACK17_ENABLED=true` enables the backend switch. Save the environment and run `php artisan config:clear` from `backend`. Keep `TRACK17_ALLOW_DEMO_HANDOVER=false` and the existing minute-based `shipments:process` cron. Live Admin activation still requires genuine FMRC parcel verification, a signed live webhook, a healthy worker, and available registration budget. An isolated external-parcel diagnostic does not satisfy those live checks.

Local fixtures do not prove that hosted cron, a real payment/refund, or genuine FMRC parcel delivery worked. Verify those separately using a clearly identified owned transaction and genuine handover before declaring the live flow complete.
