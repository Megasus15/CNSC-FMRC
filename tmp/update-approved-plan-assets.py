from pathlib import Path, PurePosixPath
import json
import posixpath
import re
import subprocess
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
version = '2026.1116.2'
assets = {
    'home-page/main.css', 'home-page/customer-announcements.js',
    'products-page/refund-policy.css', 'products-page/refund-policy.js',
    'products-page/tiktok-payment.css', 'admin-auth/auth.js',
    'admin-page/admin-session.js', 'admin-page/settings-ui.css',
    'admin-page/session-settings.js', 'admin-page/website-emails-ui.css',
    'admin-page/website-emails.js',
}
files = subprocess.check_output(['git','ls-files','-z'], cwd=root).decode('utf-8').split('\0')
pattern = re.compile(r'''(?P<quote>["'])(?P<url>[^"'<>\s]+\.(?:css|js)(?:\?[^"'<>\s]*)?)(?P=quote)''')
counts = dict.fromkeys(sorted(assets), 0)
changed = []
for name in files:
    if not name.endswith(('.html','.js','.css')) or name.startswith(('backend/','tmp/','output/','docs/')):
        continue
    path = root / name
    text = path.read_bytes().decode('utf-8')
    def replace(match):
        value = match['url']
        url = urlsplit(value)
        if url.scheme or url.netloc:
            return match[0]
        target = posixpath.normpath(url.path.lstrip('/') if url.path.startswith('/') else str(PurePosixPath(name).parent / url.path))
        for prefix in ('apps/customer/','apps/team/'):
            if target.startswith(prefix):
                target = target[len(prefix):]
        if target not in assets:
            return match[0]
        if re.search(r'[?&]v=',value):
            updated = re.sub(r'([?&])v=[^&#]*',r'\g<1>v='+version,value)
        else:
            updated = value + ('&' if url.query else '?') + 'v=' + version
        counts[target] += 1
        return match['quote'] + updated + match['quote']
    updated = pattern.sub(replace,text)
    if updated != text:
        path.write_bytes(updated.encode('utf-8'))
        changed.append(name)
print(json.dumps({'version':version,'changed_consumers':len(changed),'asset_references':counts}))
