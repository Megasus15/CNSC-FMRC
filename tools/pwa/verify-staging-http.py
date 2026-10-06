"""Verify staging ZIP contents and deny HTTP setup before any application boot."""
from pathlib import Path
import hashlib
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "output/pwa-hostinger-build" / ("staging-http-" + uuid.uuid4().hex)
FIXTURE.mkdir(parents=True)
with zipfile.ZipFile(ROOT / "output/fmrc-hostinger-staging.zip") as archive:
    assert archive.testzip() is None
    metadata = json.loads(archive.read("FMRC_STAGING_RELEASE.json"))
    assert metadata["database"] == "u799987132_fmrc_staging"
    assert metadata["database_user"] == "u799987132_fmrc_stage"
    assert metadata["origin"] == "https://staging.ucn-fabmanlab.com"
    for name, expected in metadata["source_sha256"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == expected, name
        if name not in {".htaccess", "robots.txt"} and not name.endswith("/.gitignore"):
            assert archive.read(name) == (ROOT / name).read_bytes(), "Stale packaged source: " + name
    template = archive.read("backend/.env.staging.example")
    assert b"FMRC_STAGING_SETUP_ENABLED=false" in template and b"PWA_PUSH_ENABLED=false" in template
    assert "backend/.env" not in archive.namelist()
    assert not any(name.startswith(("backend/storage/", "backend/public/frontend/")) and not name.endswith(".gitignore") for name in archive.namelist())
    for folder in ("backend", "without-runtime"):
        (FIXTURE / folder).mkdir()
        (FIXTURE / folder / "pwa-hostinger-staging-setup.php").write_bytes(archive.read("backend/pwa-hostinger-staging-setup.php"))
    (FIXTURE / "backend/pwa-hostinger-cron.php").write_bytes(archive.read("backend/pwa-hostinger-cron.php"))
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
server = subprocess.Popen(["php", "-S", f"127.0.0.1:{port}", "-t", str(FIXTURE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
try:
    for path in ("backend/pwa-hostinger-staging-setup.php", "without-runtime/pwa-hostinger-staging-setup.php", "backend/pwa-hostinger-cron.php"):
        for attempt in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/{path}?command=migrate:fresh", timeout=1)
                raise AssertionError("HTTP setup must be unavailable: " + path)
            except urllib.error.HTTPError as error:
                assert error.code == 404 and error.read() == b"", path
                break
            except urllib.error.URLError:
                time.sleep(0.1)
        else:
            raise AssertionError("PHP verification server did not start.")
finally:
    server.terminate()
    server.wait(timeout=10)
refused = subprocess.run(["php", str(FIXTURE / "without-runtime/pwa-hostinger-staging-setup.php")], capture_output=True, text=True)
assert refused.returncode == 1 and "separate staging website folder" in refused.stderr
assert not any(FIXTURE.rglob("pwa-vapid.json"))
assert not any(FIXTURE.rglob(".env"))
print("PASS: ZIP contains current source and safe template; both helpers return empty HTTP 404 before bootstrap; wrong-folder CLI setup is refused.")
