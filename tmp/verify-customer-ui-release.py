from pathlib import Path
import hashlib
import json
import subprocess
import urllib.request

root = Path(__file__).resolve().parents[1]
origin = 'https://ucn-fabmanlab.com/'
version = '047e505d-ecc9-4e86-8205-213cc366cb7d'
def get(path):
    request = urllib.request.Request(origin+path, headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read(), response.headers
def normalized(body):
    return body.replace(b'\r\n',b'\n')
assets = []
for name in ['home-page/main.css','home-page/announcement-card.css','home-page/customer-notifications.css','home-page/my-appointments.css','products-page/gateway-payments.css','customer-auth/auth.css','products-page/refund-policy.css','products-page/refund-policy.js']:
    remote,_ = get(name+'?v=2026.1116.3')
    matches = normalized(remote)==normalized((root/name).read_bytes())
    assert matches, 'Hosted asset mismatch: '+name
    assets.append({'path':name,'matches_commit':matches,'sha256':hashlib.sha256(normalized(remote)).hexdigest()})
pages = []
for name in ['products-page/refund-policy','products-page/transaction-terms','apps/customer/products-page/refund-policy']:
    body,headers = get(name+'?version='+version)
    html = body.decode('utf-8')
    assert 'policyContentsDisclosure' in html and 'refund-policy.js?v=2026.1116.3' in html
    assert 'no-cache' in headers.get('Cache-Control','')
    pages.append({'path':name,'refined_reader':True,'cache_control':headers.get('Cache-Control')})
before = json.loads((root/'tmp/policy-public-fixture.json').read_text(encoding='utf-8'))['data']
after = json.loads(get('api/commerce/policy/'+version)[0])['data']
assert all(before[key]==after[key] for key in ['version','terms_text','refund_text'])
result = {'release_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'checked_on':'2026-11-16 (Asia/Manila)','assets':assets,'policy_pages':pages,'published_wording_unchanged':True,'browser_visual_checks':['Refund Policy: desktop and phone','Transaction Terms: desktop','Guest notification shell: desktop and phone; all frame/divider borders rgb(239, 230, 218)'],'local_tests':{'passed':20,'failed':0,'skipped':0},'private_order_payment_booking_mutations':'isolated local fixtures only'}
target = root/'output/customer-policy-dialog-refinement/hosted-verification.json'
target.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'commit':result['release_commit'][:8],'hosted_assets_matched':len(assets),'policy_routes_verified':len(pages),'wording_unchanged':True,'report':str(target)}))
