# Website Management loading and About Us save repair

The live settings response measured 43,339,527 bytes on November 1, 2026. The
embedded `about_video_url` accounted for 42,052,070 characters. Every settings
editor downloaded that video; About Us also sent the unchanged video with text
edits and downloaded it again before ending its save state.

Website Management now requests `GET /api/site-settings?media=references`.
The About video is returned as a versioned URL and served separately through
`GET /api/site-settings/about-video`, with range, HEAD, and conditional-cache
support. The original settings response remains compatible with older clients.
Customer pages using the shared settings loader also request references.

About/Home saves omit unchanged media, while replacements and explicit removals
still save normally. Editor requests have deadlines that cover response bodies,
not just response headers. Failed Contact/Footer loads keep Save disabled and
offer Retry instead of allowing an empty form to replace existing content.

All Website Management Save buttons now start disabled. Each editor compares
its current values against its loaded snapshot: edits enable Save, reverting
them disables it, and a successful save establishes a new clean snapshot.
Loading and pending saves retain their existing locks. Services page copy and
categories track their changes independently, as do the separate portal tabs
and email templates. Staff uses the same scripts on its permitted pages.

About video uploads use authenticated multipart
`POST /api/admin/site-settings/about-video-upload`. Both the browser and API
enforce a 50 MB limit (52,428,800 bytes) and supported video types. The progress
display stays below 100% until the API acknowledges private storage. Save stays
disabled throughout uploading and after upload failures; Retry and Cancel
restore an actionable state. The acknowledgement supplies an owner-scoped
receipt, which Save sends as `about_video_upload_token` instead of video bytes.
Only saving publishes that staged video. Replacements and removals discard
unused receipts through the authenticated DELETE endpoint. Receipts expire
after one day, and later uploads prune the owner's expired draft files.

Deploy the PHP controller, support class, routes, shared scripts, and versioned
HTML pages together. Clear the target route/application cache with
`php artisan optimize:clear` after deploying. No database migration is required.
Laravel's private local storage must be writable; decoded video files are cached
there and served by the API, so no new public-storage link is needed.
The cache store must also be writable for upload receipts. Deploy
`backend/public/.user.ini` with `upload_max_filesize=50M` and
`post_max_size=64M`; verify those effective PHP values and a host request-body
limit of at least 64 MB before testing a 50 MB upload. The new frontend and
upload endpoints must be released together.

Before calling the live issue resolved, verify Admin and Staff About text saves,
reload persistence, Customer readback, and every Website Management destination.
The real confirmation and Retry dialogs must work. Test a stalled settings body:
the section skeletons must clear to an actionable failure state, and Save must
remain locked until a successful load. Local browser fixtures and backend tests
do not replace this target-environment check.
Also verify an exact-limit video, oversize rejection, Cancel/Retry, progress
confirmation, and that Save is disabled again after publishing. Inspect the
resulting Customer video and test edits and reversions on each permitted
Website Management page.
