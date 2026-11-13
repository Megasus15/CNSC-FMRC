// Real shared portals with two independent browser profiles and a persistent API
// fixture. Database authorization and locking are exercised by PHP tests.
const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('multiple Admins share records while identity, preferences, notifications and browser settings stay personal',{skip:!chrome,timeout:120000},async t=>{
  const a={id:11,role:'admin',is_builtin_admin:true,name:'Alpha Admin',username:'alpha',email:'alpha.admin@gmail.com'},b={id:33,role:'admin',name:'Beta Admin',username:'beta',email:'beta.admin@gmail.com'};
  let users=[a,b,{id:22,role:'staff',name:'Team Staff',username:'team',email:'team.staff@gmail.com'},...Array.from({length:17},(_,i)=>({id:100+i,role:'customer',name:'Customer '+i,username:'customer'+i,email:`customer${i}@gmail.com`}))];
  const prefs=new Map(),states=new Map(),writes=[];
  let failCreate=false,failDelete=false,failNotifications=false,holdIdentity=false,releases=[];
  const events=[{id:71,type:'order',title:'New order request',message:'A shared order requires review.'},{id:72,type:'account_request',title:'Staff access request',message:'A request is waiting.'},{id:73,type:'appointment',title:'New appointment',message:'An appointment requires review.'}].map(e=>({...e,created_at:new Date().toISOString(),metadata:{}}));
  const identity=req=>Number(String(req.headers.authorization||'').replace('Bearer fixture-',''))||11;
  const state=(id,event)=>{const key=id+':'+event;if(!states.has(key))states.set(key,{read:false,hidden:false});return states.get(key);};
  const handler=async({req,route,json})=>{
    const id=identity(req),user=users.find(u=>u.id===id)||a;
    if(route==='/api/user'){
      if(holdIdentity&&id===11)await new Promise(resolve=>releases.push(resolve));
      json(user);return true;
    }
    if(route==='/api/admin/preferences'){
      if(req.method==='PUT'){let body='';for await(const c of req)body+=c;prefs.set(id,JSON.parse(body));}
      json({user_id:id,preferences:prefs.get(id)||{theme:'light',compact:false,reducedMotion:false,sidebarWidth:270,sidebarLabel:'UCN-FMRC',sidebarLogo:''}});return true;
    }
    if(route==='/api/users'){
      if(req.method==='POST'){
        let body='';for await(const c of req)body+=c;const input=JSON.parse(body);writes.push(input);
        await new Promise(resolve=>setTimeout(resolve,120));
        if(failCreate){json({message:'Temporary failure. Your entries are still here.'},503);return true;}
        const created={id:200+users.length,name:input.name,username:input.username,email:input.email,role:input.role,created_at:new Date().toISOString()};
        users.push(created);json({data:created},201);return true;
      }
      json({data:users.map(u=>({...u,created_at:u.created_at||'2026-11-01T00:00:00Z',can_delete:u.id!==id&&!u.is_builtin_admin,delete_block_reason:u.is_builtin_admin?'The built-in Admin account is protected and cannot be deleted.':u.id===id?'Your signed-in account cannot be deleted.':null}))});return true;
    }
    if(/^\/api\/users\/\d+$/.test(route)&&req.method==='DELETE'){
      const target=Number(route.split('/').pop());
      if(failDelete){json({message:'The account changed. Review the current directory.'},422);return true;}
      if(target===id||users.find(u=>u.id===target)?.is_builtin_admin){json({message:'This Admin account is protected.'},422);return true;}
      users=users.filter(u=>u.id!==target);json({message:'User account deleted successfully.'});return true;
    }
    if(route==='/api/admin/notifications'||route==='/api/admin/notifications/unread-count'){
      const data=events.filter(e=>(user.role==='admin'||e.type!=='account_request')&&!state(id,e.id).hidden).map(e=>({...e,is_read:state(id,e.id).read}));
      json({user_id:id,data,unread_count:data.filter(e=>!e.is_read).length});return true;
    }
    if(route.startsWith('/api/admin/notifications/')){
      if(failNotifications){json({message:'Personal notifications are temporarily unavailable.'},503);return true;}
      const suffix=route.split('/notifications/')[1];
      for(const e of events){
        if(user.role!=='admin'&&e.type==='account_request')continue;
        if(suffix==='mark-all-read'||suffix===e.id+'/read')state(id,e.id).read=true;
        if(suffix==='clear-all'||suffix===String(e.id))state(id,e.id).hidden=true;
      }
      json({user_id:id,message:'Updated'});return true;
    }
    return false;
  };
  const setup=initial=>`{const id=Number(sessionStorage.getItem('fixture_admin_id')||${initial});const user=${JSON.stringify([a,b])}.find(u=>u.id===id);localStorage.setItem('admin_auth_token','fixture-'+id);localStorage.setItem('admin_user_info',JSON.stringify(user));localStorage.setItem('staff_auth_token','fixture-22');localStorage.setItem('staff_user_info',JSON.stringify({id:22,role:'staff',name:'Team Staff',email:'team.staff@gmail.com'}));}`;
  const h=await browserFixture(t,handler,{setup:setup(11)}),peer=await browserFixture(t,handler,{setup:setup(33)});
  for(const browser of [h,peer])await browser.send('Network.setBlockedURLs',{urls:['https://*']});
  const ready=browser=>browser.until(`document.querySelector('[data-user-view]') && !document.querySelector('.admin-global-page-skeleton')`);
  const notifyReady=browser=>browser.until(`document.querySelectorAll('#notifBody .notif-item').length>0`);
  const closePopup=async browser=>browser.run(`if(document.getElementById('adminSystemPopup')?.classList.contains('show'))document.getElementById('adminSystemPopupOk').click()`);
  await h.go('/admin-page/accounts.html');await ready(h);
  await peer.go('/admin-page/accounts.html');await ready(peer);
  assert.equal(await peer.run(`document.querySelector('[data-user-delete="11"]').disabled`),true,'a peer cannot delete the built-in Admin');
  assert.equal(await peer.run(`document.querySelector('[data-admin-bulk-row="users"][value="11"]').disabled`),true,'bulk selection also protects the built-in Admin');
  assert.equal(await peer.run(`document.querySelector('[data-user-delete="11"]').getAttribute('aria-label')`),'The built-in Admin account is protected and cannot be deleted.');
  assert.equal(await peer.run(`document.querySelector('.accounts-builtin-label').textContent`),'Built-in Admin · Protected');
  await h.run(`document.getElementById('accountsSearchInput').value='customer0';document.getElementById('accountsSearchInput').dispatchEvent(new Event('input'))`);
  assert.equal(await h.run(`document.querySelector('[data-user-delete="100"]').disabled`),false,'the built-in Admin can delete other users');
  await h.run(`document.querySelector('[data-user-delete="100"]').click()`);
  await h.until(`document.getElementById('modalDeleteAccount').classList.contains('show')`);
  assert.match(await h.run(`document.getElementById('modalDeleteAccount').textContent`),/payment records will be preserved/);
  failDelete=true;
  await h.run(`document.getElementById('btnConfirmDeleteAccount').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Delete Failed'`);
  assert.equal(await h.run(`document.getElementById('modalDeleteAccount').classList.contains('show')`),true,'failed deletion stays reviewable');
  assert(users.some(u=>u.id===100));
  await closePopup(h);failDelete=false;
  await h.run(`document.getElementById('btnConfirmDeleteAccount').click()`);
  await h.until(`!document.getElementById('modalDeleteAccount').classList.contains('show')&&!document.querySelector('[data-user-delete="100"]')`);
  await closePopup(h);
  assert(!users.some(u=>u.id===100));
  await h.run(`document.getElementById('accountsSearchInput').value='';document.getElementById('accountsSearchInput').dispatchEvent(new Event('input'))`);
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await h.until(`!document.querySelector('.fmrc-load-veil.is-on')`);await h.pause(350);
  await h.until(`document.querySelector('#accountsTable .atr-handle')!==null`);
  await h.run(`window.fixtureResizeHandle=[...document.querySelectorAll('#accountsTable .atr-handle')].find(e=>e.getBoundingClientRect().width>0 && e.closest('th').textContent.includes('Name'));fixtureResizeHandle.scrollIntoView({block:'center',behavior:'instant'})`);
  const handle=await h.run(`(()=>{const r=fixtureResizeHandle.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x,y:handle.y});
  await h.send('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'left',clickCount:1});
  await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+40,y:handle.y,button:'left',buttons:1});
  await h.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+40,y:handle.y,button:'left',clickCount:1});
  await h.until(`Object.keys(localStorage).some(k=>k.startsWith('fmrc:user:11:fmrc.colw.'))`);
  assert.equal(await peer.run(`Object.keys(localStorage).some(k=>k.startsWith('fmrc:user:11:fmrc.colw.'))`),false,'real table-width saves are personal');
  assert.equal(await h.run(`document.querySelector('.popup-identity').textContent`),a.email);
  assert.equal(await peer.run(`document.querySelector('.popup-identity').textContent`),b.email);
  await h.run(`(()=>{const values={createUserName:'Gamma Admin',createUserRole:'admin',createUserUsername:'gamma_admin',createUserEmail:'gamma.admin@gmail.com',createUserPassword:'NewAdmin123!',createUserPasswordConfirm:'NewAdmin123!'};for(const [id,value]of Object.entries(values)){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  assert.equal(await h.run(`document.getElementById('createAdminAccessHint').hidden`),false);
  await h.run(`document.getElementById('btnCreateUser').click();document.getElementById('adminCreateUserForm').dispatchEvent(new Event('submit',{cancelable:true}))`);
  await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Create Admin Account'`);
  assert.equal(writes.length,0,'confirmation precedes creation');
  await h.run(`document.getElementById('adminSystemPopupCancel').click()`);
  assert.equal(await h.run(`document.getElementById('createUserUsername').value`),'gamma_admin');
  failCreate=true;
  await h.run(`document.getElementById('btnCreateUser').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show')`);
  await h.run(`document.getElementById('adminSystemPopupOk').click();document.getElementById('adminCreateUserForm').dispatchEvent(new Event('submit',{cancelable:true}))`);
  await h.until(`!document.getElementById('btnCreateUser').disabled && document.getElementById('accountsFormStatus').textContent.includes('Temporary failure')`);
  assert.equal(writes.length,1,'duplicate submit cannot create a second pending request');
  assert.equal(await h.run(`document.getElementById('createUserUsername').value`),'gamma_admin');
  failCreate=false;
  await h.run(`document.getElementById('btnCreateUser').click()`);await h.until(`document.querySelector('#adminSystemPopup.show')`);
  await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  await h.until(`document.getElementById('createUserName').value==='' && !document.getElementById('btnCreateUser').disabled`);
  await closePopup(h);
  assert.equal(writes.length,2);
  assert.equal(users.filter(u=>u.username==='gamma_admin').length,1);
  await peer.run(`document.getElementById('accountsSearchInput').value='gamma';document.getElementById('accountsSearchInput').dispatchEvent(new Event('input'));window.AdminLiveData.publish('users')`);
  await peer.until(`document.getElementById('accountsTableBody').textContent.includes('Gamma Admin')`);
  assert.equal(await peer.run(`document.getElementById('accountsSearchInput').value`),'gamma');
  await h.run(`document.getElementById('accountsCurrentPage').value='2';document.getElementById('accountsCurrentPage').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('createUserName').value='Unsaved draft';window.AdminLiveData.publish('users')`);
  await h.pause(250);
  assert.equal(await h.run(`document.getElementById('createUserName').value`),'Unsaved draft');
  assert.equal(await h.run(`document.getElementById('accountsCurrentPage').value`),'2');

  await notifyReady(h);await notifyReady(peer);
  await h.run(`document.getElementById('notifMarkAllBtn').click()`);
  await h.until(`document.querySelector('.notifications .badge')?.textContent===''`);
  await peer.run(`refreshAdminNotifications()`);
  assert.equal(await peer.run(`document.querySelector('.notifications .badge').textContent`),'3','peer badge stays unread');
  failNotifications=true;
  await peer.run(`document.getElementById('notifMarkAllBtn').click()`);
  await peer.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Notifications Not Updated'`);
  assert.equal(await peer.run(`document.querySelector('.notifications .badge').textContent`),'3','failure restores the badge');
  failNotifications=false;await closePopup(peer);
  await h.run(`document.getElementById('notifViewAllBtn').click()`);await h.until(`document.getElementById('allNotifOverlay').classList.contains('show')`);
  await h.run(`document.getElementById('allNotifClearAll').click()`);await h.until(`document.querySelectorAll('#allNotifList .notif-item').length===0`);
  await peer.run(`refreshAdminNotifications()`);
  assert.equal(await peer.run(`document.querySelector('.notifications .badge').textContent`),'3');
  await h.run(`document.getElementById('allNotifClose').click()`);

  await h.go('/admin-page/settings.html');await h.until(`window.AdminPreferences?.get().theme==='light'`);
  await h.run(`AdminPreferences.set({theme:'dark',sidebarLabel:'Alpha workspace'});AdminSession.writePersonal('fmrc_inv_last_category','Alpha category');AdminSession.writePersonal('fmrc.colw.test','Alpha widths')`);
  await h.until(`/Saved/i.test(document.getElementById('settingsSaveStatus').textContent)`);
  await peer.go('/admin-page/settings.html');await peer.until(`window.AdminPreferences?.get().theme==='light'`);
  assert.equal(await peer.run(`AdminPreferences.get().sidebarLabel`),'UCN-FMRC');
  assert.equal(await peer.run(`AdminSession.readPersonal('fmrc.colw.test')`),null);
  await peer.run(`AdminPreferences.set({sidebarLabel:'Beta workspace'})`);await peer.until(`/Saved/i.test(document.getElementById('settingsSaveStatus').textContent)`);
  assert.equal(prefs.get(11).theme,'dark');assert.equal(prefs.get(33).theme,'light');

  // A delayed identity response from A must not replace B after sign-in changes.
  holdIdentity=true;await h.go('/admin-page/my-account.html');await h.until(`document.querySelector('.popup-identity').textContent===${JSON.stringify(a.email)}`);
  await h.run(`localStorage.setItem('admin_auth_token','fixture-33');localStorage.setItem('admin_user_info',${JSON.stringify(JSON.stringify(b))});sessionStorage.setItem('fixture_admin_id','33')`);
  holdIdentity=false;releases.splice(0).forEach(release=>release());await h.pause(200);
  assert.equal(await h.run(`JSON.parse(localStorage.getItem('admin_user_info')).id`),33);
  await h.go('/admin-page/my-account.html');await h.until(`document.getElementById('currentGmailValue').textContent===${JSON.stringify(b.email)}`);
  assert.equal(await h.run(`document.querySelector('.account-name').textContent`),b.name);
  assert.equal(await h.run(`AdminSession.readPersonal('fmrc_inv_last_category')`),null);
  assert.equal(await h.run(`document.documentElement.dataset.theme`),'light');

  for(const role of ['admin','staff'])for(const page of ['accounts','my-account','settings']){
    if(role==='staff'&&page==='accounts')continue;
    await h.go(`/${role}-page/${page}.html`);
    await h.until(`!document.querySelector('.admin-global-page-skeleton')`);
    if(page==='accounts')await ready(h);
    if(page==='my-account')await h.until(`document.getElementById('emailInput').value.length>0`);
    for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440]){
      await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await h.pause(350);
      assert.equal(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`),true,`${role} ${page} ${theme} ${width} fits`);
      const navigation=await h.run(`({right:document.querySelector('.sidebar').getBoundingClientRect().right,left:document.querySelector('.main-content').getBoundingClientRect().left})`);
      assert(navigation.right<=Math.max(1,navigation.left+1),`${role} ${page} ${width}: navigation does not cover content ${JSON.stringify(navigation)}`);
      if(page==='accounts')assert.equal(await h.run(`document.querySelector('[data-user-delete="33"]').disabled`),true,'own account protected');
      if(width===390&&theme==='dark'){
        if(page==='accounts')await h.run(`document.getElementById('createUserRole').value='admin';document.getElementById('createUserRole').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.accounts-form-panel').scrollIntoView({block:'start',behavior:'instant'})`);
        await h.shot(`multiple-admin-${role}-${page}-390-dark`);
      }
    }
    await h.run(`document.getElementById('notifViewAllBtn')?.click()`);
    await h.until(`document.getElementById('allNotifOverlay')?.classList.contains('show')`);
    await h.pause(350);
    assert.equal(await h.run(`document.getElementById('allNotifOverlay').scrollWidth<=innerWidth+1`),true);
    if(role==='staff')assert.equal(await h.run(`document.getElementById('allNotifList').textContent.includes('Staff access request')`),false);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  console.log('Multiple Admin browser screenshots:',h.artifacts);
});
