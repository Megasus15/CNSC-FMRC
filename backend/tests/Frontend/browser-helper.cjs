const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
async function browserSession(work) {
  if (!chrome) throw Error('Chrome or Edge is required for browser verification.');
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-product-gallery-'));
  const browser = spawn(chrome, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'], {windowsHide:true,stdio:['ignore','ignore','pipe']});
  let socket;
  try {
    const endpoint = await new Promise((resolve,reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(Error('Browser startup timeout')),15000);
      browser.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if(match) {clearTimeout(timeout); resolve(match[1]);} });
      browser.once('error', reject);
    });
    const targets = await (await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve,reject) => {socket.onopen=resolve; socket.onerror=reject;});
    let id = 0;
    const pending = new Map();
    socket.onmessage = ({data}) => {const result=JSON.parse(data); const entry=pending.get(result.id); if(entry) {pending.delete(result.id); result.error?entry.reject(Error(JSON.stringify(result.error))):entry.resolve(result.result);} };
    const send = (method,params={}) => new Promise((resolve,reject) => {
      const key=++id;
      const timeout=setTimeout(() => {pending.delete(key);reject(Error('CDP timeout: '+method));},20000);
      pending.set(key,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
      socket.send(JSON.stringify({id:key,method,params}));
    });
    const run = async expression => {
      const reply=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(reply.exceptionDetails) throw Error(JSON.stringify(reply.exceptionDetails));
      return reply.result.value;
    };
    const until = async expression => {
      for(let attempt=0;attempt<200;attempt++) {
        try {if(await run(expression)) return;} catch(error) {if(!/context|navigated/i.test(error.message)) throw error;}
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      throw Error('Timed out: '+expression+'; '+JSON.stringify(await run('({url:location.href,errors:window.fixtureErrors})')));
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await send('Network.setBlockedURLs',{urls:['https://*']});
    return await work({send,run,until,artifacts});
  } finally {socket?.close(); browser.kill();}
}
module.exports={browserSession,chrome};
