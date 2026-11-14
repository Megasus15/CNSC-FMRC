const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {browserFixture,chrome,root}=require('./helpers/website-browser.cjs');
const pages=['admin-page','staff-page'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(file=>file.endsWith('.html')&&fs.readFileSync(path.join(root,folder,file),'utf8').includes('id="profilePopup"')).map(file=>folder+'/'+file));
test('every authenticated profile shell loads the same account menu assets',()=>{
 assert(pages.length>=40);
 for(const file of pages){const html=fs.readFileSync(path.join(root,file),'utf8');assert(html.includes('admin-common.js?v=2026.1114.17'),file);assert(html.includes('portal-detail-dialog.css?v=2026.1114.17'),file);}
});
for(const role of ['admin','staff'])test(role+' shared profile handles long identities, keyboard, notifications and logout',{skip:!chrome,timeout:180000},async t=>{
 const email=role+'.operator.with.a.long.address.for.readable.layout@department.example.test';let logouts=0;
 const font=process.env.FMRC_BROWSER_POPPINS,fa=process.env.FMRC_BROWSER_FA;
 const fontCss=(font?`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`:'')+(fa?`@font-face{font-family:"Font Awesome 6 Free";src:url(data:font/woff2;base64,${fs.readFileSync(fa).toString('base64')});font-weight:900}.fa-gear{font-family:"Font Awesome 6 Free";font-weight:900}.fa-gear:before{content:"\\f013"}`:'');
 const setup=fontCss?`{let s=document.createElement('style');s.textContent=${JSON.stringify(fontCss)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/user'){json({id:role==='admin'?11:22,role,email,username:'Sample operator'});return true;}
  if(route==='/api/logout'){logouts++;json({message:'Logged out'});return true;}return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=s=>h.run(`{let n=document.querySelector(${JSON.stringify(s)});n.focus({preventScroll:true});n.click();}`);
 const key=async k=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:{Escape:27,Tab:9,Enter:13,ArrowDown:40,' ':32}[k],...(k==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:k});};
 const open=async()=>{await click('#profileMenuTrigger');await h.until(`document.getElementById('profileMenuTrigger').getAttribute('aria-expanded')==='true'`);};
 const shot=async n=>{await h.run(`document.fonts.ready`);await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(n);};
 await h.go('/'+role+'-page/website-footer.html');await h.until(`document.getElementById('profileMenuTrigger')&&document.querySelector('.popup-identity').textContent===${JSON.stringify(email)}&&settingsLoaded`);
 assert.equal(await h.run(`document.querySelectorAll('#profileMenuTrigger').length`),1);assert.equal(await h.run(`document.getElementById('profilePopup').inert`),true);await open();
 assert(await h.run(`(()=>{const a=document.querySelector('.sidebar-nav a[href="settings.html"] i'),b=document.querySelector('#profilePopup a[href="settings.html"] i');return a&&b&&a.className===b.className&&b.classList.contains('fa-gear')})()`),'Settings reuses the sidebar gear icon');
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`(()=>{let p=document.getElementById('profilePopup'),r=p.getBoundingClientRect(),i=p.querySelector('.popup-identity');return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&p.scrollWidth<=p.clientWidth+1&&i.scrollWidth<=i.clientWidth+1&&getComputedStyle(i).textOverflow!=='ellipsis'&&getComputedStyle(p).borderRadius==='12px'&&[...p.querySelectorAll('a,button')].every(n=>n.getBoundingClientRect().height>=44)&&!p.inert&&document.body.style.position!=='fixed'})()`),'Profile fits '+width+' '+theme);
  if([390,1440].includes(width))await shot(role+'-profile-'+width+'-'+theme);
 }
 await h.send('Emulation.setDeviceMetricsOverride',{width:740,height:360,deviceScaleFactor:1,mobile:false});assert(await h.run(`document.getElementById('profilePopup').getBoundingClientRect().bottom<=innerHeight-10`),'Short landscape stays within viewport');
 await h.send('Emulation.setDeviceMetricsOverride',{width:720,height:450,deviceScaleFactor:1,mobile:false});await h.run(`document.getElementById('profilePopup').style.letterSpacing='.12em'`);assert(await h.run(`document.getElementById('profilePopup').scrollWidth<=document.getElementById('profilePopup').clientWidth+1`),'Text spacing and zoom-equivalent viewport');
 await key('Escape');await h.until(`document.getElementById('profileMenuTrigger').getAttribute('aria-expanded')==='false'`);assert.equal(await h.run('document.activeElement.id'),'profileMenuTrigger');await key('Enter');await h.until(`document.getElementById('profilePopup').classList.contains('show')`);await key('Escape');await key('ArrowDown');assert.equal(await h.run(`document.activeElement.getAttribute('href')`),'my-account.html');await key('Tab');assert.equal(await h.run(`document.activeElement.getAttribute('href')`),'settings.html');await key('Escape');
 await open();await click('.notifications');await h.until(`document.getElementById('profileMenuTrigger').getAttribute('aria-expanded')==='false'`);await open();assert.equal(await h.run(`document.getElementById('notificationDropdown').classList.contains('show')`),false);await click('.toolbar-title');await h.until(`document.getElementById('profilePopup').inert`);
 await h.run(`AdminSession.setUserInfo({id:99,role:${JSON.stringify(role)},email:'separate.operator@example.test'})`);assert.equal(await h.run(`document.querySelector('.popup-identity').textContent`),'separate.operator@example.test');assert.equal(await h.run(`document.querySelector('.popup-profile-icon').textContent`),'S');
 await open();await click('#profilePopup .logout-btn');await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Log out'`);assert.equal(logouts,0);await click('#adminSystemPopupCancel');await h.until(`document.body.style.position!=='fixed'`);assert.equal(await h.run('document.activeElement.id'),'profileMenuTrigger');assert(await h.run(`!!AdminSession.getToken()`));assert.deepEqual(await h.run('fixtureErrors'),[]);
 // Shared source is exercised on operational and configuration pages too.
 for(const file of [role+'-page/inventory.html',role+'-page/orders.html',role+'-page/my-account.html',role+'-page/settings.html']){await h.go('/'+file);await h.until(`document.getElementById('profileMenuTrigger')`);await open();assert.equal(await h.run(`document.querySelectorAll('#profileMenuTrigger,#profilePopup.portal-profile-menu').length`),2,file);await click('#profileMenuTrigger');}
 t.diagnostic('Shared assets audited across '+pages.length+' profile pages. Screenshots: '+h.artifacts);
});
