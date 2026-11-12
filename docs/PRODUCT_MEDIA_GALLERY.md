# Product media gallery — Phase 1

Admin and Staff use the same product editor. Uploads, ordering, cover selection and removal remain drafts until **Save Product**. Cancel confirms discarding edits and removes staged uploads; failed saves retain the draft. Retry failed uploads individually. Another operator's gallery save produces a 409 rather than overwriting their changes; close and reopen the product to load the saved revision.

Customer product cards retain a photo cover and show a media count. Product Information provides a responsive photo/video gallery, thumbnails, keyboard navigation and fullscreen viewing. Videos never autoplay and pause when switching media, opening fullscreen, or closing the dialog. Customer reviews keep their existing media viewer.

## Storage and compatibility

- Up to 10 items, including at most two MP4 videos. Photos: JPG, PNG, GIF or WebP, 5 MB each and at most 40 megapixels. Videos: 50 MB each; H.264 MP4 is recommended for browser compatibility. No video transcoding is performed.
- Every nonempty gallery needs a photo cover. Products may still have no media. Reordering does not change the selected cover.
- Files use the private `local` disk. New files receive account-bound upload receipts valid for 24 hours. No draft file has a public download URL. Product validation, row locking and a revision check precede atomic publication.
- Published file IDs are immutable. Removing a gallery item or deleting a product detaches its published files but retains them for cart/order image references. The original single-image data and legacy image endpoint remain intact. Do not manually delete detached published files.
- Existing products require no bulk conversion. Their existing image appears as the first gallery item and is copied into file storage only when the gallery is first saved. Existing external image references are retained without downloading remote resources.

## API additions

- `POST /api/admin/products/media-uploads`: one multipart `file`; returns its private upload `token`, ID, type, name and size. Admin/Staff only, throttled.
- `DELETE /api/admin/products/media-uploads/{token}`: discard an upload owned by the current operator. Already-published files are preserved after an uncertain save response.
- Existing product create/update accepts `media` (ordered entries containing exactly one `id`, `token`, or `legacy: true`), `cover` (the selected photo ID/token or `legacy`), and `media_revision`. An empty gallery uses `media: []`, `cover: null`. Legacy clients omitting `media` retain existing behavior; managed galleries retain ownership of their cover.
- `GET /api/products/{product}/media`: ordered published metadata, cover and revision; blocked products require an operator. Public product lists add `media_count` and `media_revision`; Admin/Staff lists also include gallery metadata. JSON contains file references rather than media bytes.
- `GET /api/product-media/{media}`: published media only, with image thumbnails via `?thumbnail=1`, HEAD/range video responses, caching and `nosniff`.

## Local setup and release

Deploy the migration, backend code, shared editor/gallery assets, and both Admin/Staff product entry points together. Run this additive migration against the intended database:

```sh
php artisan migrate --path=database/migrations/2026_11_12_000001_add_product_media_gallery.php --force
```

PHP must allow at least `upload_max_filesize=50M` and `post_max_size=64M`, with the web-server/proxy body limit at least 64 MB. Uploads use one request per file. The repository's `backend/public/.user.ini` already declares those limits. Verify disk capacity, private storage write permissions and browser video support on the actual host.

The existing Laravel scheduler runs `products:clean-media-drafts` hourly to remove expired unpublished files. The same command can be run manually. It never removes published media. Confirm the scheduler runs on the deployment host.

Run focused verification with:

```sh
php artisan test --compact --filter=ProductMediaGalleryTest
node --test backend/tests/Frontend/product-media-gallery.browser.cjs
```

Browser tests exercise the full Customer/Admin/Staff scripts with isolated API fixtures, real local MP4 playback, desktop/tablet/phone screenshots and both portal themes. Screenshots are written to `output/product-media-phase1`. They do not contact payment or courier providers. Deployment has not been performed by this phase.

Local verification on November 12, 2026: the related backend run passed 125 tests/1,932 assertions; the final gallery-specific run passed 11 tests/163 assertions (these suites overlap). All three browser workflows and five shared customer consistency checks passed. JavaScript/PHP syntax, CSS parsing and Git whitespace checks passed. The additive migration was applied to the existing local MySQL database; a read-only product API check returned HTTP 200 with all 18 existing products. No existing product content was changed by the smoke check.
