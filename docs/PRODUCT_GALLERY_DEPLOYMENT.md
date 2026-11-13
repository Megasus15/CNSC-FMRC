# Product Details gallery

The customer Product Details modal and About Us use the same carousel controller
and styles. Product cards retain one cover image. Each gallery contains its cover
and up to four extra items, including at most one video of 30 seconds or less.
Photos remain fully visible inside the 16:10 frame. Only the product information
pane scrolls; the media, header and purchase footer remain visible.

## Using the editor

In either Products portal, open View Product, then Edit Product. The Product
gallery section shows five numbered slots. The first slot is the existing card
cover. Replace that cover with the current image editor. The compact controls use
plus (add), refresh (replace), trash (remove), and left/right arrows (reorder).
Every icon has a tooltip and an accessible name. Extra photos need no square crop. Newly selected covers retain the existing square-cover workflow.

- Images: JPG, PNG or WebP, at most 10 MB each.
- Video: MP4 or WebM, at most 30 MB and 30 seconds; only one per gallery.
- Uploads show progress and keep Update Product disabled until complete.
  Upload errors use the shared system dialog. Successful uploads use the shared
  success notification and explicitly say the media is still a draft. Product
  save success/failure and discard confirmation retain their global feedback.
- Update Product publishes all product fields and the ordered gallery together.
  Failed saves retain the draft. Cancel uses the existing discard confirmation;
  leaving a dirty editor also invokes the browser's unsaved-change prompt.
- Additional media are managed after initial creation through Edit Product.

Customers can use arrows, dots, keyboard navigation or image swipes. Images
rotate every six seconds, pausing during interaction. The active video starts
muted and inline; its native controls expose sound and playback. If autoplay is
blocked, Play video remains available. The video finishes before image rotation
resumes. Closing or covering the modal, changing slide or hiding the tab stops
playback. Reduced motion disables image rotation and transitions; manually
selecting a video still starts it muted.

## Install the release

### Customer gallery and editor repair: assets 2026.1113.1

This update supersedes the six-file editor-only patch. Upload the complete
`output/product-gallery-customer-editor-fix-2026-11-13.zip` to **public_html**,
extract it there, and replace its included files. The folders belong directly
inside `public_html`, not inside `backend` or a nested `public_html` folder.

The archive contains these eleven frontend files:

- `products-page/product.html`, `products.js`, and `product-details.css`.
- `home-page/media-carousel.js` and `media-carousel.css` (the shared dependencies).
- `admin-page/products.html`, `products.js`, `product-gallery.js`, and
  `product-gallery.css`.
- `staff-page/products.html` and `products-loader.js`.

For a site with the gallery backend already installed, this update needs **no
Composer installation or database migration**. All changed page dependencies
use version `2026.1113.1`; deploy the HTML and scripts/styles together. If hosting
or a CDN caches HTML, clear that page cache after replacement. A Git commit/push
only deploys when the hosting Git deployment is configured to do so; otherwise
extract this archive manually or use the existing deployment process.

Customer Product Details now keeps the cover visible when the carousel helper
fails to load. It attempts to load the shared helper again and displays Retry
gallery on failure. Closing or changing the product invalidates pending gallery
work. Normal navigation, playback, lightbox and the About Us carousel are retained.
View details now has an 8 px icon gap and 12 px horizontal padding.

The Admin/Staff editor uses compact labeled SVG controls, shared theme surfaces,
and global success/error feedback. It still initializes when Edit Product opens,
reattaches to replaced markup and blocks saving while unavailable or uploading.
Gallery errors retain edits and expose Retry gallery.

The original blank-gallery screenshot was not reproduced in a fresh public
browser session: the existing live carousel mounted there. The old optional
mount call could silently leave an empty frame when the helper was unavailable;
this failure is now reproduced and covered by the local browser recovery test.
Do not interpret local verification as deployment of this patch.

After deployment, open Products → View details and confirm the cover, additional
slides and purchase icons. In both operator portals, open View Product → Edit
Product and check the five slots below Upload Image. Save one image/short video,
then reload the customer page to confirm the committed media.

### Full backend and frontend installation

Back up the target database and application first. Preserve its environment,
application key and storage. Install this release's backend, dependency lockfile,
and database column before making the updated frontend available.

For this Hostinger website, enter the active **backend** directory explicitly.
Selecting a folder in File Manager does not change Terminal's working directory.
The file check below also confirms the gallery migration has been uploaded. Each
step stops if the preceding command fails:

```sh
cd /home/u799987132/domains/ucn-fabmanlab.com/public_html/backend &&
ls artisan composer.json composer.lock database/migrations/2026_11_12_000001_add_product_gallery_media.php &&
composer2 install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-scripts &&
php artisan config:clear &&
php artisan clear-compiled &&
php artisan package:discover --no-interaction &&
php artisan migrate --path=database/migrations/2026_11_12_000001_add_product_gallery_media.php --force &&
php artisan optimize:clear
```

