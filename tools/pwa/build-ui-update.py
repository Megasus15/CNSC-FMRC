"""Package the notification UI update for an existing FMRC website.

Only the listed runtime assets and original HTML consumers are included.
Environment, database, dependencies, storage and push-delivery code are excluded.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "output/fmrc-notification-ui-update.zip"
FILES = [
    # Add the tap resolver before exposing it to the new frontend.
    "backend/app/Http/Controllers/Api/CustomerNotificationController.php",
    "backend/routes/api.php",
    "apps/shared/pwa.js", "apps/shared/pwa.css", "apps/shared/worker.js",
    "apps/customer/index.html", "apps/customer/install.html",
    "apps/team/index.html", "apps/team/install.html", "apps/team/offline.html",
    "apps/team/manifest.webmanifest",
    "apps/team/icons/icon-192.png", "apps/team/icons/icon-512.png",
    "apps/team/icons/maskable-512.png", "apps/team/icons/apple-touch-icon.png",
]
for folder in ("home-page", "about-page", "services-page", "products-page",
               "contact-page", "customer-auth", "admin-auth", "admin-page", "staff-page"):
    for source in sorted((ROOT / folder).glob("*.html")):
        content = source.read_text(encoding="utf-8")
        if "apps/shared/pwa.js?v=1.4" in content:
            assert "apps/shared/pwa.css?v=1.4" in content, source
            FILES.append(source.relative_to(ROOT).as_posix())

assert len(FILES) == len(set(FILES))
sources = {}
for relative in FILES:
    source = ROOT / relative
    assert source.is_file() and not source.is_symlink(), relative
    sources[relative] = source.read_bytes()

sources["FMRC_PWA_UI_UPDATE.json"] = (json.dumps({
    "built_at": datetime.now(timezone.utc).isoformat(),
    "release": "notification-ui-1.4", "target_origin": "https://ucn-fabmanlab.com",
    "source_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()},
}, indent=2) + "\n").encode()
sources["FMRC_PWA_UI_UPDATE_README.txt"] = b"""FMRC notification UI 1.4

Use this update on the existing official site, ucn-fabmanlab.com.
Back up the matching files before extracting. This ZIP has no enclosing folder.

1. Upload fmrc-notification-ui-update.zip into the official public_html.
2. Open Extract. Keep Currently navigating on at /files/public_html/.
3. Set Choose folder name to . (one dot) and enable Overwrite existing files.
4. Confirm the resulting destination is /files/public_html/ (one public_html).
5. Extract. Matching files are merged into the existing site.

Do not extract with both the destination and folder name set to public_html:
that creates public_html/public_html and the active site is not updated.

If backend/bootstrap/cache/routes-v7.php exists, remove only that generated
route-cache file. With SSH, run php artisan route:clear from backend instead.
Keep the existing notification cron, push setting, VAPID keys and subscriptions.
No environment edit, SQL, keys or Composer install are required.

Refresh both website tabs and reopen both apps. Permission panels contain only
phone alert preferences. Save preferences / Turn off fit one compact row.
App gateways go directly to the original page with the existing logo loader.
The new Team icons are solid maroon and use version 3 in the manifest.

Existing OS launcher icons may need removing/reinstalling to refresh artwork.
Re-enable Team phone notifications afterward only if the device grant changed.
Browsers with a working related-app inventory detect removal automatically.
Browsers that cannot report Home Screen shortcuts keep a per-app confirmation;
use /apps/customer/install.html or /apps/team/install.html to confirm removal.
Clearing site data or changing browsers can require confirming an existing app.

Check both panels, app launches, refresh persistence, phone delivery and taps.
After verification, remove the uploaded ZIP and the two FMRC_PWA_UI_UPDATE
metadata/readme files. Retain your rollback backup.
"""
ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, data in sources.items():
        archive.writestr(name, data)
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(sources)
    for name, data in sources.items():
        assert archive.read(name) == data, name
print(f"Ready: {ARCHIVE} ({ARCHIVE.stat().st_size / 1024:.1f} KiB; {len(FILES)} runtime files)")
print("Extract at /files/public_html/ with folder name . (one dot); overwrite matching files.")
