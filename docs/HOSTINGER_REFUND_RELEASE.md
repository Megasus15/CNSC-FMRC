# Refund management update

This update adds shared Admin/Staff cancellation and refund tables, direct Admin refund issuing, safe failure explanations, explicit retry approval, and refund status checks. Confirmed refunds reduce net revenue; pending and failed attempts do not. A day with only refunds can correctly show negative net collections.

The 2026-10-16 correction uses PayMongo's separate live QR Ph creation endpoint, `https://refunds-api.paymongo.com/v1/refunds`. The standard refund endpoint is retained for direct GCash and existing standard API attempts. QR Ph refunds generate a customer claim link: they are not an automatic reversal to the wallet that scanned the payment QR.

The wallet-funding correction checks the live default wallet's **available** balance before submitting a QR Ph refund. Insufficient funds, an inactive wallet, or an unavailable balance leaves the request awaiting approval; no refund POST is sent. After funding, Admin issues that same pending request. The Orders payment-status area shows wallet availability, cached for 15 seconds; approval always checks it afresh. Pending settlement and balances in other wallets are excluded. Provider rejection and confirmation still control the final result.

The earlier error mapper treated any response containing `exceeds` as an over-refund. It now distinguishes wallet funds from an excessive payment refund. Older generic errors with that ambiguous saved message show an unverified cause, since the original provider detail was not retained. Historical refund attempts are preserved.

Local patch files: `backend/app/Services/PayMongoService.php`, `backend/app/Services/GatewayPayments.php`, `backend/app/Support/RefundStatus.php`, `backend/app/Http/Controllers/Api/GatewayManagementController.php`, `admin-page/gateway-payments.js`, and both Orders HTML files. No schema change. Code checks do not fund the merchant wallet, deploy the patch, or issue a live refund.

## Deploy

### Receive and refund in one action

Online returns with an approved **Refund** resolution now have one icon. Admin uses **Receive & refund**; Staff uses **Receive & request refund**. This replaces the separate receive and online-refund icons. Button labels stay on one line; whole buttons wrap to another right-aligned row on narrow screens. Open it, confirm **Item received and inspected**, add an inspection note if needed, review the refund amount, and confirm once. The same form works while the item is marked Approved or Item in transit. An item already marked received skips the receipt fields.

Receipt, its audit event and the refund reservation save in one database transaction. Invalid amounts or the wrong resolution roll back that transaction. Provider submission happens afterward: Admin issues directly, while Staff requests Admin approval. A pending or uncertain refund blocks another request, even with a different request key. Repeating the same request does not record receipt or send money twice. Payments and revenue change only after provider confirmation.

If funding or provider setup blocks submission, the receipt and the existing refund request remain saved. The dialog explains the next step. Continue with that request in **Online refunds** after resolving the issue; do not create another refund. Failed claims still use the existing reviewed retry. Replacement and Repair returns must be explicitly changed to Refund before any money can be sent.

Deploy `backend/app/Http/Controllers/Api/OrderReturnController.php`, `backend/app/Services/GatewayPayments.php`, `backend/app/Support/ReturnPresenter.php`, `admin-page/orders.js`, `admin-page/admin-modules.css`, `admin-page/orders.html`, and `staff-page/orders.html` together. Clear cached application code as described below and reload Orders in both portals. No migration is needed. Automated checks use fake provider responses; deploying this change does not issue refunds or prove a live customer received funds.

### Claim failed after the customer submitted it

The 2026-10-17 live test for **ORD-261017-00080** reached the PayMongo claim form, then failed. Read-only provider checks found a failed **PHP 1.00** InstaPay transfer to the selected G-Xchange account with **AC06 / BlockedAccount**, at the same time as the failed refund. The wallet was activated with PHP 30.00 available when checked. PayMongo's code means the receiving account was reported blocked; it does not explain why or prove that the entire GCash account is locked. The customer must have GCash resolve the restriction, or choose another active receiving account for a reviewed new claim. FMRC cannot remove a receiving-account block. Do not send a second refund while the first is pending or has an uncertain outcome.

