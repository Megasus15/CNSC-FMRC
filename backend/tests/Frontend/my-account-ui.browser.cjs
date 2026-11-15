const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
for(const role of ['admin','staff'])test(role+' My Account presentation preserves credentials and recovery workflows',{skip:!chrome,timeout:150000},async t=>{
 const user={id:role==='admin'?11:22,role,email:role+'@gmail.com',username:role+'_fixture',full_name:'Account holder with a long personal name'};
 let pending='',fail=false,hold=false,release,total=10;const writes=[];
 const fonts=(process.env.FMRC_BROWSER_FA_CSS?fs.readFileSync(process.env.FMRC_BROWSER_FA_CSS,'utf8'):'')+
 (process.env.FMRC_BROWSER_POPPINS?`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(process.env.FMRC_BROWSER_POPPINS).toString('base64')});font-weight:400}`:'')+
 [process.env.FMRC_BROWSER_FA,process.env.FMRC_BROWSER_FA_REGULAR].map((file,i)=>file?`@font-face{font-family:"Font Awesome 6 Free";font-weight:${i?400:900};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})}`:'').join('');
 const h=await browserFixture(t,async({req,route,json})=>{
  if(req.method==='GET'){
   if(route==='/api/user'){json(user);return true;}
   if(route==='/api/user/email-change'){json({pending:!!pending,pending_email:pending,attempts_left:5});return true;}
   if(route==='/api/admin/recovery-codes'){json({supported:true,total,remaining:total,generated_at:'2026-11-15T01:00:00Z'});return true;}
  }
  if(['/api/user','/api/change-password','/api/user/email-change/confirm','/api/user/email-change/cancel','/api/admin/recovery-codes/generate'].includes(route)&&req.method!=='GET'){
   let raw='';for await(const c of req)raw+=c;const input=raw?JSON.parse(raw):{};writes.push({route,input});if(hold)await new Promise(resolve=>release=resolve);
   if(fail){json({message:'Fixture save rejected. Your entries are retained.'},422);return true;}
   if(route==='/api/user'){
    if(role==='admin'&&input.email){pending=input.email;json({email_verification_required:true,pending_email:pending,message:'Enter the verification code.',data:user});}
    else {Object.assign(user,input);json({data:user});}return true;
   }
   if(route.endsWith('/email-change/confirm')){if(input.otp!=='123456'){json({pending:true,attempts_left:4,message:'That code is not correct.'},422);}else{user.email=pending;pending='';json({data:user});}return true;}
   if(route.endsWith('/email-change/cancel')){pending='';json({data:user});return true;}
   if(route.endsWith('/recovery-codes/generate')){total=10;json({codes:Array.from({length:10},(_,i)=>'ABCD-'+String(i).padStart(4,'0')),total:10,remaining:10,generated_at:new Date().toISOString()});return true;}
   json({message:'Password updated.'});return true;
  }return false;
 },{setup:`window.fixtureAlerts=[];window.alert=m=>fixtureAlerts.push(m);{const s=document.createElement('style');s.textContent=${JSON.stringify(fonts)};document.head.append(s);}`});
 await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const size=async(width,height=950)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await h.pause(80);};
 const click=s=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click()}`);
 const input=(id,v)=>h.run(`{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}))}`);
 const key=async(key,shift=false)=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers:shift?8:0,windowsVirtualKeyCode:{Escape:27,Tab:9}[key]});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
 const idle=()=>h.until(`document.body.style.position!=='fixed'&&!document.querySelector('.modal-overlay.show,.admin-system-popup.show')`);
 const loaded=()=>h.until(`document.getElementById('emailInput').value===${JSON.stringify(user.email)}&&!document.querySelector('.fmrc-load-veil.is-on,.admin-global-page-skeleton')`);
 const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
 const shot=async name=>{await h.run('document.fonts.ready');await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(role+'-'+name);};
 await size(1440);await h.go('/'+role+'-page/my-account.html');await loaded();assert(await h.run(`document.getElementById('saveCredentialsBtn').disabled`));
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await size(width);await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.account-section-heading')].every(n=>n.querySelector('.account-section-icon')&&getComputedStyle(n.closest('.account-summary-card,.account-form-card')).borderRadius==='12px')`),'Cards fit '+width+' '+theme);
  assert(await h.run(`(()=>{const f=document.getElementById('currentPassword').getBoundingClientRect(),b=document.getElementById('toggleCurrentPassword').getBoundingClientRect();return b.height>=44&&b.width>=44&&Math.abs(f.top+f.height/2-b.top-b.height/2)<1})()`),'Password control centered '+width);
  if(width===1440)assert(await h.run(`(()=>{const a=document.querySelector('.account-summary-card').getBoundingClientRect(),b=document.querySelector('.account-form-card:not(.recovery-card)').getBoundingClientRect();return b.width>a.width*1.6&&b.width<a.width*2.1&&Math.abs(a.height-b.height)<1&&Math.abs(a.top-b.top)<1})()`),'Sign-in card is wider with equal height and aligned headers');await h.run(`scrollTo({top:0,behavior:'instant'})`);if([390,1440].includes(width))await shot('account-'+width+'-'+theme);
  if(role==='admin'){
   await click('#recoveryGenerateBtn');await h.until(`document.body.style.position==='fixed'`);const savedY=await h.run(`Math.abs(parseFloat(document.body.style.top)||0)`);
   assert(await h.run(`document.querySelector('#recoveryConfirmModal [data-portal-detail-close]')&&getComputedStyle(document.querySelector('#recoveryConfirmModal .portal-detail-dialog__card')).borderRadius==='12px'`));
   if([390,1440].includes(width))await shot('recovery-'+width+'-'+theme);
   await h.run(`document.getElementById('recoveryConfirmModal').click()`);assert(await h.run(`document.getElementById('recoveryConfirmModal').classList.contains('show')`));await key('Tab',true);assert(await h.run(`document.getElementById('recoveryConfirmModal').contains(document.activeElement)`));await key('Escape');await idle();assert.equal(await h.run('document.activeElement.id'),'recoveryGenerateBtn');assert(Math.abs(await h.run('scrollY')-savedY)<1,'Closing restores the exact page position '+JSON.stringify({expected:savedY,actual:await h.run('scrollY'),width,theme}));
  }else assert(await h.run(`!document.getElementById('recoveryCodesCard')&&!document.getElementById('recoveryConfirmModal')&&document.getElementById('fullNameInput').disabled`));
 }
 await size(1440);await h.run(`document.documentElement.dataset.theme='light'`);await input('emailInput','invalid');assert(await h.run(`document.getElementById('saveCredentialsBtn').disabled`));await input('emailInput',role+'+changed@gmail.com');assert.equal(await h.run(`document.getElementById('saveCredentialsBtn').disabled`),false);
 fail=true;await click('#saveCredentialsBtn');await popup('Unable to continue');assert(await h.run(`!document.querySelector('#adminSystemPopup [data-portal-detail-close],#adminSystemPopup hr')`));await click('#adminSystemPopupOk');await idle();assert.equal(await h.run(`document.getElementById('emailInput').value`),role+'+changed@gmail.com');fail=false;
 let origin=await h.run('performance.timeOrigin');await click('#saveCredentialsBtn');if(role==='admin'){
  await popup('One more step');await click('#adminSystemPopupOk');await idle();assert.equal(user.email,'admin@gmail.com');assert(await h.run(`document.getElementById('emailPendingStrip').classList.contains('show')`));await input('emailPendingOtp','ab12c3456');assert.equal(await h.run(`document.getElementById('emailPendingOtp').value`),'123456');await input('emailPendingOtp','000000');await click('#emailPendingVerifyBtn');await h.until(`document.getElementById('emailPendingHint').textContent==='That code is not correct.'`);await input('emailPendingOtp','123456');await click('#emailPendingVerifyBtn');
 }
 await h.until(`performance.timeOrigin!==${origin}&&document.readyState==='complete'`);await loaded();assert.equal(user.email,role+'+changed@gmail.com');await input('currentPassword','current-secret');await input('newPassword','next-secret-123');await input('confirmPassword','next-secret-123');assert.equal(await h.run(`document.getElementById('saveCredentialsBtn').disabled`),false);const count=writes.length;origin=await h.run('performance.timeOrigin');await click('#saveCredentialsBtn');await h.until(`performance.timeOrigin!==${origin}&&document.readyState==='complete'`);await loaded();await h.until(`document.getElementById('currentPassword').value===''`);assert.deepEqual(writes.slice(count).map(w=>w.route),['/api/change-password']);
 if(role==='admin'){
  await click('#recoveryGenerateBtn');await click('#recoveryConfirmSubmit');await popup('Unable to continue');assert.equal(writes.at(-1).route,'/api/change-password');await click('#adminSystemPopupOk');assert(await h.run(`document.body.style.position==='fixed'`));await input('recoveryConfirmPassword','current-secret');fail=true;hold=true;release=null;await click('#recoveryConfirmSubmit');for(let i=0;!release&&i<100;i++)await h.pause(20);assert(release);const n=writes.length;await key('Escape');await h.run(`document.getElementById('recoveryConfirmSubmit').click();document.getElementById('recoveryConfirmCancel').click();document.querySelector('#recoveryConfirmModal [data-portal-detail-close]').click()`);assert.equal(writes.length,n);assert(await h.run(`document.getElementById('recoveryConfirmModal').classList.contains('show')`));release();hold=false;await popup('Unable to continue');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('recoveryConfirmPassword').value`),'current-secret');fail=false;await click('#recoveryConfirmSubmit');await idle();assert(await h.run(`document.querySelectorAll('#recoveryCodesList .recovery-code').length===10&&document.getElementById('recoveryDoneBtn').disabled&&!!document.querySelector('.admin-success-notification__close')`));
  await shot('recovery-reveal-desktop');await h.send('Emulation.setEmulatedMedia',{media:'print'});await h.run(`document.body.classList.add('recovery-printing')`);assert(await h.run(`getComputedStyle(document.querySelector('#recoveryCodesList .recovery-code')).visibility==='visible'&&getComputedStyle(document.querySelector('.account-section-heading')).visibility==='hidden'`));await h.run(`document.body.classList.remove('recovery-printing')`);await h.send('Emulation.setEmulatedMedia',{media:'screen'});await click('#recoveryAckCheck');await click('#recoveryDoneBtn');assert(await h.run(`!document.getElementById('recoveryRevealPanel').classList.contains('show')&&!document.getElementById('recoveryCodesList').textContent.trim()`));
  await size(740,360);await click('#recoveryGenerateBtn');await h.run(`document.getElementById('recoveryConfirmText').textContent+=' '+('Save the new codes before closing this panel. '.repeat(12))`);await shot('recovery-landscape');const layout=await h.run(`(()=>{const r=document.querySelector('#recoveryConfirmModal .portal-detail-dialog__footer').getBoundingClientRect(),b=document.querySelector('#recoveryConfirmModal .portal-detail-dialog__body');return {bottom:r.bottom,height:innerHeight,scroll:b.scrollHeight,client:b.clientHeight,width:document.documentElement.scrollWidth,viewport:innerWidth}})()`);assert(layout.bottom<=layout.height&&layout.scroll>layout.client&&layout.width<=layout.viewport+1,JSON.stringify(layout));await key('Escape');await idle();
 }
 assert.deepEqual(await h.run('fixtureAlerts'),[]);assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});
