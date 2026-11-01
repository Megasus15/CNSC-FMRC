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

Deploy the PHP controller, support class, routes, shared scripts, and versioned
HTML pages together. Clear the target route/application cache with
`php artisan optimize:clear` after deploying. No database migration is required.
Laravel's private local storage must be writable; decoded video files are cached
there and served by the API, so no new public-storage link is needed.

Before calling the live issue resolved, verify Admin and Staff About text saves,
reload persistence, Customer readback, and every Website Management destination.
The real confirmation and Retry dialogs must work. Test a stalled settings body:
the section skeletons must clear to an actionable failure state, and Save must
remain locked until a successful load. Local browser fixtures and backend tests
do not replace this target-environment check.
