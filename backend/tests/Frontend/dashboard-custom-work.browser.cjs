// Canonical portal assets with isolated data and a minimal Chart constructor fixture.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=({data})=>{const reply=JSON.parse(data),job=pending.get(reply.id);if(!job)return;pending.delete(reply.id);reply.error?job.reject(Error(JSON.stringify(reply.error))):job.resolve(reply.result);};
  return {send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error(method)),15000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id:key,method,params}));});},close(){socket.close();}};
}
test('Admin and Staff dashboard prioritize revenue and preserve workload links through refresh',{skip:!fs.existsSync(chrome),timeout:120000},async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-dashboard-custom-'));let awaiting=3;
  const server=http.createServer(async(req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname,role=String(req.headers.authorization||'').includes('staff')?'staff':'admin';
    const json=data=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(route.startsWith('/api/')){
      if(route==='/api/user')return json({id:11,role,name:'FMRC Operator',email:role+'@gmail.com'});
      if(route==='/api/admin/preferences')return json({user_id:11,preferences:{theme:'light',compact:false,reducedMotion:false}});
      if(route==='/api/admin/session')return json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:new Date(Date.now()+21600000).toISOString()});
      if(route==='/api/admin/dashboard/summary')return json({data:{counts:{appointments:4,accounts:5,orders:6,products:7,total_archives:2,total_inventory_items:8},recent_appointments:[],recent_orders:[],recent_customer_inquiries:[],custom_work:{available:true,enabled:true,awaiting_review:awaiting,quotations_awaiting_payment:2,awaiting_production:4,in_production:5}}});
      if(route==='/api/admin/dashboard/revenue')return json({data:{period:{key:'month',label:'This Month',collected:1250.50,from:'2026-11-01',to:'2026-11-30',breakdown:{online:1200.50,walkins:50,refunds:0}},previous:{label:'Previous Month',collected:1000},change:{direction:'up',percent:25.05},series:[{label:'Nov 1',amount:250},{label:'Nov 2',amount:500},{label:'Nov 3',amount:500.50}]}});
      return json({data:[]});
    }
    const file=path.resolve(root,'.'+route);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
    let content=fs.readFileSync(file);
    if(path.extname(file)==='.html')content=content.toString().replace('<head>',`<head><script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',e=>{if(e.message)fixtureErrors.push(e.message)});addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:11,role,name:'FMRC Operator',email:role+'@gmail.com'}));}window.Chart=class{constructor(ctx,cfg){this.ctx=ctx;this.config=cfg;if(ctx.canvas.id==='dashboardRevenueSparkline')window.revenueChartFixture=cfg;}destroy(){}};</script>`);
    res.end(content);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let cdp;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup')),15000);browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.once('error',reject);});
    const tabs=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();cdp=await connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
    const run=async expression=>{const reply=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result.value;};
    const until=async expression=>{for(let i=0;i<180;i++){try{if(await run(expression))return;}catch(error){if(!/context|navigated/i.test(error.message))throw error;}await pause(50);}throw Error('Timeout: '+expression+' '+JSON.stringify(await run('fixtureErrors')));};
    for(const portal of ['admin','staff']){
      awaiting=3;await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
      await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'+portal+'-page/dashboard.html'});
      await until(`!!document.getElementById('appointmentCustomWorkSummary')&&!!window.revenueChartFixture`);
      assert.equal(await run(`document.querySelector('.summary-cards').nextElementSibling.id`),'appointmentCustomWorkSummary');
      assert.equal(await run(`document.getElementById('appointmentCustomWorkSummary').nextElementSibling.id`),'dashboardAnalyticsOverview');
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-work-count]')).map(n=>n.textContent)`),['3','2','4','5']);
      assert.equal(await run(`document.querySelector('.card-revenue-hero').getAttribute('href')`),'products.html');
      assert.equal(await run(`revenueChartFixture.data.datasets[0].borderColor`),'#800000','Revenue keeps the original maroon chart');
      assert.equal(await run(`revenueChartFixture.options.scales.y.ticks.color`),'#6b7280');
      await until(`(()=>{const link=document.querySelector('[data-work-count="awaiting_review"]').closest('a');link.focus();return document.activeElement===link})()`);
      await run(`window.workLink=document.querySelector('[data-work-count="awaiting_review"]').closest('a');window.focusedBefore=document.activeElement===workLink;window.workCard=document.getElementById('appointmentCustomWorkSummary')`);
      awaiting=9;await run(`dispatchEvent(new CustomEvent('fmrc:orders-updated',{detail:{timestamp:Date.now()}}))`);
      await until(`document.querySelector('[data-work-count="awaiting_review"]').textContent==='9'`);
      const focus=await run(`({before:focusedBefore,sameLink:workLink.isConnected,sameCard:workCard===document.getElementById('appointmentCustomWorkSummary'),focused:workLink===document.activeElement,active:document.activeElement?.outerHTML.slice(0,220)})`);
      assert(focus.sameLink&&focus.sameCard&&focus.focused,'Refresh retains mounted links and keyboard focus: '+JSON.stringify(focus));
      for(const theme of ['light','dark']){
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        for(const width of [320,390,768,1440]){
          await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await pause(120);
          const layout=await run(`(()=>{const card=document.querySelector('.card-revenue-hero'),work=document.getElementById('appointmentCustomWorkSummary'),s=getComputedStyle(card),r=work.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,background:s.backgroundImage,amount:getComputedStyle(document.getElementById('dashboardRevenueAmount')).color,columns:getComputedStyle(work.querySelector(':scope > div')).gridTemplateColumns.split(' ').length,links:[...work.querySelectorAll('a')].every(a=>{const b=a.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&a.scrollWidth<=a.clientWidth+1})};})()`);
          assert.equal(layout.overflow,false,portal+' '+theme+' '+width);
          assert.match(layout.background,theme==='light'?/253, 250, 246/:/30, 34, 43/,'Revenue keeps its established neutral surface');
          assert.equal(layout.amount,theme==='light'?'rgb(128, 0, 0)':'rgb(237, 240, 245)');assert(layout.links);assert.equal(layout.columns,width<=900?2:4);
          await run(`document.querySelector('.summary-cards').scrollIntoView({block:'start',behavior:'instant'})`);
          const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,portal+'-'+theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
        }
      }
      assert.deepEqual(await run('fixtureErrors'),[]);
    }
    console.log('Verified the original revenue styling, chart configuration, workload placement, navigation and refresh focus in both portal themes. Screenshots: '+artifacts);
  }finally{cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
