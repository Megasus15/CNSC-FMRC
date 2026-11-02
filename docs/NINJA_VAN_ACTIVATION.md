# Ninja Van booking and tracking

Local integration is implemented; production booking is disabled by default. Manual courier tracking remains available.

## Release requirements

1. Apply the three commerce migrations after backup and verify all tables/columns. Shipping and policy publication can be enabled independently of courier booking.
2. Complete Ninja Van account onboarding, contract/rates, integration audit and production approval. Obtain separate sandbox and production client credentials. Keep secrets in the deployment environment.
3. Configure the actual FMRC sender address/contact and account-approved delivery time slots in `NINJAVAN_*`. Configure pickup time slots only if collection at FMRC is approved. Staff must supply actual parcel kg/cm and a dispatch date; no fabricated parcel dimensions are used.
4. Enable sandbox only, register HTTPS `POST /api/webhooks/ninjavan`, and test booking, duplicate requests, uncertain results, signed events and cancellation. Sandbox uses the Singapore API host even for Philippine destination addresses; its tracking simulation is limited to Pending Pickup and Cancelled. Verify the remaining lifecycle with Ninja Van during the integration audit.
5. After approval, set production credentials/environment and `NINJAVAN_PRODUCTION_APPROVED=true`; enable booking only after a reviewed production smoke test. Check a real shipment from booking through courier pickup, tracking, delivery and COD settlement before claiming live end-to-end support.

The [official Ninja Van API documentation](https://api-docs.ninjavan.co/) defines the OAuth, versioned booking/cancellation API, environment hosts, raw-body HMAC header and account audit requirements. Reconfirm these with the provider before activation.

## Operational behavior

- Admin and Staff share one parcel/booking interface. Eligible accepted delivery orders can be booked; online orders require confirmed payment. Pickup orders use no courier.
- A persisted reference and requested tracking identifier survive timeouts and retries. Unknown results require checking the same reference; the UI never creates another identifier merely because a request timed out. An operator can link a provider-prefixed tracking number belonging to that original reference. A signed event still confirms the courier status.
- Cancellation is offered only while the provider has confirmed Pending Pickup (or a previous cancellation result is uncertain). Rejected local bookings can be discarded. Canceling a shipment does not cancel the order or refund a payment.
- Webhook verification uses base64 HMAC-SHA256 over the exact raw body and `X-Ninjavan-Hmac-Sha256`. Events are deduplicated and older events are retained without rolling current status backward. Courier status never marks payment paid, refunds money, or completes an order.
- Customer tracking contains only the status, tracking reference and safe timeline. Sender/recipient payloads, booking attempts and actual booking charges remain operational data. FMRC absorbs any difference between the accepted customer fee and actual booking cost.

## Local verification

`NinjaVanShippingTest` uses HTTP fakes, an isolated database and fake credentials. It covers authorization, production gates, stable retries, simultaneous clicks, booking/webhook races, signature rejection, duplicate/delayed events, cancellation, return-to-sender, manual-tracking protection and unchanged customer totals. It does not call Ninja Van or establish live account readiness.
