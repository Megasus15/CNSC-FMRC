const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserFixture(t, apiHandler = () => null, {setup = ''} = {}) {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-website-fields-'));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let route = decodeURIComponent(url.pathname);
    const json = (data, status = 200, headers = {}) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data)); };
    try {
      if (route.startsWith('/api/')) {
        const role = String(req.headers.authorization || '').includes('staff') ? 'staff' : 'admin';
        if (await apiHandler({req, res, route, json, role})) return;
        if (route === '/api/user') return json({id:role === 'admin' ? 11 : 22, role, email:role+'@example.test', username:'Fixture'});
        if (route === '/api/admin/preferences') return json({user_id:role === 'admin' ? 11 : 22,preferences:{theme:'light',compact:false,reducedMotion:false}});
        if (route === '/api/admin/session') return json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:new Date(Date.now()+21600000).toISOString()});
        if (route === '/api/maintenance') return json({installed:true,data:{},site_page_installed:true,site_page:{}});
        if (route === '/api/site-settings') return json({data:{}});
        return json({data:[],appointments:[],orders:[],promotions:[]});
      }
      route = route.replace(/^\/apps\/(?:team|customer)\//, '/');
      if (route === '/home-page/') route = '/home-page/main.html';
      if (!path.extname(route)) route += '.html';
      const file = path.resolve(root, '.' + route);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
      let body = fs.readFileSync(file);
      if (file.endsWith('.html')) body = body.toString().replace('<head>', `<head><script>
        window.APP_API_BASE_URL=location.origin+'/api';
        window.fixtureErrors=[];
        addEventListener('error',e=>fixtureErrors.push(e.message));
        addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
        for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:role==='admin'?11:22,role,email:role+'@example.test'}));}
        ${setup}
      </script>`);
      res.end(body);
    } catch(error) { json({message:error.message},500); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  const browser = spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint = await new Promise((resolve,reject) => {
    let output=''; const timer=setTimeout(()=>reject(Error('Browser startup timeout')),15000);
    browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    browser.once('error',reject);
  });
  const listTabs = async () => (await fetch('http://127.0.0.1:' + new URL(endpoint).port + '/json/list')).json();
  const targets=await listTabs();
  const socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let seq=0;const pending=new Map(),listeners=new Map();
  const on=(method,listener)=>{listeners.set(method,listener);};
  socket.onmessage=({data})=>{const reply=JSON.parse(data);if(reply.method){listeners.get(reply.method)?.(reply.params);return;}const job=pending.get(reply.id);if(!job)return;pending.delete(reply.id);clearTimeout(job.timer);reply.error?job.reject(Error(JSON.stringify(reply.error))):job.resolve(reply.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  t.after(async()=>{socket.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  for(const method of ['Page.enable','Runtime.enable','DOM.enable','CSS.enable','Network.enable'])await send(method);
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const run=async expression=>{const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description||reply.exceptionDetails.text);return reply.result.value;};
  const until=async expression=>{for(let i=0;i<150;i++){try{if(await run(expression))return;}catch{}await pause(40);}throw Error('Timeout: '+expression+' '+JSON.stringify(await run('fixtureErrors')));};
  const go=async route=>{const previous=await run('performance.timeOrigin');await send('Page.navigate',{url:base+route});await until(`performance.timeOrigin!==${previous} && document.readyState==='complete'`);await pause(300);};
  const shot=async name=>{const data=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(data.data,'base64'));};
  return {base,artifacts,send,on,run,until,go,shot,pause,listTabs};
}
module.exports={browserFixture,chrome,root};
