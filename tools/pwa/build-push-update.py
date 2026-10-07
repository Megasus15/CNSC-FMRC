"""Build the small backend update for an existing FMRC installation.

Run from any directory. Only the six delivery-related PHP files are packaged;
the deployed environment, database, dependencies and device subscriptions stay
in place. No local environment or storage files are read.
"""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--target", choices=("staging", "production"), default="staging")
target = parser.parse_args().target
domain = "staging.ucn-fabmanlab.com" if target == "staging" else "ucn-fabmanlab.com"
archive_name = "fmrc-staging-realtime-push.zip" if target == "staging" else "fmrc-live-realtime-push.zip"
ARCHIVE = ROOT / "output" / archive_name
FILES = (
    "backend/bootstrap/app.php",
    "backend/app/Http/Middleware/PwaImmediateDelivery.php",
    "backend/app/Services/PwaNotifications.php",
    "backend/app/Services/PwaOutboxProcessor.php",
    "backend/app/Services/PwaPushTransport.php",
    "backend/app/Console/Commands/ProcessPwaPush.php",
)

sources = {}
for relative in FILES:
    source = ROOT / relative
    assert source.is_file() and not source.is_symlink(), relative
    sources[relative] = source.read_bytes()

enablement = (
    "Keep the existing staging push setting and keys."
    if target == "staging" else
    "After all six files are copied, enable PWA_PUSH_ENABLED=true in the existing\n"
    "production .env, retaining its production database, APP_KEY and VAPID keys.\n"
    "Remove only bootstrap/cache/config.php if present, then check /api/pwa/config.\n"
    "Use the official site's accounts and enroll its apps separately from staging."
)
sources["FMRC_PUSH_UPDATE_README.txt"] = f"""FMRC {target}: prompt phone delivery

Upload {archive_name} to the existing {domain} website's public_html.
Extract into a NEW folder named pwa-push-update within that public_html.
In File Manager, confirm this actual path before copying any files:
public_html/pwa-push-update/backend/

Copy individual files to the existing active backend in this order:
1. app/Services/PwaOutboxProcessor.php
2. app/Http/Middleware/PwaImmediateDelivery.php
3. app/Services/PwaNotifications.php
4. app/Services/PwaPushTransport.php
5. app/Console/Commands/ProcessPwaPush.php
6. bootstrap/app.php (LAST)

For each file, source is public_html/pwa-push-update/backend/<path> and
destination is public_html/backend/<path>. Replace existing files as prompted.
Keep the current backend folder, database, environment, dependencies and storage.
Retain backup copies of the four files being replaced before copying.
Keep the existing recurring notification cron; no second cron is needed.
{enablement}

No SQL, new keys or Composer install are required for this update.
Test a NEW enabled announcement with the enrolled apps closed on the phone.
After verification, remove the uploaded ZIP and only its pwa-push-update folder.

Committed updates are attempted after the HTTP response using high push urgency.
Retries, scheduled first publication and remaining large-audience deliveries
continue through cron. Phone and network delivery time can vary.
The HTTP pass attempts up to 100 deliveries with a 10-second processing budget.

Customer and Team prompt delivery were reported successful on staging through
Brave on Android. iPhone and the remaining device checks are not established.
Local verification is not a deployment or a guarantee of device delivery time.
""".encode()
sources["FMRC_PUSH_UPDATE.json"] = (json.dumps({
    "built_at": datetime.now(timezone.utc).isoformat(),
    "target_environment": target,
    "target_origin": "https://" + domain,
    "php_required": ">=8.3",
    "source_sha256": {name: hashlib.sha256(sources[name]).hexdigest() for name in FILES},
}, indent=2) + "\n").encode()

ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name, content in sources.items():
        archive.writestr(name, content)
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(sources)
    for name, content in sources.items():
        assert archive.read(name) == content, name

print(f"Ready: {ARCHIVE} ({ARCHIVE.stat().st_size / 1024:.1f} KiB, {len(FILES)} PHP files)")
print(f"Target: {domain}. Extract into public_html/pwa-push-update, copy six files, bootstrap/app.php LAST.")
