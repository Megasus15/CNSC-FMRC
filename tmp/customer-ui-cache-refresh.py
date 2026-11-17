from pathlib import Path, PurePosixPath
import json
import posixpath
import re
import subprocess
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
assets = {'home-page/main.css', 'home-page/announcement-card.css', 'home-page/customer-notifications.css', 'home-page/my-appointments.css', 'customer-auth/auth.css', 'products-page/refund-policy.css', 'products-page/refund-policy.js', 'products-page/gateway-payments.css'}
pattern = re.compile(r'''(?P<quote>["'])(?P<url>[^"'<>\s]+\.(?:css|js)(?:\?[^"'<>\s]*)?)(?P=quote)''')
changed = []
for name in subprocess.check_output(['git','ls-files','-z'], cwd=root).decode().split('\0'):
    if not name.endswith(('.html','.js','.css')) or name.startswith(('backend/','tmp/','docs/','output/')):
        continue
    path = root / name
    text = path.read_bytes().decode('utf-8')
    def replace(match):
        value = match['url']; url = urlsplit(value)
        if url.scheme or url.netloc:
            return match[0]
        target = posixpath.normpath(url.path.lstrip('/') if url.path.startswith('/') else str(PurePosixPath(name).parent / url.path))
        for prefix in ('apps/customer/','apps/team/'):
            if target.startswith(prefix): target = target[len(prefix):]
        if target not in assets:
            return match[0]
        updated = re.sub(r'([?&])v=[^&#]*',r'\g<1>v=2026.1116.3',value) if re.search(r'[?&]v=',value) else value+('&' if url.query else '?')+'v=2026.1116.3'
        return match['quote']+updated+match['quote']
    updated = pattern.sub(replace,text)
    if name == 'home-page/my-appointments.css': updated = updated.replace('#ebdba7','#e7ded9')
    if name == 'products-page/gateway-payments.css': updated = updated.replace('border:1px solid #c9b59b','border:1px solid var(--customer-paper-edge,#e7ded9)')
    if updated != text:
        path.write_bytes(updated.encode('utf-8')); changed.append(name)
print(json.dumps({'changed_consumers':changed}))
