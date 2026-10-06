/* Verify the real production .htaccess aliases using an isolated local Apache instance. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const apacheRoot = 'C:/laragon/bin/apache';
const apache = fs.existsSync(apacheRoot) ? fs.readdirSync(apacheRoot).map(name => path.join(apacheRoot, name)).find(folder => fs.existsSync(path.join(folder, 'bin/httpd.exe'))) : null;
const slash = file => file.replaceAll('\\', '/');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('Apache serves clean and .html app aliases with isolated scopes, safe paths, and uncached workers', { skip: !apache, timeout: 30000 }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-pwa-apache-'));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const config = slash(path.join(temporary, 'httpd.conf')), binary = path.join(apache, 'bin/httpd.exe');
  const modules = ['authz_core','authz_host','mime','dir','rewrite','setenvif','env','headers','expires'];
  fs.writeFileSync(config, `ServerRoot "${slash(apache)}"\nServerName localhost\nListen 127.0.0.1:${port}\nPidFile "${slash(path.join(temporary,'apache.pid'))}"\nErrorLog "${slash(path.join(temporary,'error.log'))}"\n${modules.map(module => `LoadModule ${module}_module modules/mod_${module}.so`).join('\n')}\nTypesConfig conf/mime.types\nDocumentRoot "${slash(root)}"\nDirectoryIndex index.html\n<Directory "${slash(root)}">\nAllowOverride All\nRequire all granted\nOptions -Indexes\n</Directory>\n<FilesMatch "(?i)\\.(php|phtml|phar)$">\nRequire all denied\n</FilesMatch>\n`);
  const syntax = spawnSync(binary, ['-d', slash(apache), '-f', config, '-t'], { windowsHide: true, encoding: 'utf8' }); assert.equal(syntax.status, 0, syntax.stderr);
  const process = spawn(binary, ['-d', slash(apache), '-f', config], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { const response = await fetch(base+'/apps/customer/manifest.webmanifest'); if (response.ok) { ready = true; break; } } catch {} await pause(50); }
    assert(ready, fs.existsSync(path.join(temporary,'error.log')) ? fs.readFileSync(path.join(temporary,'error.log'),'utf8') : 'Apache did not start');
    // This isolated server deliberately disables PHP. A 403 confirms the exact
    // asset-links route reached the PHP gateway; its JSON is covered by PwaTest.
    assert.equal((await fetch(base+'/.well-known/assetlinks.json')).status,403);
    for (const [route, source] of [['/apps/customer/home-page/main','home-page/main.html'],['/apps/customer/home-page/main.html','home-page/main.html'],['/apps/team/staff-page/settings','staff-page/settings.html'],['/apps/team/admin-auth/auth.html','admin-auth/auth.html'],['/apps/customer/home-page/main.js','home-page/main.js'],['/apps/team/admin-page/admin-common.js','admin-page/admin-common.js'],['/apps/customer/images/FMRC%20Brand%20Logo.png','images/FMRC Brand Logo.png']]) {
      const response = await fetch(base+route); assert.equal(response.status,200,route); assert.equal(new URL(response.url).pathname.startsWith('/apps/'),true,route); assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(root,source)),route);
    }
    for (const route of ['/apps/customer/admin-page/dashboard.html','/apps/team/customer-auth/auth','/apps/customer/backend/.env','/apps/customer/home-page/%2e%2e/backend/.env']) { const response=await fetch(base+route);assert([403,404].includes(response.status),route+': '+response.status); }
    for (const app of ['customer','team']) {
      const manifest=await fetch(base+`/apps/${app}/manifest.webmanifest`);assert.match(manifest.headers.get('content-type'),/manifest\+json/);assert.equal((await manifest.json()).scope,`/apps/${app}/`);
      const worker=await fetch(base+`/apps/${app}/sw.js`);assert.equal(worker.status,200);assert.match(worker.headers.get('cache-control'),/no-store/);
      assert.equal((await fetch(base+`/apps/${app}/`)).status,200);
      assert.equal((await fetch(base+`/apps/${app}/install.html`)).status,200);
    }
  } finally { spawnSync(binary,['-d',slash(apache),'-f',config,'-k','shutdown'],{windowsHide:true,timeout:5000});process.kill(); }
});
