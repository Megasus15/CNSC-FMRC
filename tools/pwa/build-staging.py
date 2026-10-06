"""Package the separate Hostinger staging website from allowlisted source files.

Run after build-hostinger.py. Never read the developer's .env, database or uploads.
The ZIP contains an unconfigured staging template and locked production vendor.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "output/fmrc-hostinger-staging.zip"
DEPENDENCIES = ROOT / "output/fmrc-hostinger-pwa-dependencies.zip"
FRONTEND = ("apps", "home-page", "about-page", "services-page", "products-page", "contact-page",
            "customer-auth", "admin-auth", "admin-page", "staff-page", "images")
EXTENSIONS = {".html", ".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif",
              ".ico", ".woff", ".woff2", ".mp4", ".webmanifest"}
sources = {}

def include(relative):
    source = ROOT / relative
    assert source.is_file() and not source.is_symlink(), relative
    sources[relative] = source.read_bytes()

for folder in FRONTEND:
    for file in sorted((ROOT / folder).rglob("*")):
        if file.is_file() and file.suffix.lower() in EXTENSIONS:
            include(file.relative_to(ROOT).as_posix())
for relative in (".htaccess", "index.html", "favicon.ico", "apple-touch-icon.png"):
    include(relative)
for folder in ("app", "config", "routes", "resources", "database/migrations"):
    for file in sorted((ROOT / "backend" / folder).rglob("*")):
        if file.is_file() and file.suffix.lower() in {".php", ".js", ".css", ".html"}:
            include(file.relative_to(ROOT).as_posix())
for relative in ("artisan", "composer.json", "composer.lock", "bootstrap/app.php", "bootstrap/providers.php",
                 "public/index.php", "public/.htaccess", "database/seeders/SiteSettingSeeder.php",
                 ".env.staging.example", "pwa-hostinger-cron.php", "pwa-hostinger-staging-setup.php"):
    include("backend/" + relative)
build_assets = ROOT / "backend/public/build"
if build_assets.exists():
    for file in sorted(build_assets.rglob("*")):
        if file.is_file():
            include(file.relative_to(ROOT).as_posix())
# Staging indexing protection belongs to this ZIP, not the live site's .htaccess.
sources["robots.txt"] = b"User-agent: *\nDisallow: /\n"
sources[".htaccess"] += b'\n<IfModule mod_headers.c>\n    Header always set X-Robots-Tag "noindex, nofollow"\n</IfModule>\n'
for folder in ("bootstrap/cache", "storage/app/private", "storage/app/public", "storage/framework/cache/data",
               "storage/framework/views", "storage/framework/sessions", "storage/logs"):
    sources["backend/" + folder + "/.gitignore"] = b"*\n!.gitignore\n"

with zipfile.ZipFile(DEPENDENCIES) as dependencies:
    assert dependencies.testzip() is None
    metadata = json.loads(dependencies.read("FMRC_PWA_DEPENDENCIES.json"))
    assert metadata["composer_lock_sha256"] == hashlib.sha256(sources["backend/composer.lock"]).hexdigest(), "Rebuild the locked dependency ZIP first."
    assert "phpunit/phpunit" not in metadata["production_packages"]
    for name in dependencies.namelist():
        if name.startswith("vendor/") and not name.endswith("/"):
            assert ".." not in Path(name).parts
            sources["backend/" + name] = dependencies.read(name)
    assert "backend/vendor/autoload.php" in sources

release = {
    "built_at": datetime.now(timezone.utc).isoformat(),
    "origin": "https://staging.ucn-fabmanlab.com",
    "database": "u799987132_fmrc_staging",
    "database_user": "u799987132_fmrc_stage",
    "php_required": ">=8.3",
    "composer_lock_sha256": metadata["composer_lock_sha256"],
    "source_sha256": {name: hashlib.sha256(content).hexdigest() for name, content in sources.items() if not name.startswith("backend/vendor/")},
    "instructions": "Extract only into the NEW staging website public_html. Rename backend/.env.staging.example to .env; enter private passwords. Follow docs/HOSTINGER_PWA_STAGING.md. Push and setup default to OFF.",
}
sources["FMRC_STAGING_RELEASE.json"] = (json.dumps(release, indent=2) + "\n").encode()
ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for name, content in sources.items():
        output.writestr(name, content)
with zipfile.ZipFile(ARCHIVE) as output:
    assert output.testzip() is None
    names = output.namelist()
    assert "backend/.env" not in names
    assert not any("backend/public/frontend/" in name or name.endswith((".sql", ".sqlite", ".log")) for name in names)
    assert not any(name.endswith(("pwa-vapid.json", "DatabaseSeeder.php")) for name in names)
print(f"Ready: {ARCHIVE} ({ARCHIVE.stat().st_size / 1048576:.1f} MiB, {len(sources)} files)")
print("New staging website only. No .env, live data, uploaded files or private keys were copied.")
