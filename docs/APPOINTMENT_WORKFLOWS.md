# Appointment methods, private designs and rescheduling

Apply `2026_11_02_000004_extend_appointment_workflows.php` before deploying the matching portal scripts. It adds nullable method/meeting/start-time fields, a schedule revision, private attachment metadata, history, and one scheduling lock row. Historical appointments retain their original records and access; no method, attachment, meeting link or reschedule history is fabricated for them.

## Customer workflow

In booking Step 2, ordinary appointments use **Purpose of Visit**. Selecting **Request a custom product** replaces that choice with **FMRC service**, which the API validates and saves as the appointment purpose. Design Files remain independent of either choice. The initial custom brief omits Finish; staff supplies the final finish during quotation. **Additional notes (optional)** is the sole booking instruction field, shared with the custom requirements. Resumed legacy drafts combine distinct notes without truncation and preserve any saved finish. Combined notes over 2,000 characters require editing before saving or booking.

The booking, Add to Appointment, Edit requirements, review and request overview use the same customer brief labels. Personalization, instructions and booking notes from older requests merge into `requirements.instructions`; `customer_notes_version=1` marks that field as authoritative. Reads preserve oversized historical notes, while new or edited notes must fit 2,000 characters. Hidden legacy fields remain stored. Staff final specifications and accepted quotation agreements retain their existing fields, including Finish.

Customers choose Online or Face-to-face at FMRC during booking. Online appointments show **Meeting link pending** until Admin or Staff provides a platform and HTTPS link. The account menu exposes **My Appointments** on every Customer page, with current details, a receipt, private file downloads, meeting details, schedule history and a rescheduling form.

The original appointment must still be upcoming and active. Cutoffs use Asia/Manila, including the exact start minute. New bookings retain an immutable UTC start-time snapshot so later calendar edits cannot shift that cutoff. Rescheduling is immediate, checks the original date/time/revision, clears the old platform/link, records history, refreshes the public receipt, publishes customer/operational notifications, and schedules an updated confirmation email. A concurrent meeting edit or schedule change requires refreshed details.

Booking, rescheduling, meeting edits, calendar publication and completion use the same scheduling lock and fresh record checks. Availability checks share one service: weekends, blocked days/slots, published default/custom slots, past start times and overlapping occupied intervals are enforced on the API. The isolated SQLite tests exercise conflicting submissions and stale revisions; production database locking and mail delivery still require deployment smoke tests.

Existing guest bookings remain accessible through their existing receipt verification. An email match never assigns a guest appointment to an account. New private design uploads require an authenticated Customer; owner access is bound to the saved `user_id`.

## Files and storage

- Up to five files, totaling at most 50 MiB (52,428,800 bytes), including a legacy singular upload if supplied. The Customer label uses “50 MB.”
- JPG/JPEG, PNG, WebP, GIF, PDF, DOC/DOCX, STL, OBJ, STEP/STP, IGES/IGS, DXF and DWG are supported. Unsupported extensions and obvious executable/script payloads are rejected.
- New files are saved to the private local disk, not the public storage link. Downloads require the owner, Admin or Staff and use an attachment disposition, `application/octet-stream`, `nosniff`, and private/no-store caching.
- Public verification responses/pages omit private attachment records, file URLs and meeting links. Older public files are not moved or deleted by an additive migration. Their portal download links now require authorization; a separate reviewed storage cleanup is required to retire any already distributed historical `/storage/` URLs.
- Configure PHP `upload_max_filesize` at least `50M`, `post_max_size` at least `64M`, `max_file_uploads` at least `5`, and the web-server/proxy body limit at least `64M`. Multipart overhead must fit above the total file allowance. Verify private disk write permissions, backups and available space.

## API

Authenticated Customer endpoints: `GET /api/customer/appointments`, `GET /api/customer/appointments/{id}`, `POST /api/customer/appointments/{id}/reschedule` (expected date/time/version required). Admin/Staff meeting updates use `PATCH /api/admin/appointments/{id}/meeting` with an expected version. Authorized downloads use `GET /api/customer/appointments/{id}/attachments/{file}`; the name of this route does not grant customer-only permissions.

Operational listing/deletion/archive/calendar writes require authenticated Admin/Staff. Public calendar and receipt verification remain available. Booking keeps the existing Turnstile and maintenance guards. Notification delivery uses the existing mechanisms; local tests fake email and do not confirm SMTP or push-provider delivery.

## Custom request traceability and meeting cleanup

Every booked custom-product appointment stays in the authenticated team appointment list, including cancelled and archived history. Ordinary appointment filtering is unchanged. Full stored AP references link appointments to all accepted-quotation orders; the consultation status and custom-work stage are separate. `GET /api/admin/appointments/{id}` permits authorized direct lookup of a record outside the current list. Linked order URLs also use the existing authenticated order-detail lookup when an archived order is absent from active tables.

Admin/Staff can remove an existing online meeting link from Appointment details or linked custom Order Details. The shared confirmation explains that the Customer Join button disappears and the appointment/order records are retained. Removal sends null `platform` and `meeting_url` plus the current `expected_version` to the existing meeting PATCH endpoint. It is permitted after consultation, cancellation or archival, is idempotent, and rejects a stale version when another operator has replaced the link. Replacing a link remains restricted to upcoming appointments. Custom-work activity records the removal without retaining the URL in the activity message or metadata.

An open online Customer appointment checks meeting information every 15 seconds while visible, and on return to the tab. Only the meeting summary is patched; custom-product drafts, uploaded files, focus and scroll are retained. Upcoming appointments without a link show **Meeting link pending**; ended appointments show **No active meeting link**.

No migration is required for this cleanup; deploy the API and versioned shared Customer/Admin/Staff assets together. Payment, refund, production, collection and courier mutation contracts are unchanged. After deploying, verify an owned appointment's full AP reference and linked orders in both portals, remove its obsolete meeting link, and confirm Customer readback within 15 seconds. Check that an archived custom appointment and its archived linked order still open from their direct links. These hosted checks are separate from the local fixture tests.

## Verification

`AppointmentWorkflowTest` covers method/file persistence, owner/operator access, private/public separation, legacy ownership, count/size/type rejection, immediate rescheduling, unchanged old receipts via updated verification, notifications, stale revisions, exact Manila cutoffs, PM labels, occupied/custom/blocked slots and HTTPS meeting updates.

`appointments.browser.cjs` runs canonical Customer/Admin/Staff scripts with an isolated persistent HTTP fixture. It exercises real booking forms and multipart uploads, count/aggregate-size errors, My Appointments, private download controls, rescheduling, meeting saves/readback, disabled unchanged Save controls, and 390/768/1440 px layouts in operational light/dark themes. It does not establish production persistence or provider delivery.

`custom-appointment-tracking.browser.cjs` checks matching customer field definitions, scoped hover colors, unsaved notes/focus during the 15-second meeting refresh, full AP/ORD links, archived-order direct lookup and confirmed meeting-link removal in both portals. `OptionalAppointmentProductsTest` also covers lossless legacy-note reads, canonical edits, combined-note limits, lifecycle visibility, stale meeting-removal versions, idempotency and unchanged accepted agreements. Existing checkout/refund browser tests use fixtures and do not charge or refund real payments.