Copy only the commands inside the code block, without the Markdown backticks.
If the file check reports a missing file, upload/deploy the complete release to
this directory before running the installation again. The commands require
Composer 2 and PHP 8.3 or later; on another host, `composer` may be the Composer 2
command instead of `composer2`.

This Hostinger PHP installation disables `proc_open`. Composer can unpack the
dependency with PHP's ZIP extension, but cannot launch `@php artisan` scripts as
child processes. `--no-scripts` avoids that failure; the next three commands run
the required cache cleanup and package discovery directly. The yellow ZIP warning
alone is not an installation failure. If the earlier installation stopped at
`@php artisan package:discover`, do not assume the migration ran: the `&&` chain
stopped when that Composer script failed. Run the corrected block above.

The dependency lockfile includes `james-heinrich/getid3` 1.9.28 for server-side
duration inspection. FFmpeg and transcoding services are not required.

Publish these frontend groups together:

- `home-page/media-carousel.css`, `media-carousel.js`, `main.js`, and
  `customer-editorial.css`, together with `about-page/about.html`.
- `products-page/product.html`, `products.js`, and `product-details.css`.
- `admin-page/products.html`, `products.js`, `product-gallery.js`, and
  `product-gallery.css`; `staff-page/products.html` and `products-loader.js`.

The changed HTML includes versioned asset references. Staff loads the canonical
Admin form and product script, with its shared gallery dependency loaded first.

If Edit Product has Upload Image followed directly by Product Details, the
five-slot gallery editor has not initialized. It belongs between those two
sections. Hard-refresh the Products page with Ctrl+Shift+R, then reopen View
Product → Edit Product. The required script is `admin-page/product-gallery.js`,
loaded before `admin-page/products.js`. Check both scripts, the gallery stylesheet,
and the matching portal HTML/Staff loader if refreshing does not restore it.
The database migration does not render this frontend section; verify its
installation separately before uploading and saving media.

Configure the web PHP runtime with `upload_max_filesize` of at least `30M` and
`post_max_size` of at least `40M`; the site's existing `50M`/`64M` settings are
also sufficient. Ensure `backend/storage/app/private` is writable and persistent
across releases. Upload one file per request. The API enforces the smaller image
limit separately. Files must not be exposed through a storage symlink.

Keep the existing Laravel scheduler running. It invokes
`products:clean-media` daily to collect expired drafts and copied files left by
unsuccessful transactions. Running that command manually is also supported.

This development session did **not** deploy production. The isolated migration
tests pass. Applying the migration to the configured local MySQL database was
attempted, but no MySQL service was listening on `127.0.0.1:3306`; no local schema
change was made by that attempt. Start the local database and run the same
focused migration command without `--force` for local use.

## API and storage

- Product responses add `media`, ordered cover-first, with `id`, `type`, `url`
  and `duration_seconds`. Existing `image_data` remains the card-image reference.
- Product PUT accepts optional `gallery_media`: an ordered list of `{id}` for
  retained extras or `{upload_token}` for new uploads. Omission preserves extras;
  `[]` removes them. The cover is edited through the existing `image_data` field.
- `POST /api/admin/products/{product}/media-uploads` accepts multipart `file`.
  GET/DELETE with a token previews/discards an account- and product-bound draft.
- `GET /api/products/{product}/media/{media}` serves only media in the current
  committed manifest. Blocked/deleted products return 404. The authenticated
  `/api/admin/products/{product}/media/{media}` route also previews blocked items.
- Files live on the private `local` disk under `product-media-drafts/{product}`
  and `product-media/{product}`. Draft receipts expire after one day. Successful
  replacement/deletion collects unused committed files after database commit.
  Failed saves leave draft receipts retryable. Committed videos support byte
  ranges, and catalogue responses contain no video bytes or private paths.

Existing products need no backfill. Their cover automatically supplies a
one-image gallery. New cover contents generate new card and thumbnail cache keys,
including when two changes happen in the same second.

## Verify

From **backend**:

```sh
php artisan test --compact --filter=ProductMediaTest
```

From the repository root:

```sh
node --test backend/tests/Frontend/product-gallery.browser.cjs
node --test backend/tests/Frontend/website-about-save.browser.cjs
```

The browser checks use an isolated HTTP fixture and installed Chrome or Edge;
backend tests use in-memory SQLite and fake private storage. No production API,
customer records, courier or payment account is involved. WebM fixtures are small
original canvas recordings; `scripts/generate-product-media-fixtures.cjs`
regenerates them without external content or FFmpeg. The duration boundary files
share the original frames with explicit 30 s and 30.001 s container durations.

Before releasing, verify a real image and short video in both portals, successful
reload after save, discarded changes, five-item/one-video enforcement, muted
playback and sound controls, and existing cart/checkout behavior. Check long copy
at 320, 390, 768, 1024 and 1440 px and short landscape. Confirm the About Us
carousel retains its existing appearance and image preview behavior.
