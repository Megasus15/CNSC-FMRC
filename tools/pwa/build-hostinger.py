"""Build locked production dependencies for a File Manager upload, without secrets.

Run on the developer's machine: python tools/pwa/build-hostinger.py
The existing backend/vendor and backend/.env are never copied or changed.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import subprocess
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "output" / "pwa-hostinger-build" / uuid.uuid4().hex
BUILD.mkdir(parents=True)
for name in ("composer.json", "composer.lock"):
    shutil.copyfile(ROOT / "backend" / name, BUILD / name)
composer = shutil.which("composer")
if not composer:
    raise SystemExit("Composer is required on the developer's machine to build this ZIP.")
command = [composer, "install", "--no-dev", "--prefer-dist", "--optimize-autoloader",
           "--no-scripts", "--no-plugins", "--no-interaction"]
# Windows cannot launch .bat directly through CreateProcess. Keep the command fixed.
if os.name == "nt" and composer.lower().endswith((".bat", ".cmd")):
    command = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c"] + command
build_env = dict(os.environ, COMPOSER_CACHE_DIR=str(ROOT / 'output' / 'pwa-hostinger-build' / 'cache'))
subprocess.run(command, cwd=BUILD, env=build_env, check=True)
platform = [composer, "check-platform-reqs", "--no-dev"]
if os.name == "nt" and composer.lower().endswith((".bat", ".cmd")):
    platform = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c"] + platform
subprocess.run(platform, cwd=BUILD, env=build_env, check=True)
subprocess.run(["php", "-r", r"require 'vendor/autoload.php'; if (!class_exists('Minishlink\WebPush\WebPush')) exit(1);"],
               cwd=BUILD, check=True)

lock = json.loads((BUILD / "composer.lock").read_text(encoding="utf-8"))
metadata = {
    "built_at": datetime.now(timezone.utc).isoformat(),
    "composer_lock_sha256": hashlib.sha256((BUILD / "composer.lock").read_bytes()).hexdigest(),
    "php_required": ">=8.3",
    "production_packages": {p["name"]: p["version"] for p in lock["packages"]},
    "instructions": "Extract into backend. See docs/HOSTINGER_PWA_NO_SSH.md. No .env, keys, database, or application source is included.",
}
archive = ROOT / "output" / "fmrc-hostinger-pwa-dependencies.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for source in sorted((BUILD / "vendor").rglob("*")):
        if source.is_file():
            z.write(source, source.relative_to(BUILD).as_posix())
    z.write(ROOT / "backend" / "pwa-hostinger-cron.php", "pwa-hostinger-cron.php")
    z.writestr("FMRC_PWA_DEPENDENCIES.json", json.dumps(metadata, indent=2) + "\n")
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None, "Dependency archive is corrupt."
    assert "vendor/autoload.php" in z.namelist()
    assert "vendor/minishlink/web-push/src/WebPush.php" in z.namelist()
    assert all(n.startswith("vendor/") or n in ("pwa-hostinger-cron.php", "FMRC_PWA_DEPENDENCIES.json") for n in z.namelist())
print(f"Ready: {archive} ({archive.stat().st_size / 1048576:.1f} MiB)")
print("Upload this ZIP manually; Git intentionally excludes dependency archives.")
