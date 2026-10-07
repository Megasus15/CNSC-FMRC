"""Generate app metadata and SVG icon masters from the supplied FMRC mark.

PNG exports are rendered by render-icons.cjs; frontend source is never copied.
"""
from pathlib import Path
import base64
import json
import argparse

ROOT = Path(__file__).resolve().parents[2]
brand = base64.b64encode((ROOT / "images/FMRC Brand Logo.png").read_bytes()).decode()
parser = argparse.ArgumentParser()
parser.add_argument("app", nargs="?", choices=["customer", "team"])
selected = parser.parse_args().app
for app, name, color in [("customer", "FMRC Customer", "#fff9ed"), ("team", "FMRC Admin/Staff", "#701b2b")]:
    if selected and selected != app:
        continue
    icon_version = "?v=3" if app == "team" else ""
    icon_purpose = "any maskable" if app == "team" else "any"
    folder = ROOT / "apps" / app
    (folder / "icons").mkdir(parents=True, exist_ok=True)
    prefix = f"/apps/{app}/"
    manifest = {"id": prefix, "name": name, "short_name": "FMRC" if app == "customer" else "FMRC Team",
                "description": "FMRC browsing, orders and appointments" if app == "customer" else "FMRC Admin and Staff workspace",
                "start_url": prefix, "scope": prefix, "display": "standalone", "background_color": color,
                "theme_color": color, "lang": "en", "orientation": "any",
                "related_applications": [{"platform": "webapp", "url": prefix + "manifest.webmanifest", "id": prefix}], "icons": [
                    {"src": "icons/icon-192.png" + icon_version, "sizes": "192x192", "type": "image/png", "purpose": icon_purpose},
                    {"src": "icons/icon-512.png" + icon_version, "sizes": "512x512", "type": "image/png", "purpose": icon_purpose},
                    {"src": "icons/maskable-512.png" + icon_version, "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}
    if app == "customer":
        manifest["related_applications"] = manifest.pop("related_applications")
    (folder / "manifest.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    # The original mark stays untouched. A circular clip removes its square background.
    icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><clipPath id="mark"><circle cx="256" cy="249" r="153"/></clipPath></defs><path fill="{color}" d="M0 0h512v512H0z"/><circle cx="256" cy="249" r="172" fill="none" stroke="#c3a250" stroke-width="3"/><image href="data:image/png;base64,{brand}" x="94" y="87" width="324" height="324" clip-path="url(#mark)"/><path d="M223 442h66" stroke="#c3a250" stroke-width="5" stroke-linecap="round"/></svg>'''
    if app == "team":
        # Solid maroon reaches every edge, including Android's adaptive mask.
        # Keep the supplied FMRC mark; no pale tile or accent strip surrounds it.
        icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><clipPath id="mark"><circle cx="256" cy="256" r="153"/></clipPath></defs><path fill="{color}" d="M0 0h512v512H0z"/><image href="data:image/png;base64,{brand}" x="94" y="94" width="324" height="324" clip-path="url(#mark)"/></svg>'''
    (folder / "icons/master.svg").write_text(icon, encoding="utf-8")
    notification = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path fill="white" d="M48 10 82 29v38L48 86 14 67V29zm0 12L26 35l22 13 22-13zm-24 23v16l19 11V56zm29 11v16l19-11V45z"/></svg>'
    (folder / "icons/notification.svg").write_text(notification, encoding="utf-8")
    head = f'''<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>{name}</title><meta name="theme-color" content="{color}"><link rel="apple-touch-icon" href="{prefix}icons/apple-touch-icon.png{icon_version}"><link rel="stylesheet" href="/apps/shared/offline.css">'''
    launch_head = head.replace('<link rel="stylesheet" href="/apps/shared/offline.css">', '')
    fallback = f'{prefix}home-page/main.html' if app == 'customer' else f'{prefix}admin-auth/auth.html'
    (folder / "index.html").write_text(f'''<!doctype html><html lang="en"><head>{launch_head}<style>html{{background:#fffdf9}}</style><link rel="stylesheet" href="/apps/shared/pwa.css?v=1.4"><script src="/apps/shared/pwa.js?v=1.4"></script></head><body data-app="{app}"><script>FMRCApp.launch();</script><noscript><a href="{fallback}">Open FMRC</a></noscript></body></html>\n''', encoding="utf-8")
    (folder / "offline.html").write_text(f'''<!doctype html><html lang="en"><head>{head}</head><body data-app="{app}"><main><img src="{prefix}icons/icon-192.png" alt=""><h1>You're offline</h1><p>Connect to the internet to open {name}. Your information stays secure, and changes are sent only while you're connected.</p><button type="button" onclick="location.reload()">Retry</button></main></body></html>\n''', encoding="utf-8")
    (folder / "install.html").write_text(f'''<!doctype html><html lang="en"><head>{head}<link rel="stylesheet" href="/apps/shared/pwa.css?v=1.4"><script src="/apps/shared/pwa.js?v=1.4"></script></head><body data-app="{app}"><main><img src="icons/icon-192.png{icon_version}" alt=""><h1>{name}</h1><p data-fmrc-install-hint>Install FMRC for a dedicated Home Screen icon and app window.</p><button type="button" hidden data-fmrc-install onclick="FMRCApp.install()">Install App</button><a class="action secondary" href="{prefix}">Open FMRC</a><p>On iPhone, open in Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if shown.</p></main></body></html>\n''', encoding="utf-8")
print("Generated " + (selected or "both apps") + " metadata, launch/install/offline pages, and SVG icon masters.")
