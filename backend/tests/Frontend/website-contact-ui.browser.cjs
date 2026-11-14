const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
for(const role of ['admin','staff'])test(role+' Contact cards and popups share the refined editor without changing saves',{skip:!chrome,timeout:120000},async t=>{
 const initial={contact_heading:'Get in Touch',contact_lead:'Talk with our team about your project.',contact_location:'Sample university campus, research center building',contact_location_url:'https://maps.example.test/sample',contact_email:'center@example.test',contact_phone:'09123456789',contact_facebook:'Sample Research Center',contact_facebook_url:'https://www.facebook.com/sample',contact_form_heading:'Send Us a Message',contact_form_subtitle:'We are ready to help.',contact_consent_text:'Sample consent statement.'};
 let settings={...initial},fail=false,hold=false,releaseSave;const writes=[];
 const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/site-settings'){json({data:settings});return true;}
  if(route==='/api/admin/site-settings'){let raw='';for await(const c of req)raw+=c;const payload=JSON.parse(raw);writes.push(payload);if(hold)await new Promise(resolve=>releaseSave=resolve);if(fail){json({message:'Temporary save error'},503);return true;}Object.assign(settings,payload);json({message:'Saved'});return true;}return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=s=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
 const input=(s,v)=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}));}`);
 const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
 const ready=()=>h.until(`settingsLoaded&&!settingsSaving&&!document.querySelector('.website-section-loading')&&document.querySelectorAll('.home-editor-section-icon').length===2`);
 const shot=async n=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(n);};
 await h.go('/'+role+'-page/website-contact.html');await ready();assert.equal(await h.run(`document.getElementById('btnSaveContact').disabled`),true);
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.page-toolbar').getBoundingClientRect().height<260&&[...document.querySelectorAll('.field-stack label')].every(l=>getComputedStyle(l).fontWeight==='600'&&l.htmlFor&&document.getElementById(l.htmlFor))`),'Compact layout and associated semibold labels '+width+' '+theme);
  if(width>=768)assert(await h.run(`(()=>{const a=document.getElementById('contactEmail').getBoundingClientRect(),b=document.getElementById('contactPhone').getBoundingClientRect(),c=document.getElementById('contactFacebook').getBoundingClientRect(),d=document.getElementById('contactFacebookUrl').getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(c.top-d.top)<1&&Math.abs(a.width-b.width)<1})()`),'Balanced field pairs '+width);
  if([390,1440].includes(width)){await h.run(`scrollTo(0,0)`);await shot(role+'-contact-editor-'+width+'-'+theme);}
 }
 await input('#contactHeading','A revised Contact heading');await input('#contactHeading',initial.contact_heading);assert.equal(await h.run(`document.getElementById('btnSaveContact').disabled`),true,'Revert disables Save');
 await input('#contactHeading','A revised Contact heading');await click('#btnSaveContact');await popup('Save All Changes');
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`(()=>{const r=document.getElementById('adminSystemPopup'),c=r.querySelector('.portal-detail-dialog__card'),q=c.getBoundingClientRect(),b=r.querySelector('.portal-detail-dialog__body');return q.left>=0&&q.right<=innerWidth+1&&q.top>=0&&q.bottom<=innerHeight+1&&q.width<=480&&getComputedStyle(c).borderRadius==='12px'&&getComputedStyle(r).backgroundColor==='rgba(17, 24, 39, 0.5)'&&getComputedStyle(r).backdropFilter==='blur(3px)'&&document.body.style.position==='fixed'&&b.scrollWidth<=b.clientWidth+1&&!r.querySelector('.portal-detail-dialog__close,hr')})()`),'Compact no-X popup '+width+' '+theme);
  if([390,1440].includes(width))await shot(role+'-contact-save-'+width+'-'+theme);
 }
 await click('#adminSystemPopupCancel');assert.equal(writes.length,0);assert.equal(await h.run(`document.getElementById('contactHeading').value`),'A revised Contact heading');
 await h.run('void loadSettings()');await h.until(`document.querySelector('#adminSystemPopup.show')`);await click('#adminSystemPopupCancel');assert.equal(await h.run(`document.getElementById('contactHeading').value`),'A revised Contact heading');
 fail=true;await click('#btnSaveContact');await popup('Save All Changes');await click('#adminSystemPopupOk');await popup('Changes Not Saved');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('btnSaveContact').disabled`),false);assert.equal(settings.contact_heading,initial.contact_heading);
 fail=false;hold=true;await click('#btnSaveContact');await popup('Save All Changes');await click('#adminSystemPopupOk');await h.until(`settingsSaving&&document.getElementById('btnSaveContact').disabled`);const count=writes.length;await h.run('void doSave();void doSave()');assert.equal(writes.length,count,'Duplicate saves are blocked');releaseSave();hold=false;await ready();await h.until(`document.getElementById('btnSaveContact').disabled`);
 assert.equal(settings.contact_heading,'A revised Contact heading');assert.deepEqual({...writes.at(-1),contact_heading:initial.contact_heading},initial,'The same eleven fields are sent');
 await h.go('/'+role+'-page/website-contact.html');await ready();assert.equal(await h.run(`document.getElementById('contactHeading').value`),'A revised Contact heading');assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
