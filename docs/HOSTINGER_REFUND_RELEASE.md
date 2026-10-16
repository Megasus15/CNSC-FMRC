# Refund management update

This update adds a shared Admin/Staff refund workspace, safe failure explanations, explicit retry approval, and refund status checks. Confirmed refunds reduce net revenue; pending and failed attempts do not. A day with only refunds can correctly show negative net collections.

## Deploy

1. Commit the refund changes in GitHub Desktop and push to the connected production branch.
2. In Hostinger, confirm that the deployment for `ucn-fabmanlab.com` completed with that commit.
3. In the production backend directory, run `php artisan optimize:clear` to remove cached routes/configuration. This update adds routes but does not add database migrations. Keep the existing payment reconciliation cron and signed PayMongo webhook configured.
4. Reload Admin and Staff Orders. Open **Online refunds**. The new screen shows approval/processing/attention counts, search, status filters, and one card per payment.

Do not replace the production `.env` with staging values or copy test payment records into production. Existing live credentials remain in the server environment.

## Resolve an existing failed refund

1. Open **Refunds** in the merchant PayMongo dashboard and inspect the original payment/refund. The **Scheduled** value in the Payments settlement column is a merchant payout status, not a refund status. Do not issue a second refund if PayMongo already has one pending or completed.
2. Open **Online refunds** in FMRC and select the order. Older failed attempts may say that their original failure reason was not saved. This update cannot reconstruct a past API error.
3. If no refund exists in PayMongo and the underlying issue is resolved, an Admin can choose **Review & retry refund**, review the amount, and confirm **Retry and issue refund**. Staff can request a retry for Admin approval. The system uses the original provider payment; no customer wallet number is needed.
4. If the provider rejects the new attempt, the card shows a safe explanation and error code when available. Do not keep retrying unchanged failures. For insufficient funds, ask PayMongo which payout funds are available for the refund; the dashboard wallet balance alone is not proof of refund eligibility.
5. For an existing processing refund, choose **Check refund**. This retrieves its status without submitting another refund. The scheduled reconciliation worker also updates pending refunds.
6. After provider confirmation, verify the refund reference in PayMongo, ask the customer to check the original wallet transaction history, and check Admin/Staff net revenue. A confirmed amount is deducted once. A failed/pending amount is not a completed refund.

PayMongo lists QR Ph refunds below PHP 50,000 as real time after successful processing. That is not a guarantee that a rejected API request will return money. See [PayMongo refund guide](https://docs.paymongo.com/docs/payment-acceptance-refunds) and [refund statuses](https://docs.paymongo.com/reference/refund-resource).

## Verification boundary

Automated tests and local browser fixtures use fake provider responses. They do not transfer funds, deploy changes, or prove that an existing production refund has reached a customer's wallet. Production verification requires the actual provider refund record.
