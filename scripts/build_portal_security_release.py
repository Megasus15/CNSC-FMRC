"""Build the explicit Hostinger File Manager package from this checkout.

Run from the repository root with: python scripts/build_portal_security_release.py
The SQL and guide are copied beside the ZIP, never inside the public ZIP.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "portal-security-release"
PUBLIC_ZIP = OUTPUT / "UPLOAD-TO-PUBLIC-HTML.zip"

FILES = [
    "admin-auth/auth.css",
    "admin-auth/auth.html",
    "admin-auth/auth.js",
    "customer-auth/auth.css",
    "customer-auth/auth.html",
    "customer-auth/auth.js",
    "admin-page/admin-common.js",
    "admin-page/admin-session.js",
    "admin-page/dashboard.css",
    "admin-page/inventory.js",
    "admin-page/reports.js",
    "admin-page/session-helper.js",
    "backend/app/Console/Commands/RevokePortalSessions.php",
    "backend/app/Http/Controllers/Api/AdminSessionController.php",
    "backend/app/Http/Controllers/Api/AuthController.php",
    "backend/app/Http/Middleware/EnforceAdminSession.php",
    "backend/app/Http/Middleware/EnforceSpectatorMode.php",
    "backend/app/Services/LoginLockoutService.php",
    "backend/app/Support/AdminSession.php",
    "backend/bootstrap/app.php",
    "backend/database/migrations/2027_01_08_000000_create_login_failure_states_table.php",
    "backend/database/migrations/2027_01_08_000001_add_last_interaction_at_to_personal_access_tokens_table.php",
    "backend/routes/api.php",
]


def copied_bytes(relative: str) -> bytes:
    path = ROOT / relative
    if not path.is_file():
        raise FileNotFoundError(path)
    return path.read_bytes()


def main() -> None:
    pages = sorted(
        page.relative_to(ROOT).as_posix()
        for folder in ("admin-page", "staff-page")
        for page in (ROOT / folder).glob("*.html")
        if 'admin-session.js?v=1.0' in page.read_text(encoding="utf-8")
    )
    if len(pages) != 37:
        raise RuntimeError(f"Expected 37 Admin/Staff session pages; found {len(pages)}")

    all_files = sorted(set(FILES + pages))
    manifest = [
        {
            "path": relative,
            "bytes": len(data := copied_bytes(relative)),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        for relative in all_files
    ]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(PUBLIC_ZIP, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in all_files:
            archive.writestr(relative, copied_bytes(relative))

    (OUTPUT / "FILE-MANIFEST.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    companions = {
        "01-INSTALL-SCHEMA.sql": "backend/database/manual/2027_01_08_install_portal_security.sql",
        "02-REVOKE-OLD-ADMIN-STAFF-TOKENS.sql": "backend/database/manual/2027_01_08_revoke_old_admin_staff_tokens.sql",
        "START-HERE.md": "docs/PORTAL_SECURITY_RELEASE.md",
    }
    for output_name, source in companions.items():
        (OUTPUT / output_name).write_bytes(copied_bytes(source))

    with ZipFile(PUBLIC_ZIP) as archive:
        if sorted(archive.namelist()) != all_files:
            raise RuntimeError("ZIP manifest does not match the source file list")
        for record in manifest:
            data = archive.read(record["path"])
            if hashlib.sha256(data).hexdigest() != record["sha256"]:
                raise RuntimeError(f"ZIP hash mismatch: {record['path']}")

    print(f"Wrote {PUBLIC_ZIP} with {len(all_files)} files")


if __name__ == "__main__":
    main()
