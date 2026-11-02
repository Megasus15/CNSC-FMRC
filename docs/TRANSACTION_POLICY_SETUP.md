# Step 3: Transaction terms and refund policy

The Customer documents have separate pages at
`/products-page/transaction-terms.html` and `/products-page/refund-policy.html`.
Checkout says **I agree to the Transaction
Terms and Refund Policy**, with maroon, underlined links. Both links open a new
tab using `target="_blank"` and `rel="noopener noreferrer"`, preserving the
current checkout. Each link opens its own document from the same published
version. Both pages support the `version` query parameter, so an order's accepted
wording remains retrievable. Switching between documents keeps that version.
Older combined-page links ending in `#transaction-terms` redirect to the terms
page with the version intact.

Admin and Staff have **Website Management → Transaction Policies**. Admin can
edit, save, preview, and publish a draft after explicitly confirming FMRC
approval. Staff reads published wording only. Proposed wording supplied by the
application stays in the Admin draft; it is not automatically published.
The settings response identifies whether the draft has been saved. Admin can
review the unchanged starting text, confirm FMRC approval, and publish it without
making an artificial edit. The first publication saves that exact reviewed draft
and its published version in one database transaction. The API checks the reviewed
text against the current starting draft and rejects stale revisions or missing
approval. Edited wording must be saved before publishing. Save starts disabled
until wording changes. Both portals link to the separate Customer pages.

The proposed wording covers transactions, delivery/pickup, cancellations,
customized products, eligible concerns, return arrangements, shipping-fee
treatment, and refund processing. It preserves applicable consumer remedies and
does not promise an invented processing deadline. FMRC must approve the final
wording before activation. References reviewed for the proposed draft:

- [DTI guidance on returns and consumer remedies](https://fairtrade.dti.gov.ph/faq/is-no-return-no-exchange-policy-allowed/).
- [Internet Transactions Act, including consumer remedies](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96902).

Customers must explicitly tick the agreement box. Checkout verifies the latest
published version again before submission. A version change clears prior
acceptance and updates both links. Unpublished or unavailable policy states keep
ordering disabled. Closing checkout resets the agreement; opening the policy in
another tab does not accept the policy or discard the order draft.
Waiting customers can use **Check availability**, or return to an open checkout
after publication, to retrieve the published policy. The checkbox then becomes
available but remains unchecked until the customer explicitly agrees. The two
policy pages also provide a check-availability action before publication.

Order creation locks the current publication and stores its title, terms, refund
text, version, and the server acceptance timestamp. A stale version or missing
agreement returns `409 policy_changed` before an order, stock movement, or payment
attempt is created. Historical orders keep null acceptance fields. Existing
refund eligibility, Admin/Staff permissions, and provider-confirmed completion
remain authoritative.

## API and release

- Public: `GET /api/commerce/policy/{version?}`; only published content is exposed.
- Admin/Staff reads: `GET /api/admin/commerce-policy`.
- Admin writes: `PUT /api/admin/commerce-policy/draft` and
  `POST /api/admin/commerce-policy/publish`, with revision checks and explicit
  approval for publication.
- Checkout now sends `policy_version` and `policy_accepted`.
- Authorized order details return the immutable `accepted_policy` snapshot.

Apply `2026_11_02_000002_add_transaction_policy_snapshots.php` on the target and
deploy the PHP and versioned canonical assets together. This creates publication
history, a private draft singleton, and nullable acceptance columns on orders;
it does not fabricate historical consent. Publish only FMRC-approved wording
before enabling new checkout. No production publication was performed here.

Local QA: the combined policy/shipping/payment backend run passed 130 tests.
Policy acceptance unit checks passed, including stale versions, failed preflight,
unpublished states, and consent reset. The browser scenario verified Admin draft
save/publication, Staff read-only access, eight policy-editor theme/width cases,
a real maroon-link click opening a new browser tab, the original checkout staying
open, renewed acceptance after publication, and the Customer policy page at
390/768/1440 pixels. Browser APIs are fixtures; backend tests use an isolated
SQLite database. Target database, live checkout, and publication still require
release verification.
