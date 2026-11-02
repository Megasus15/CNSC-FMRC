# Customer, Admin and Staff upgrade checkpoint

The remaining stages are implemented in canonical source assets. No production deployment, real customer orders, rate/policy publication, courier booking or production migration was performed by this implementation.

## Implemented

1. The previously committed Website Management fixes remain the baseline: About Us uses a page-scoped guarded save, videos are limited to 50 MB with acknowledged upload completion, loading failures release skeletons, and Save controls require changes with completed uploads.
2. Shipping uses Admin-reviewed Philippine destination zones and one fee per order, server pricing/quotes, working-day delivery estimates, explicit stale-quote review, zero-fee pickup, unavailable-destination recovery, and immutable order snapshots. Customer/Admin/Staff detail views share server-formatted pricing. Online and COD use the same accepted payable total.
3. Transaction/refund policies have Admin draft/preview/publication and Staff published read access. The checkbox reads **I agree to the Transaction Terms and Refund Policy.** The maroon underlined links open the separate Customer policy page in a new tab. Orders retain the accepted immutable policy version/text/time; changed publications require renewed acceptance. Proposed wording stays private until FMRC approves publication.
4. Shared Ninja Van parcel booking/cancellation, stable retry references, durable attempts, HMAC webhooks, deduplicated chronological histories and manual courier access are implemented. Courier status cannot confirm payments, issue refunds or complete orders. Production is gated off pending provider setup/approval.
5. Online/Face-to-face booking, My Appointments, private document/CAD attachments, authorized downloads, meeting-link updates, transactional rescheduling, history, revised receipts and notifications are implemented.
6. Shared reports omit **Prepared by** and **Role** from first-page summary metadata. Certification/signature sections and generation audit data are retained. Canonical report consumers, including Inventory, share one new cache version.

## Release sequence

Apply the four additive migrations after a reviewed backup. Publish only approved shipping rates/calendar and approved transaction/refund text. Verify authenticated Admin/Staff readback and Customer checkout on the deployment. Keep courier booking disabled while completing the provider activation steps. Check private storage, PHP/proxy upload limits, email/push delivery and production database transaction behavior before releasing appointment uploads/rescheduling.

- [Shipping setup](SHIPPING_FEES_DELIVERY_SETUP.md)
- [Transaction policy setup](TRANSACTION_POLICY_SETUP.md)
- [Ninja Van activation requirements](NINJA_VAN_ACTIVATION.md)
- [Appointment workflow and storage setup](APPOINTMENT_WORKFLOWS.md)

Canonical files are served through the existing portal routes. Do not recursively copy the legacy `backend/public/frontend` directory. No rates, preparation/transit commitments, statutory return deadlines, live credentials or actual parcel measurements were invented for production.

## Verification and known baseline issues

Focused API tests use an isolated migrated database, authenticated requests, readback and HTTP-provider fakes. Browser tests use real canonical UI code with isolated HTTP fixtures; they validate interactions and responsive presentation independently of API/database tests. They do not prove a deployed authenticated session or live third-party integration.

The broader frontend run currently has **181 passing tests and one local Apache harness failure**. Apache rejects its temporary configuration path with `AH00532`; this harness is unrelated to the upgrade code. Existing payment/reports mocks were updated to provide their newly consumed browser APIs, and page counts/cache pins now include the new configuration pages.

The final broader backend run has **705 passing tests and three pre-existing `AdminPortalConsistencyTest` failures:** the standalone maintenance preview lacks the shared-UI pin, the dashboard CTA static selector expectation differs from the current stylesheet, and the announcement theme static expectation differs from the current shared dialog implementation. The unrelated preview/dashboard/announcement implementations were preserved. The report-consumer cache mismatch detected during regression was fixed and its focused assertion passes.

Chrome browser checks cover approved shipping draft/publication/readback, Staff read access, pricing/estimates and stale-quote recovery; policy draft/publication/readback and a real click opening the maroon Refund Policy link in another tab; courier parcel booking/loading/double-click/cancellation; Customer appointment methods/files/rescheduling and operational meeting links; and report preview/print lifecycle.

Admin and Staff report PDFs were generated through the actual shared print flow, reopened and rendered. Both fixture documents have a clean six-field summary, certification/signatures and a complete second page of records with correct page numbering. PDF artifacts are local validation fixtures, not issued business reports.
