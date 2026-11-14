# Ratings and Feedback UI refinement

Both Admin and Staff Ratings opt into the Inventory modal presentation: cream
surface, maroon icon, 12px frame, fixed header/footer and one scrolling body.
Product Review Details retains the customer identity, anonymity note, media,
likes, existing reply, reply input, 500-character counter and all original IDs.
Close and Escape use the existing draft-discard handler. Pending replies cannot
be submitted twice or closed, and failed replies retain their text and restore
the action label. Shared confirmations/errors and single/bulk archive prompts
use compact no-X popups; success notifications keep their original X.

Review media previews opt into the existing shared media dialog. This opt-in
coordinates focus, scrolling and Escape with the underlying review dialog;
unadopted pages retain their existing presentation. Products retains its prior
opt-in. Media loading, open-in-new-tab behavior and playback cleanup remain in
the shared viewer.

## Summary cards and table controls

`portal-summary-cards.css` is an opt-in Inventory-derived presentation shared by
the four Inquiries and five Ratings cards. Icons sit on the left, values above
labels, with 46px colored tiles, 24px bold values, 12px labels and the Inventory
padding, gaps and rounded corners. Layouts adapt to the available width and
retain complete values. Inventory's existing presentation and calculations do
not change. All counter IDs and server summaries remain intact.

The Ratings table's star/reply filters and short icon search group align to the
right. Archive icon hover uses the same maroon as ordinary actions. Inquiries'
delete icon uses that same maroon. Gold review stars and semantic status pills
retain their meaning.

## Validation and release

`ratings-ui.browser.cjs` covers both roles at 320, 390, 768, 1024 and 1440px,
light/dark themes, short landscape, safe long feedback, media nesting, reply
validation/failure/success, draft discard, guarded pending requests, single/bulk
archive, failure recovery, pagination, search and star/reply filters.
`inquiries-ui.browser.cjs` checks the matching summaries and delete hover plus
the existing inquiry workflows. Products dialog and success-notification suites
check the shared viewer and retain an unadopted Website Services regression.
Backend review/archive, bulk-action and spectator tests preserve permissions,
privacy and retained records.

Deploy the matching shared scripts/styles and both portal shells through the
existing commit, push and online deployment. Shared-media script consumers carry
updated cache versions. No API, database migration or dependency changes are
required. Verify hosted assets separately from local fixture mutation tests.
