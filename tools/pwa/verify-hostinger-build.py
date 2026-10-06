"""Exercise the upload ZIP and cron helper in an isolated SQLite app copy."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "output" / "pwa-hostinger-build" / ("verify-" + uuid.uuid4().hex)
FIXTURE.mkdir(parents=True)
with zipfile.ZipFile(ROOT / "output" / "fmrc-hostinger-pwa-dependencies.zip") as z:
    assert z.testzip() is None
    assert all(n.startswith("vendor/") or n in ("pwa-hostinger-cron.php", "FMRC_PWA_DEPENDENCIES.json") for n in z.namelist())
    release = json.loads(z.read("FMRC_PWA_DEPENDENCIES.json"))
    assert release["composer_lock_sha256"] == hashlib.sha256((ROOT / "backend/composer.lock").read_bytes()).hexdigest()
    assert "phpunit/phpunit" not in release["production_packages"]
    assert z.read("pwa-hostinger-cron.php") == (ROOT / "backend/pwa-hostinger-cron.php").read_bytes()
    z.extractall(FIXTURE)
for folder in ("app", "config", "routes", "database/migrations"):
    shutil.copytree(ROOT / "backend" / folder, FIXTURE / folder)
for name in ("artisan", "composer.json", "composer.lock", "bootstrap/app.php", "bootstrap/providers.php"):
    destination = FIXTURE / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "backend" / name, destination)
for folder in ("bootstrap/cache", "storage/app/private", "storage/framework/cache/data", "storage/framework/views", "storage/framework/sessions", "storage/logs"):
    (FIXTURE / folder).mkdir(parents=True, exist_ok=True)
database = FIXTURE / "database/verification.sqlite"
database.touch()
(FIXTURE / ".env").write_text(
    "APP_NAME=FMRC\nAPP_ENV=testing\nAPP_DEBUG=false\nAPP_URL=http://127.0.0.1\n"
    "DB_CONNECTION=sqlite\nDB_DATABASE=" + database.as_posix() + "\n"
    "CACHE_STORE=file\nSESSION_DRIVER=file\nMAIL_MAILER=log\nPWA_PUSH_ENABLED=false\n",
    encoding="utf-8",
)
# Ensure no inherited deployment credentials affect this isolated fixture.
environment = {k: v for k, v in os.environ.items()
               if not k.startswith(("APP_", "DB_", "PWA_", "CACHE_", "SESSION_", "MAIL_"))}
if os.name == "nt" and not environment.get("OPENSSL_CONF"):
    # Laragon's Windows OpenSSL needs its config path; this is a local test setting.
    openssl_config = Path(shutil.which("php")).parent / "extras/ssl/openssl.cnf"
    if openssl_config.is_file():
        environment["OPENSSL_CONF"] = str(openssl_config)

def run(*arguments):
    result = subprocess.run(["php", *arguments], cwd=FIXTURE, env=environment, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result.stdout

run("artisan", "migrate", "--force")
original_environment = (FIXTURE / ".env").read_bytes()
first = run("pwa-hostinger-cron.php")
assert "Keys saved to protected" in first
assert "FMRC notification cron completed." in first
keys_file = FIXTURE / "storage/app/private/pwa-vapid.json"
keys_before = keys_file.read_bytes()
keys = json.loads(keys_before)
assert len(keys["publicKey"]) >= 80 and len(keys["privateKey"]) >= 40
assert keys["privateKey"] not in first
second = run("pwa-hostinger-cron.php", "migrate:fresh")  # Extra arguments cannot select another command.
assert "Keys saved to protected" not in second
assert keys_file.read_bytes() == keys_before
assert keys["privateKey"] not in second
assert (FIXTURE / ".env").read_bytes() == original_environment
with sqlite3.connect(database) as connection:
    assert connection.execute("SELECT value FROM pwa_runtime WHERE key='processor'").fetchone()
    assert connection.execute("SELECT COUNT(*) FROM migrations").fetchone()[0] > 5

# Check the actual PHP HTTP SAPI refuses execution before bootstrap or key generation.
keys_file.unlink()
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
server = subprocess.Popen(["php", "-S", f"127.0.0.1:{port}", "-t", str(FIXTURE)],
                          cwd=FIXTURE, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for attempt in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/pwa-hostinger-cron.php?command=migrate:fresh", timeout=1)
            raise AssertionError("The cron helper must return HTTP 404.")
        except urllib.error.HTTPError as error:
            assert error.code == 404
            assert error.read() == b""
            break
        except urllib.error.URLError:
            time.sleep(0.1)
    else:
        raise AssertionError("The isolated PHP server did not start.")
    assert not keys_file.exists(), "HTTP access generated credentials."
finally:
    server.terminate()
    server.wait(timeout=10)
print("PASS: production ZIP boots Laravel; cron preserves keys/.env, updates heartbeat, ignores command arguments; HTTP access returns 404 without generating keys.")