The same live refund was present in its original payment's `attributes.refunds`, but both standalone refund lookup endpoints returned 404. Status reconciliation now falls back to a GET of the original payment and matches the exact refund ID, payment ID and live mode. Amount and currency remain checked before changing financial state. Failed claims lose their unusable claim link and become eligible for the existing reviewed retry; succeeded refunds still require provider confirmation. No refund POST is sent by a status lookup, and no transfer is guessed from an unrelated transaction.

Deploy `backend/app/Services/PayMongoService.php`, `backend/app/Services/GatewayPayments.php`, and `backend/app/Http/Controllers/Api/GatewayManagementController.php`, then clear cached code/configuration as required by the release steps below. No migration or new frontend layout is needed. In Admin **Online refunds**, find this order and use **Check refund**. It should show **Failed** before a new attempt is considered. Resolve the receiving-account issue first. **Retry refund** creates a new claim after explicit Admin approval; the old failed claim link cannot be reused.

For PayMongo's meaning of AC06, see [Transfer error codes](https://docs.paymongo.com/docs/money-movement-error-codes). The receiving account can appear as **G-Xchange, Inc.** rather than GCash in the claim dropdown.

### Approved return has the wrong resolution

An approved **Replacement** or **Repair / Rework** is not approval to refund money. Adding a refund note does not change its resolution. The existing return review form now includes **Resolution**. For an already approved return, Admin uses the same gavel icon (**Change Resolution**), chooses **Refund**, enters the agreed reason, and saves. This preserves the received-item status, inspection date and approved amount, writes an audit event, and notifies the customer. It sends no money. Staff cannot change an approved resolution. Closed returns, processing refunds and reserved refund requests block changes. The refund icon is available only for a Refund resolution.

For the live test return **RTN-261017-00032 / ORD-261017-00080**, deploy these files before continuing: `backend/app/Http/Controllers/Api/OrderReturnController.php`, `backend/app/Support/ReturnPresenter.php`, `backend/routes/api.php`, `admin-page/orders.js`, `admin-page/orders.html`, and `staff-page/orders.html`. Clear the route cache with `php artisan optimize:clear`, then reload Orders. Admin changes the resolution to Refund, saves it, and opens **Issue refund** for **PHP 1.00**. The earlier resolution error occurs before creating a provider refund request; it is not a PayMongo rejection. No migration or new customer payment is needed.

### Release steps

1. Commit the refund changes in GitHub Desktop and push to the connected production branch.
2. In Hostinger, confirm that the deployment for `ucn-fabmanlab.com` completed with that commit.
3. In the production backend directory, run `php artisan optimize:clear` to remove cached routes/configuration. No new database migration is needed for this correction. Keep the existing payment reconciliation cron and signed PayMongo webhook configured. In PayMongo, enable `refund.succeeded` on the live webhook; also enable refund updates/failures where available.
4. Reload Admin and Staff Orders. Open **Cancellations** and **Online refunds**. Both use searchable tables with consistent buttons and fonts. Online refunds includes approval/processing/attention counts and status filters. The new asset versions refresh the shared scripts/styles in both portals.

Do not replace the production `.env` with staging values or copy test payment records into production. Existing live credentials remain in the server environment.

## A paid customer asks to cancel

