// Real canonical portal scripts and dialogs with an isolated persistent API fixture.
// Pricing, authorization and database persistence are verified in ShippingQuotesTest.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=({data})=>{const reply=JSON.parse(data),job=pending.get(reply.id);if(!job)return;pending.delete(reply.id);reply.error?job.reject(Error(JSON.stringify(reply.error))):job.resolve(reply.result);};
  return {send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method));},15000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id:key,method,params}));});},close(){socket.close();}};
}
test('Admin and Staff report preview and print PDF share clean summary metadata and certification',{skip:!fs.existsSync(chrome),timeout:180000},async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-reports-'));let generations=0;
  const report={report:{id:'RPT-LOCAL',title:'Overall Sales Report',category:'sales',period:'monthly',period_label:'November 2026',start_date:'2026-11-01',end_date:'2026-11-30',timezone:'Asia/Manila',generated_at:'2026-11-02T08:00:00+08:00',generated_by:'Records Officer',generated_by_role:'Admin'},metrics:[{label:'Completed orders',value:27,format:'integer'},{label:'Sales',value:6750,format:'currency'},{label:'Average order value',value:250,format:'currency'}],chart:{title:'Sales trend',value_type:'currency',labels:['Week 1','Week 2','Week 3'],series:[{name:'Sales',values:[2500,2000,2250]}]},breakdown:{title:'Payment methods',value_type:'currency',items:[{label:'COD',value:3500},{label:'Online',value:3250}]},table:{title:'Completed orders',columns:[{key:'order_no',label:'Order',type:'text'},{key:'customer',label:'Customer',type:'text'},{key:'date',label:'Date',type:'date'},{key:'total',label:'Payable total',type:'currency'}],rows:Array.from({length:27},(_,i)=>({order_no:'ORD-'+String(i+1).padStart(5,'0'),customer:'Report Customer '+(i+1),date:'2026-11-02',total:250}))}};
  const server=http.createServer(async(req,res)=>{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname),role=String(req.headers.authorization||'').includes('staff')?'staff':'admin';const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(route.startsWith('/api/')){
      if(route==='/api/user')return json({id:11,role,email:role+'@gmail.com',name:'Records Officer'});
      if(route==='/api/admin/preferences')return json({user_id:11,preferences:{theme:'light',compact:false,reducedMotion:false}});
      if(route==='/api/admin/session')return json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:new Date(Date.now()+21600000).toISOString()});
      if(route==='/api/site-settings')return json({data:{}});
      if(route==='/api/admin/reports'||route==='/api/admin/reports/generate'){if(req.method==='POST')generations++;return json({data:{...report,report:{...report.report,generated_by_role:role==='staff'?'Staff':'Admin'}}});}
      return json({data:[]});
    }
    const file=path.resolve(root,'.'+route);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');let content=fs.readFileSync(file);
    if(ext==='.html')content=content.toString().replace('<head>',`<head><script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',event=>{if(event.message)fixtureErrors.push(event.message)});addEventListener('unhandledrejection',event=>fixtureErrors.push(String(event.reason)));for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:11,role,email:role+'@gmail.com',name:'Records Officer'}));}</script>`);res.end(content);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let cdp;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup')),15000);browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.once('error',reject);});
    const tabs=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();cdp=await connect(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
    const run=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const until=async expression=>{for(let i=0;i<180;i++){try{if(await run(expression))return;}catch(error){if(!/context|navigated/i.test(error.message))throw error;}await pause(45);}throw Error('Timeout: '+expression+'; '+JSON.stringify(await run('({url:location.href,errors:fixtureErrors,popup:document.getElementById("customerSystemPopupMessage")?.textContent,shipping:document.getElementById("checkoutShippingMessage")?.textContent})')));};
    const navigate=async route=>{await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+route});await until(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'`);};
    const input=async(id,value)=>run(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const confirm=async title=>{await until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);await run(`document.getElementById('adminSystemPopupOk').click()`);};
    const shot=async name=>{const image=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'));};
    for(const portal of ['admin','staff']){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await navigate('/'+portal+'-page/reports.html');await until(`!document.getElementById('reportPreviewBtn').disabled`);
      await run(`document.getElementById('reportPreviewBtn').click()`);await until(`document.querySelectorAll('.official-report-page').length>1&&!document.getElementById('reportPrintBtn').disabled`);
      const metadata=await run(`Array.from(document.querySelector('.official-report-summary-content').querySelectorAll('.official-report-metadata dt')).map(node=>node.textContent)`);
      assert.deepEqual(metadata,['Report ID','Category','Coverage','Reporting period','Generated','Time zone']);
      assert.match(await run(`document.querySelector('.official-report-summary-content').textContent`),/Prepared by/,'certification retained');
      assert.match(await run(`document.querySelector('.official-report-summary-content').textContent`),/Records Officer/);
      const pageCount=await run(`document.querySelectorAll('.official-report-page').length`);assert(pageCount>=2);
      assert.equal(await run(`document.querySelectorAll('.official-header-unit > span').length`),0,'Sales report pages omit the unit email and phone line');
      assert.equal(await run(`Array.from(document.querySelectorAll('.official-header-unit strong')).every(node=>node.textContent==='FABRICATION AND MANUFACTURING RESEARCH CENTER')`),true,'Issuing unit remains in the report header');
      for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await shot(portal+'-preview-'+width);}
      await run(`window.print=()=>{window.fixturePrintReady=true};document.getElementById('reportPrintBtn').click()`);await until(`window.fixturePrintReady===true&&document.body.classList.contains('report-printing')`);
      const fit=await run(`Array.from(document.querySelectorAll('.official-report-page')).map(page=>{const content=page.querySelector('.official-report-body');return {width:page.clientWidth,height:page.clientHeight,overflow:content.scrollHeight>content.clientHeight+2,scale:content.style.transform}})`);assert(fit.every(page=>!page.overflow||page.scale),'each print page fits or has measured scaling');
      assert.equal(await run(`document.querySelectorAll('.official-header-unit > span').length`),0,'Printed sales pages use the same header');
      const pdf=await cdp.send('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true});fs.writeFileSync(path.join(artifacts,portal+'-report.pdf'),Buffer.from(pdf.data,'base64'));
      await run(`window.dispatchEvent(new Event('afterprint'))`);assert.equal(await run(`document.body.classList.contains('report-printing')`),false);assert.deepEqual(await run('fixtureErrors'),[]);
    }
    assert.equal(generations,2,'printing remains an audited generation in both portals');console.log('Verified shared first-page metadata, certification, responsive previews and print lifecycle. PDF artifacts: '+artifacts);
  }finally{cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
