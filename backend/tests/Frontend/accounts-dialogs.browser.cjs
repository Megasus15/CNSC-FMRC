// UI-only rollout against isolated data; account authorization remains on the API.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('Admin User Management shares the dialog design without changing account and staff-request operations',{skip:!chrome,timeout:180000},async t=>{
  let users=[{id:11,role:'admin',name:'Built-in Admin',username:'admin',email:'admin@gmail.com',can_delete:false,delete_block_reason:'The built-in Admin account is protected.'},{id:12,role:'customer',name:'Long <literal> account name '.repeat(5),username:'customer',email:'long.address@gmail.com',has_custom_password:false,signed_with_google:true,can_delete:true},{id:13,role:'staff',name:'Team member',username:'team',email:'team@gmail.com',can_delete:true}].map(u=>({...u,created_at:'2026-11-01T02:00:00Z'}));
  let requests=[{id:81,name:'Applicant <literal>',username:'new_staff',email:'staff.request@gmail.com',status:'pending',created_at:'2026-11-01T02:00:00Z'},{id:82,name:'Second applicant',username:'next_staff',email:'next.request@gmail.com',status:'pending',created_at:'2026-11-02T02:00:00Z'}];
  let fail=false,hold=false;const writes=[],releases=[];
  const font=process.env.FMRC_BROWSER_POPPINS;
  const setup=font?`{const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);}`:'';
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/users'&&req.method==='GET'){json({data:users});return true;}
    if(route==='/api/admin/staff-account-requests'){json({installed:true,data:requests});return true;}
    if(route==='/api/staff'){json({data:[{name:'Available staff',username:'available_staff'}]});return true;}
    if((route==='/api/users'&&req.method==='POST')||(/^\/api\/users\/\d+$/.test(route)&&req.method==='DELETE')||/^\/api\/admin\/staff-account-requests\/\d+\/(approve|reject)$/.test(route)){
      let raw='';for await(const part of req)raw+=part;const input=raw?JSON.parse(raw):null;writes.push({route,input,method:req.method});if(hold)await new Promise(resolve=>releases.push(resolve));
      if(fail){json({message:'This action could not be saved. Please try again.'},422);return true;}
      if(req.method==='DELETE')users=users.filter(u=>u.id!==Number(route.split('/').pop()));
      else if(route==='/api/users')users.push({...input,id:14,can_delete:true});
      else{const id=Number(route.split('/').at(-2)),row=requests.find(r=>r.id===id);if(route.endsWith('/approve'))users.push({...row,id:91,role:'staff',can_delete:true});requests=requests.filter(r=>r.id!==id);}
      json({message:'Saved'});return true;
    }
    return false;
  },{setup});
  t.after(()=>releases.splice(0).forEach(resolve=>resolve()));await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const click=selector=>h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
  const input=(selector,value)=>h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const key=async key=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:9});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
  const idle=()=>h.until(`!document.querySelector('.modal-overlay.show,.admin-system-popup.show')&&document.body.style.position!=='fixed'`);
  await h.go('/admin-page/accounts.html');await h.until(`document.querySelector('[data-user-view="12"]')&&document.querySelector('[data-request-approve="81"]')&&!document.querySelector('.admin-global-page-skeleton')`);
  assert.equal(await h.run(`document.querySelector('[data-user-delete="11"]').disabled`),true);
  for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await h.run(`document.documentElement.dataset.theme='${theme}'`);
    for(const [id,opener] of [['modalViewUser','[data-user-view="12"]'],['modalDeleteAccount','[data-user-delete="12"]'],['modalApproveRequest','[data-request-approve="81"]'],['modalRejectRequest','[data-request-reject="81"]']]){
      await click(opener);await h.until(`document.querySelector('#${id}.show')`);await h.run(`Promise.all(document.querySelector('#${id}').getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
      const g=await h.run(`(()=>{const root=document.getElementById('${id}'),c=root.querySelector('.portal-detail-dialog__card'),b=root.querySelector('.portal-detail-dialog__body'),r=c.getBoundingClientRect(),head=c.querySelector('header').getBoundingClientRect(),foot=c.querySelector('footer').getBoundingClientRect();return{fit:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1,radius:getComputedStyle(c).borderRadius,fixed:head.bottom<=b.getBoundingClientRect().top+1&&foot.top>=b.getBoundingClientRect().bottom-1,x:root.querySelectorAll('[data-portal-detail-close]').length,lines:root.querySelectorAll('hr').length};})()`);
      assert(g.fit&&!g.overflow&&g.fixed&&g.radius==='12px',`${id} ${width} ${theme}: ${JSON.stringify(g)}`);assert.equal(g.x,id==='modalViewUser'?1:0);assert.equal(g.lines,0);assert.equal(await h.run(`document.body.style.position`),'fixed');
      if(id==='modalViewUser'){assert.equal(await h.run(`document.querySelector('#viewUserContent literal')`),null);assert.match(await h.run(`document.getElementById('viewUserContent').textContent`),/Not set[\s\S]*Enabled/);await key('Tab');assert.equal(await h.run(`document.getElementById('${id}').contains(document.activeElement)`),true);}
      if([390,1440].includes(width)){await h.run(`document.querySelector('#${id} [data-portal-detail-heading]').focus()`);await h.shot(`accounts-${id}-${width}-${theme}`);}
      await h.run(`document.getElementById('${id}').click()`);assert.equal(await h.run(`document.getElementById('${id}').classList.contains('show')`),true,'Backdrop preserves explicit closing');await key('Escape');await idle();
    }
    await input('#createUserRole','admin');await h.run(`document.querySelector('.accounts-form-panel').scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-90)`);
    const form=await h.run(`(()=>{const a=document.getElementById('createUserName').getBoundingClientRect(),b=document.getElementById('createUserRole').getBoundingClientRect();return{fit:document.documentElement.scrollWidth<=innerWidth+1,a:{top:a.top,left:a.left,width:a.width,height:a.height},b:{top:b.top,left:b.left,width:b.width,height:b.height}};})()`);assert(form.fit&&form.a.height>=44&&form.b.height>=44);if(width>=768)assert(Math.abs(form.a.top-form.b.top)<1&&Math.abs(form.a.width-form.b.width)<2,'Form fields align in balanced columns');
    if([390,1440].includes(width))await h.shot(`accounts-create-${width}-${theme}`);
  }
  for(const [width,height,scale] of [[852,393,1],[720,450,2]]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});
    for(const [id,opener] of [['modalViewUser','[data-user-view="12"]'],['modalRejectRequest','[data-request-reject="81"]']]){await click(opener);const fit=await h.run(`(()=>{const c=document.querySelector('#${id} .portal-detail-dialog__card'),b=c.querySelector('.portal-detail-dialog__body'),r=c.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.clientHeight>20&&b.scrollWidth<=b.clientWidth+1;})()`);assert(fit,'Short landscape and zoom preserve visible controls and a usable body');await key('Escape');await idle();}
  }
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await input('#createUserRole','staff');await h.until(`document.getElementById('createUserUsernameSelect').getClientRects().length>0`);await input('#createUserRole','customer');await h.until(`document.getElementById('createUserUsernameSelect').getClientRects().length===0`);assert.equal(await h.run(`document.getElementById('createUserUsernameSelect').closest('.admin-select-wrap').getClientRects().length`),0,'Hidden staff username picker leaves no arrow');
  await input('#accountsSearchInput','team');assert.equal(await h.run(`document.querySelectorAll('#accountsTableBody [data-user-view]').length`),1);await input('#accountsSearchInput','');
  await h.run(`document.querySelector('[data-user-view="12"]').scrollIntoView({block:'center',behavior:'instant'});window.savedPageY=scrollY;document.querySelector('[data-user-view="12"]').focus();document.querySelector('[data-user-view="12"]').click()`);await h.until(`document.querySelector('#modalViewUser.show')`);await click('#btnCloseViewUser');await idle();assert.equal(await h.run(`Math.abs(scrollY-savedPageY)<2&&document.activeElement.dataset.userView==='12'`),true,'Closing restores page position and opener');
  for(const [kind,id,confirm,cancel,opener,title] of [['delete','modalDeleteAccount','btnConfirmDeleteAccount','btnCancelDeleteAccount','[data-user-delete="12"]','Delete Failed'],['reject','modalRejectRequest','btnConfirmRejectRequest','btnCancelRejectRequest','[data-request-reject="81"]','Rejection Failed'],['approve','modalApproveRequest','btnConfirmApproveRequest','btnCancelApproveRequest','[data-request-approve="82"]','Approval Failed']]){
    await click(opener);if(kind==='reject')await input('#rejectRequestNote','Keep this reason <literal>');fail=true;hold=true;const before=writes.length;await click('#'+confirm);await h.until(`document.getElementById('${cancel}').disabled`);await key('Escape');await click('#'+confirm);assert.equal(writes.length,before+1,'Pending action cannot be duplicated');assert.equal(await h.run(`document.getElementById('${id}').classList.contains('show')`),true,'Pending dialog cannot be dismissed');hold=false;releases.splice(0).forEach(resolve=>resolve());await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='${title}'`);assert.equal(await h.run(`document.querySelector('#adminSystemPopup [data-portal-detail-close]')`),null);await click('#adminSystemPopupOk');if(kind==='reject')assert.equal(await h.run(`document.getElementById('rejectRequestNote').value`),'Keep this reason <literal>');fail=false;await click('#'+confirm);await idle();
  }
  assert.equal(users.some(u=>u.id===12),false);assert.equal(requests.length,0);assert.equal(writes.find(w=>w.route.endsWith('/reject')&&!w.route.endsWith('/approve')).input.note,'Keep this reason <literal>');
  await input('#createUserName','New Admin');await input('#createUserRole','admin');await input('#createUserUsername','new_admin');await input('#createUserEmail','new.admin@gmail.com');await input('#createUserPassword','NewAdmin123!');await input('#createUserPasswordConfirm','NewAdmin123!');await click('#btnCreateUser');await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Create Admin Account'`);assert.equal(await h.run(`document.querySelector('#adminSystemPopup [data-portal-detail-close]')`),null);await click('#adminSystemPopupCancel');await idle();assert.equal(await h.run(`document.getElementById('createUserName').value`),'New Admin');assert.equal(writes.filter(w=>w.route==='/api/users').length,0);
  assert.deepEqual(await h.run('fixtureErrors'),[]);console.log('Admin User Management previews:',h.artifacts);
});