1. A new request appears in **Orders > Cancellations**, with an alert above the tabs. The table shows the order, customer, request time, exact customer reason, payment and decision. Order Details also shows the cancellation reason at the top. This queue uses the existing live order refresh.
2. For a paid online order, an Admin selects **Cancel & refund**, then confirms **Cancel order & issue refund**. This closes the order, restores stock once, queues its eligible refund and sends it to PayMongo. There is no second Admin approval. Staff sees **Cancel & request refund**, which closes the order and queues the refund for Admin approval.
3. **Decline** requires a note that the customer can read. The order continues when the cancellation is declined. While a cancellation is awaiting a decision, normal fulfillment approval/tracking changes and separate refund requests are blocked so the request must be handled explicitly.
4. Open **Online refunds** to follow the provider outcome. If cancellation was saved but the refund needs attention, the decision stays saved and the screen tells the operator to continue in Online refunds. Do not submit the cancellation again.
5. The customer opens **My Orders > Payment details > Claim refund** after PayMongo creates the claim link. Completing that provider form is required for QR Ph funds to reach the chosen receiving account. Cancelling an order alone does not prove money was returned.

For other eligible online payments and approved product returns, Admin's **Issue refund** sends the refund directly; Staff's **Request refund** sends it for Admin approval. The Order Details action is now **Payment & refund details**, styled with the shared Admin button classes; pending cancellations instead lead directly to **Review customer cancellation**. Refund dialogs use the same Poppins font as the Admin/Staff pages, with shared close and footer controls.

## Resolve an existing failed refund

1. Open **Refunds** in the merchant PayMongo dashboard and inspect the original payment/refund. The **Scheduled** value in the Payments settlement column is a merchant payout status, not a refund status. Do not issue a second refund if PayMongo already has one pending or completed.
2. Open **Online refunds** in FMRC and select the order. Older failed attempts may say that their original failure reason was not saved. This update cannot reconstruct a past API error.
3. For QR Ph, ensure the merchant's PayMongo wallet has enough **available** funds. The scheduled payout balance is not available wallet money. The account owner can use PayMongo's wallet funding controls or wait for settlement into the wallet. FMRC does not automatically move or top up merchant funds.
4. If no refund exists in PayMongo and the underlying issue is resolved, an Admin can choose **Retry refund**, review the amount, and confirm **Retry and issue refund**. Staff can request a retry for Admin approval. Existing `parameter_invalid` attempts remain in history; the corrected retry creates a new request. Use **Details** for full refund history and any saved provider failure information.
5. For an existing processing refund, choose **Check refund**. This retrieves its status without submitting another refund. The scheduled reconciliation worker also updates pending refunds.
6. Once PayMongo creates the QR Ph refund, the customer opens **My Orders > Payment details > Claim refund**. The secure PayMongo form lets the customer choose a receiving bank or e-wallet such as GCash. The customer must complete the form within **3 days**. Admin/Staff can copy the link for that customer; claim links must only be shared with the corresponding customer.
7. After provider confirmation, verify the refund reference in PayMongo, ask the customer to check the receiving wallet or bank transaction history, and check Admin/Staff net revenue. A confirmed amount is deducted once. Creating a claim link or receiving a `processing` status does not deduct a completed refund.

See [PayMongo's QR Ph refund flow](https://docs.paymongo.com/docs/qrph-refunds): the merchant wallet needs sufficient available balance, the generated transfer link is valid for 3 days, and the refund succeeds after the customer claims it. Expired or declined transfers can fail. A rejected API request has not sent a refund.

## Automatic status updates

Signed refund webhooks are verified against the provider immediately. The Customer payment dialog polls every 3 seconds; the Admin/Staff workspace polls every 5 seconds. Open order/payment pages retrieve due existing refund records at a 10-second interval, one per visible page/request, with the reconciliation cron as fallback. Open Admin/Staff dashboards check a payment-ledger revision every 10 seconds and reload revenue when it changes. Provider/network delays and many pending refunds can extend the time to reflect a change. Status checks never submit a new refund.

If QR Ph creation times out without a refund reference, the amount stays reserved and automatic POST retries stop. Use **Match provider refund** with a verified provider reference, or resolve the uncertain attempt with PayMongo before any new refund. Deploying this correction does not automatically reissue failed refunds.

## Verification boundary

Automated tests and local browser fixtures use fake provider responses. They do not transfer funds, deploy changes, or prove that an existing production refund has reached a customer's wallet. Production verification requires the actual provider refund record.
