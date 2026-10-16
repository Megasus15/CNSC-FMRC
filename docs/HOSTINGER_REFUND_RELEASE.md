# Refund management update

This update adds a shared Admin/Staff refund workspace, safe failure explanations, explicit retry approval, and refund status checks. Confirmed refunds reduce net revenue; pending and failed attempts do not. A day with only refunds can correctly show negative net collections.

The 2026-10-16 correction uses PayMongo's separate live QR Ph creation endpoint, `https://refunds-api.paymongo.com/v1/refunds`. The standard refund endpoint is retained for direct GCash and existing standard API attempts. QR Ph refunds generate a customer claim link: they are not an automatic reversal to the wallet that scanned the payment QR.

## Deploy

1. Commit the refund changes in GitHub Desktop and push to the connected production branch.
2. In Hostinger, confirm that the deployment for `ucn-fabmanlab.com` completed with that commit.
3. In the production backend directory, run `php artisan optimize:clear` to remove cached routes/configuration. No new database migration is needed for this correction. Keep the existing payment reconciliation cron and signed PayMongo webhook configured. In PayMongo, enable `refund.succeeded` on the live webhook; also enable refund updates/failures where available.
4. Reload Admin and Staff Orders. Open **Online refunds**. The new screen shows approval/processing/attention counts, search, status filters, and one card per payment.

Do not replace the production `.env` with staging values or copy test payment records into production. Existing live credentials remain in the server environment.

## Resolve an existing failed refund

1. Open **Refunds** in the merchant PayMongo dashboard and inspect the original payment/refund. The **Scheduled** value in the Payments settlement column is a merchant payout status, not a refund status. Do not issue a second refund if PayMongo already has one pending or completed.
2. Open **Online refunds** in FMRC and select the order. Older failed attempts may say that their original failure reason was not saved. This update cannot reconstruct a past API error.
3. For QR Ph, ensure the merchant's PayMongo wallet has enough **available** funds. The scheduled payout balance is not available wallet money. The account owner can use PayMongo's wallet funding controls or wait for settlement into the wallet. FMRC does not automatically move or top up merchant funds.
4. If no refund exists in PayMongo and the underlying issue is resolved, an Admin can choose **Review & retry refund**, review the amount, and confirm **Retry and issue refund**. Staff can request a retry for Admin approval. Existing `parameter_invalid` attempts remain in history; the corrected retry creates a new request.
5. For an existing processing refund, choose **Check refund**. This retrieves its status without submitting another refund. The scheduled reconciliation worker also updates pending refunds.
6. Once PayMongo creates the QR Ph refund, the customer opens **My Orders > Payment details > Claim refund**. The secure PayMongo form lets the customer choose a receiving bank or e-wallet such as GCash. The customer must complete the form within **3 days**. Admin/Staff can copy the link for that customer; claim links must only be shared with the corresponding customer.
7. After provider confirmation, verify the refund reference in PayMongo, ask the customer to check the receiving wallet or bank transaction history, and check Admin/Staff net revenue. A confirmed amount is deducted once. Creating a claim link or receiving a `processing` status does not deduct a completed refund.

See [PayMongo's QR Ph refund flow](https://docs.paymongo.com/docs/qrph-refunds): the merchant wallet needs sufficient available balance, the generated transfer link is valid for 3 days, and the refund succeeds after the customer claims it. Expired or declined transfers can fail. A rejected API request has not sent a refund.

## Automatic status updates

Signed refund webhooks are verified against the provider immediately. The Customer payment dialog polls every 3 seconds; the Admin/Staff workspace polls every 5 seconds. Open order/payment pages retrieve due existing refund records at a 10-second interval, one per visible page/request, with the reconciliation cron as fallback. Open Admin/Staff dashboards check a payment-ledger revision every 10 seconds and reload revenue when it changes. Provider/network delays and many pending refunds can extend the time to reflect a change. Status checks never submit a new refund.

If QR Ph creation times out without a refund reference, the amount stays reserved and automatic POST retries stop. Use **Match provider refund** with a verified provider reference, or resolve the uncertain attempt with PayMongo before any new refund. Deploying this correction does not automatically reissue failed refunds.

## Verification boundary

Automated tests and local browser fixtures use fake provider responses. They do not transfer funds, deploy changes, or prove that an existing production refund has reached a customer's wallet. Production verification requires the actual provider refund record.
