/* Render the SVG icon system into platform PNG exports using local Chromium. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const apps = process.argv[2] ? [process.argv[2]] : ['customer', 'team'];
if (apps.some(app => !['customer', 'team'].includes(app))) throw Error('Choose customer or team.');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if (!chrome) throw Error('Chrome or Edge is required to render the SVG masters.');
async function connect(url) {
  const socket = new WebSocket(url), jobs = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => { const message = JSON.parse(data), job = jobs.get(message.id); if (job) { jobs.delete(message.id); message.error ? job.reject(Error(JSON.stringify(message.error))) : job.resolve(message.result); } };
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const number = ++id; jobs.set(number, { resolve, reject }); socket.send(JSON.stringify({ id: number, method, params })); }); }, close() { socket.close(); } };
}
(async () => {
  const server = http.createServer((req, res) => {
    const match = req.url.match(/^\/(customer|team)\/(master|notification)$/);
    if (!match) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style></head><body>' + fs.readFileSync(path.join(root, 'apps', match[1], 'icons', match[2] + '.svg'), 'utf8') + '</body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-icons-'));
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let client;
  try {
    const endpoint = await new Promise((resolve, reject) => { let log = ''; const timeout = setTimeout(() => reject(Error('Browser startup timeout: ' + log.slice(-500))), 15000); browser.stderr.on('data', data => { log += data; const m = log.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } }); browser.on('error', reject); });
    const tabs = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    client = await connect(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await client.send('Page.enable'); await client.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const app of apps) for (const [file, size, master] of [['icon-192',192,'master'],['icon-512',512,'master'],['maskable-512',512,'master'],['apple-touch-icon',180,'master'],['notification',96,'notification']]) {
      await client.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
      await client.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${app}/${master}` });
      for (let i = 0; i < 100; i++) {
        const result = await client.send('Runtime.evaluate', { expression: `location.pathname==='/${app}/${master}' && document.readyState==='complete'`, returnByValue: true });
        if (result.result.value) break; await new Promise(resolve => setTimeout(resolve, 30));
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      const png = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(root, 'apps', app, 'icons', file + '.png'), Buffer.from(png.data, 'base64'));
    }
    console.log(`Rendered ${apps.length * 5} platform icons for ${apps.join(', ')}.`);
  } finally { client?.close(); browser.kill(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
