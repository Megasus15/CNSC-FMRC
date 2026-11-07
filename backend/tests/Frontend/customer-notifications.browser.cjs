// Actual customer page styles, bell and notification scripts; private API fixtures only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(url){const ws=new WebSocket(url),pending=new Map();let id=0;await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const result=JSON.parse(event.data),entry=pending.get(result.id);if(!entry)return;pending.delete(result.id);result.error?entry.reject(Error(JSON.stringify(result.error))):entry.resolve(result.result);};return{send(method,params={}){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP timeout: '+method)),10000);pending.set(++id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}));});},close(){ws.close();}};}
test('one customer bell separates personal updates from announcements across pages and PWA routes',{skip:!fs.existsSync(chrome),timeout:180000},async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-customer-bell-'));
  let unread=0,fail=false,failDelete=false,injectDuringClear=false,reads=0,requests=0,deletes=0;
  const publicItem={id:1,title:'FMRC Announcement',message:'The laboratory will open on Monday.',is_enabled:true};
  const record={id:54,type:'appointment',title:'Consultation outcome saved',message:'Your quotation is being prepared. Open your appointment for the latest update.',target:'/home-page/?my_appointments=1&appointment_id=54',published_at:'2026-11-07T03:00:00Z',read_at:null};
  let records=[record,{...record,id:53}];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture'),route=url.pathname;
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(route.startsWith('/api/')){
      if(route==='/api/announcements')return json({data:[publicItem]});
      if(route.startsWith('/api/customer/notifications')){
        requests++;assert.equal(url.searchParams.get('scope'),'personal');assert.equal(req.headers.authorization,'Bearer fixture-customer');
        if(fail)return json({message:'Fixture unavailable'},503);
        if(req.method==='DELETE'){
          deletes++;if(failDelete)return json({message:'Fixture deletion unavailable'},503);
          if(route.endsWith('/clear-all')){let body='';for await(const chunk of req)body+=chunk;const {through}=JSON.parse(body);assert(Number.isInteger(through)&&through>0);if(injectDuringClear){records.unshift({...record,id:57,read_at:null});injectDuringClear=false;}records=records.filter(item=>item.id>through);}
          else records=records.filter(item=>item.id!==Number(route.split('/').at(-1)));
          unread=records.filter(item=>!item.read_at).length;return json({message:'Notifications deleted.'});
        }
        if(route.endsWith('/unread-count'))return json({unread_count:unread});
        if(route.endsWith('/mark-all-read')){reads++;unread=0;records.forEach(item=>item.read_at=new Date().toISOString());return json({read:true});}
        if(route.endsWith('/54/read')){reads++;unread=Math.max(0,unread-1);record.read_at=new Date().toISOString();return json({read:true});}
        const page=Number(url.searchParams.get('page')||1);return json({data:records.slice(page-1,page),current_page:page,last_page:Math.max(1,records.length)});
      }
      return json({data:[]});
    }
    const local=route.replace(/^\/apps\/customer/,'').replace(/^\/home-page\/$/,'/home-page/main.html');
    const file=path.resolve(root,'.'+local);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    let content=fs.readFileSync(file);const ext=path.extname(file);res.setHeader('Content-Type',ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.html'?'text/html':'application/octet-stream');
    if(ext==='.html'){
      content=content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
      content=content.replace('</body>',`<script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',JSON.stringify({id:33}));sessionStorage.setItem('fmrc_announcement_seen_1','1');if(!sessionStorage.getItem('bell-test-started')){localStorage.setItem('fmrc_announcements_read_33','["1"]');sessionStorage.setItem('bell-test-started','1');}window.FMRCApp={url:p=>location.pathname.startsWith('/apps/customer/')?'/apps/customer'+p:p};window.FMRCAppointments={open:async id=>window.openedAppointment=id};window.confirmResponse=true;window.showCustomerPopup=async(message,options)=>{window.popupMessage=message;window.popupTitle=options?.title;return options?.isConfirm?window.confirmResponse:true;};</script><script src="/home-page/customer-announcements.js"></script><script src="/home-page/customer-notifications.js"></script></body>`);
    }
    res.end(content);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let cdp;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup')),15000);browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.on('error',reject);});
    const targets=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();cdp=await connect(targets.find(item=>item.type==='page').webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
    const run=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const until=async expression=>{for(let i=0;i<160;i++){if(await run(expression))return;await pause(50);}throw Error('Timeout: '+expression+' '+JSON.stringify(await run('({body:document.body.innerText.slice(-800),errors:fixtureErrors})')));};
    const navigate=async route=>{await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+route});await until(`document.readyState==='complete'&&!!window.FMRCCustomerNotifications`);};
    await navigate('/home-page/');await until(`document.getElementById('announcementBellBadge').hidden`);
    unread=1;await pause(11000);await until(`document.getElementById('announcementBellBadge').textContent==='1'`);
    await run(`localStorage.setItem('fmrc_announcements_read_33','[]');dispatchEvent(new StorageEvent('storage',{key:'fmrc_announcements_read_33'}));document.getElementById('announcementBell').click()`);
    await until(`!!document.querySelector('[data-notification-id="54"]')`);assert.equal(await run(`document.getElementById('announcementModal').dataset.section`),'notifications');assert.equal(await run(`document.getElementById('announcementBellBadge').textContent`),'2');
    assert.equal(await run(`localStorage.getItem('fmrc_announcements_read_33')`),'[]','opening personal notifications must not read the announcement');
    await run(`document.querySelector('[data-notifications-tab="announcements"]').click()`);assert.equal(await run(`document.getElementById('announcementModalTitle').textContent`),'FMRC Announcement');assert.equal(await run(`document.getElementById('announcementBellBadge').textContent`),'1');
    await run(`document.querySelector('[data-notifications-tab="notifications"]').click()`);await until(`document.querySelector('[data-notification-id="54"]')&&!document.getElementById('customerNotificationList').getAttribute('aria-busy').includes('true')`);
    await run(`document.querySelector('[data-notification-id="54"]').click()`);await until(`window.openedAppointment==='54'`);assert.equal(reads,1);assert.equal(await run(`document.getElementById('announcementBellBadge').hidden`),true);assert.equal(await run(`document.activeElement.id`),'announcementBell');
    unread=123;await run(`dispatchEvent(new Event('focus'))`);await until(`document.getElementById('announcementBellBadge').textContent==='99+'`);
    await run(`document.getElementById('announcementBell').click()`);await until(`!!document.querySelector('[data-notification-id="54"]')`);
    await until(`!!document.querySelector('[data-notifications-read-all]:not(:disabled)')`);
    await run(`document.querySelector('[data-notifications-read-all]').click()`);await until(`document.getElementById('announcementBellBadge').hidden`);assert.equal(reads,2);assert.equal(await run(`document.getElementById('announcementBellBadge').textContent`),'');
    fail=true;await run(`dispatchEvent(new Event('focus'))`);await until(`!!document.querySelector('[data-notifications-retry]')`);fail=false;await run(`document.querySelector('[data-notifications-retry]').click()`);await until(`!!document.querySelector('[data-notification-id="54"]')`);
    for(const page of ['/about-page/about.html','/services-page/service.html','/products-page/product.html','/contact-page/contact.html','/products-page/refund-policy.html','/products-page/transaction-terms.html','/apps/customer/home-page/']){
      await navigate(page);await run(`document.getElementById('announcementBell').click()`);await until(`!!document.querySelector('[data-notification-id="54"]')`);
      assert.equal(await run(`document.querySelectorAll('#announcementBell').length`),1);
      for(const width of [320,390,768,1440]){
        await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await pause(80);
        assert.equal(await run(`(()=>{const r=document.querySelector('#announcementModal .fmrc-announcement-card').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1})()`),true,page+' '+width);
        assert.equal(await run(`['#announcementModalTitle','[data-notifications-tab]','.fmrc-notification-item','.fmrc-notifications-page'].every(selector=>getComputedStyle(document.querySelector(selector)).fontFamily.includes('Montserrat'))`),true,'shared customer typography');
        assert.equal(await run(`(()=>{const card=document.querySelector('#announcementModal .fmrc-announcement-card'),footer=document.querySelector('.fmrc-notifications-footer');return card.scrollWidth<=card.clientWidth+1&&footer.scrollWidth<=footer.clientWidth+1})()`),true,'Delete and Clear all fit at '+width);
      }
      const selector='[data-notifications-tab="announcements"]';
      const point=await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(170);
      assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),'rgb(113, 35, 48)','The tab hover completes quickly');
      assert.equal(await run(`['[data-notifications-tab]','.fmrc-notification-item','.fmrc-notification-delete','.fmrc-announcement__button','.fmrc-announcement__close'].every(selector=>getComputedStyle(document.querySelector('#announcementModal '+selector)).transitionDuration.split(',').every(t=>parseFloat(t)<=.12))`),true,'All notification controls use quick hover timing');
      await run(`document.querySelector('[data-notifications-tab="announcements"]').click()`);assert.equal(await run(`[...document.querySelectorAll('#announcementModal .fmrc-announcement__button')].filter(b=>b.getClientRects().length).every(b=>getComputedStyle(b).transitionDuration.split(',').every(t=>parseFloat(t)<=.12))`),true,'FMRC Announcements uses the same quick hover');await run(`document.querySelector('[data-notifications-tab="notifications"]').click()`);await until(`!!document.querySelector('[data-notification-id="54"]')&&!document.querySelector('[data-notification-delete="54"]').disabled`);
      assert.deepEqual(await run('fixtureErrors'),[]);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const picture=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'customer-bell.png'),Buffer.from(picture.data,'base64'));
    await run(`document.querySelector('[data-notifications-page="2"]').click()`);await until(`!!document.querySelector('[data-notification-id="53"]')&&!document.querySelector('[data-notification-delete="53"]').disabled`);
    const beforeDelete=deletes;await run(`confirmResponse=false;document.querySelector('[data-notification-delete="53"]').click()`);await until(`!document.querySelector('[data-notification-delete="53"]').disabled`);assert.equal(deletes,beforeDelete);assert.equal(await run(`document.activeElement.dataset.notificationDelete`),'53','Cancelling restores focus to Delete');
    failDelete=true;await run(`confirmResponse=true;document.querySelector('[data-notification-delete="53"]').click()`);await until(`popupTitle==='Notification not deleted'&&!document.querySelector('[data-notification-delete="53"]').disabled`);assert.equal(records.length,2);assert.match(await run('popupMessage'),/could not be deleted/);assert.equal(await run(`document.activeElement.dataset.notificationDelete`),'53');
    failDelete=false;await run(`document.querySelector('[data-notification-delete="53"]').click()`);await until(`!!document.querySelector('[data-notification-id="54"]')&&!document.querySelector('[data-notification-delete="54"]').disabled`);assert.equal(records.length,1);assert.equal(await run(`document.querySelector('.fmrc-notifications-page').textContent`),'Page 1 of 1','Deleting the final row on page two returns to the remaining page');
    records=[{...record,id:56,read_at:null},{...record,id:55,read_at:null},record];unread=2;await run(`dispatchEvent(new Event('focus'))`);await until(`!!document.querySelector('[data-notification-id="56"]')&&!document.querySelector('[data-notifications-clear]').disabled`);
    injectDuringClear=true;await run(`document.querySelector('[data-notifications-clear]').click()`);await until(`!!document.querySelector('[data-notification-id="57"]')&&!document.querySelector('[data-notifications-clear]').disabled`);assert.deepEqual(records.map(item=>item.id),[57],'Clear all retains updates that arrive after the displayed snapshot');assert.equal(await run(`document.getElementById('announcementBellBadge').textContent`),'1');
    await run(`document.querySelector('[data-notifications-tab="announcements"]').click()`);assert.match(await run(`document.getElementById('announcementModalMessage').textContent`),/laboratory will open/);assert.equal(publicItem.is_enabled,true,'Personal deletion does not delete an FMRC announcement');
    await run(`document.querySelector('[data-notifications-tab="notifications"]').click()`);await until(`!document.querySelector('[data-notifications-clear]').disabled`);await run(`document.querySelector('[data-notifications-clear]').click()`);await until(`document.querySelector('#customerNotificationList h3')?.textContent==='You’re all caught up'`);assert.equal(records.length,0);assert.equal(await run(`document.getElementById('announcementBellBadge').hidden`),true);assert.equal(await run(`document.activeElement.dataset.notificationsTab`),'notifications');
    await run(`document.getElementById('announcementModalCloseX').click();localStorage.removeItem('customer_token');dispatchEvent(new Event('focus'));document.getElementById('announcementBell').click()`);
    await until(`document.querySelector('#customerNotificationList h3')?.textContent==='Your updates, in one place'`);assert.equal(await run(`document.querySelectorAll('[data-notification-id]').length`),0);
    const before=requests;await run(`dispatchEvent(new Event('focus'))`);await pause(100);assert.equal(requests,before);
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run(`getComputedStyle(document.querySelector('[data-notifications-tab]')).transitionDuration`),'0s');assert.equal(await run(`[...document.querySelectorAll('#announcementModal .fmrc-announcement__button,#announcementModal .fmrc-announcement__close')].every(button=>getComputedStyle(button).transitionDuration==='0s')`),true,'Reduced motion applies to announcement and notification actions');
    console.log('Customer bell verified with private fixtures; screenshot: '+path.join(artifacts,'customer-bell.png'));
  }finally{cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
