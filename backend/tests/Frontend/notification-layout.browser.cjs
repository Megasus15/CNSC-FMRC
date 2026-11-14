const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('Shared notification actions leave readable text space and the full-height drawer closes on outside click', {skip:!chrome,timeout:120000},async t=>{
  const seed=()=>[
    {id:1,type:'order',title:'Order Cancelled by Customer: ORD-261114-00149',message:'A customer cancelled an order. The saved reason and order history remain available.',metadata:{order_id:149,order_no:'ORD-261114-00149'}},
    {id:2,type:'appointment',title:'New Appointment: AP-00053',message:'An appointment request is ready for review.',metadata:{appointment_id:53}},
    {id:3,type:'info',title:'A detailed <literal> notification title with a reference that must stay available',message:'Long message content '.repeat(10),metadata:{}},
  ].map(n=>({...n,is_read:false,created_at:new Date().toISOString()}));
  const feeds=new Map();let fail=false;
  const font=process.env.FMRC_BROWSER_POPPINS;
  const setup=font?`{const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);}`:'';
  const h=await browserFixture(t,({req,route,json,role})=>{
    if(route.startsWith('/api/admin/notifications')){
      if(!feeds.has(role))feeds.set(role,seed());let feed=feeds.get(role);
      if(req.method!=='GET'){
        if(fail){json({message:'Your notification changes could not be saved.'},503);return true;}
        const suffix=route.split('/notifications/')[1];
        feed=feed.filter(n=>suffix!=='clear-all'&&suffix!==String(n.id)).map(n=>suffix==='mark-all-read'||suffix===n.id+'/read'?{...n,is_read:true}:n);feeds.set(role,feed);
      }
      json({user_id:role==='admin'?11:22,data:feed,unread_count:feed.filter(n=>!n.is_read).length,message:'Updated'});return true;
    }
    return false;
  },{setup});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const click=selector=>h.run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  for(const role of ['admin','staff'])for(const page of ['dashboard','promotions','appointments']){
    feeds.set(role,seed());await h.go('/'+role+'-page/'+page+'.html');await h.until(`document.querySelectorAll('#notifBody .notif-item').length===3&&!document.querySelector('.admin-global-page-skeleton')`);
    if(page==='promotions')assert.equal(await h.run(`(()=>{const n=document.querySelector('.campaign-preview-heading'),probe=document.createElement('span');probe.style.color='var(--portal-accent,#800000)';n.append(probe);const accent=getComputedStyle(probe).color;probe.remove();return getComputedStyle(n).color===accent&&getComputedStyle(n.querySelector('i')).color===accent;})()`),true,'Preview heading and icon share the maroon accent');
    for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440]){
      await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await h.run(`document.documentElement.dataset.theme='${theme}'`);await click('.notifications');
      await h.until(`document.querySelector('.notification-dropdown.show')`);await h.run(`Promise.all(document.querySelector('.notification-dropdown').getAnimations().map(a=>a.finished.catch(()=>{})))`);
      const g=await h.run(`(()=>{const d=document.querySelector('.notification-dropdown'),r=d.getBoundingClientRect(),n=d.querySelector('.notif-item'),b=n.querySelector('.notif-item-body').getBoundingClientRect(),a=n.querySelector('.notif-item-actions').getBoundingClientRect(),buttons=[...n.querySelectorAll('button')].map(n=>n.getBoundingClientRect());return{fit:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight+1,body:b.width,rail:a.width,buttons:buttons.map(r=>({width:r.width,height:r.height,left:r.left,top:r.top,bottom:r.bottom})),wrap:getComputedStyle(n.querySelector('.notif-item-title')).whiteSpace};})()`);
      assert(g.fit&&g.body>=140&&g.rail<=44.5&&g.wrap==='normal',`${role} ${page} ${width}: ${JSON.stringify(g)}`);
      assert(g.buttons.every(b=>b.width>=44&&b.height>=44));assert(g.buttons[1].top>=g.buttons[0].bottom,'Actions stack without taking text width');
      assert.match(await h.run(`document.querySelector('#notifBody .notif-item-title').textContent`),/^Customer cancelled an order: ORD-261114-00149$/);
      assert.equal(await h.run(`document.querySelector('#notifBody .notif-item-title').title`),'Customer cancelled an order: ORD-261114-00149');
      assert.equal(await h.run(`document.querySelector('#notifBody literal')`),null);
      if(page==='appointments'&&[390,1440].includes(width))await h.shot(`notifications-${role}-dropdown-${width}-${theme}`);
      await click('#notifViewAllBtn');await h.until(`document.querySelector('#allNotifOverlay.show')`);
      await h.run(`Promise.all(document.querySelector('.all-notif-panel').getAnimations().map(a=>a.finished.catch(()=>{})))`);
      const drawer=await h.run(`(()=>{const r=document.querySelector('.all-notif-panel').getBoundingClientRect();return{top:r.top,bottom:r.bottom,right:r.right};})()`);assert.deepEqual(drawer,{top:0,bottom:900,right:width});
      if(page==='appointments'&&[390,1440].includes(width))await h.shot(`notifications-${role}-drawer-${width}-${theme}`);
      if(width===1440){
        await h.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:100,y:450});await h.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:100,y:450});
      }else await click('#allNotifBackdrop');
      await h.until(`!document.querySelector('#allNotifOverlay.show')&&document.body.style.position!=='fixed'`);
    }
    await h.run(`openAllNotificationsPanel()`);fail=true;await click('#allNotifMarkAll');await h.until(`document.querySelector('#adminSystemPopup.show')`);await click('#allNotifBackdrop');assert.equal(await h.run(`document.getElementById('allNotifOverlay').classList.contains('show')`),true,'Outside click cannot dismiss an inert drawer beneath feedback');await click('#adminSystemPopupOk');fail=false;
    await click('#allNotifMarkAll');await h.until(`document.querySelectorAll('#allNotifList .notif-read-btn').length===0`);assert(feeds.get(role).every(n=>n.is_read));await click('#allNotifBackdrop');await h.until(`document.body.style.position!=='fixed'`);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  console.log('Shared notification previews:',h.artifacts);
});
