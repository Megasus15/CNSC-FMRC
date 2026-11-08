# Appointment methods, private designs and rescheduling

Apply `2026_11_02_000004_extend_appointment_workflows.php` before deploying the matching portal scripts. It adds nullable method/meeting/start-time fields, a schedule revision, private attachment metadata, history, and one scheduling lock row. Historical appointments retain their original records and access; no method, attachment, meeting link or reschedule history is fabricated for them.

## Customer workflow

In booking Step 2, ordinary appointments use **Purpose of Visit**. Selecting **Request a custom product** replaces that choice with **FMRC service**, which the API validates and saves as the appointment purpose. Design Files remain independent of either choice. The initial custom brief omits Finish; staff supplies the final finish during quotation. **Additional notes (optional)** is the sole booking instruction field, shared with the custom requirements. Resumed legacy drafts combine distinct notes without truncation and preserve any saved finish. Combined notes over 2,000 characters require editing before saving or booking.

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

## Verification

`AppointmentWorkflowTest` covers method/file persistence, owner/operator access, private/public separation, legacy ownership, count/size/type rejection, immediate rescheduling, unchanged old receipts via updated verification, notifications, stale revisions, exact Manila cutoffs, PM labels, occupied/custom/blocked slots and HTTPS meeting updates.

`appointments.browser.cjs` runs canonical Customer/Admin/Staff scripts with an isolated persistent HTTP fixture. It exercises real booking forms and multipart uploads, count/aggregate-size errors, My Appointments, private download controls, rescheduling, meeting saves/readback, disabled unchanged Save controls, and 390/768/1440 px layouts in operational light/dark themes. It does not establish production persistence or provider delivery.
