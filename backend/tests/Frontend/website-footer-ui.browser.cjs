const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
for(const role of ['admin','staff'])test(role+' Footer cards and quick-link popups preserve staged saves',{skip:!chrome,timeout:120000},async t=>{
 let settings={footer_brand_name:'Sample Research Center',footer_quick_links:JSON.stringify([{label:'Home',url:'/home-page/'},{label:'About Us',url:'/about-page/about.html'}])},fail=false,hold=false,releaseSave;const writes=[];
 const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/site-settings'){json({data:settings});return true;}
  if(route==='/api/admin/site-settings'){let raw='';for await(const c of req)raw+=c;const payload=JSON.parse(raw);writes.push(payload);if(hold)await new Promise(resolve=>releaseSave=resolve);if(fail){json({message:'Temporary save error'},503);return true;}Object.assign(settings,payload);json({message:'Saved'});return true;}return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=s=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
 const input=(s,v)=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}));}`);
 const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
 const ready=()=>h.until(`settingsLoaded&&!settingsSaving&&!document.querySelector('.website-section-loading')&&document.querySelectorAll('.home-editor-section-icon').length===6`);
 const shot=async n=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(n);};
 await h.go('/'+role+'-page/website-footer.html');await ready();assert.equal(await h.run(`document.getElementById('btnSaveFooter').disabled`),true);
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.field-stack > label,.footer-link-label')].every(l=>getComputedStyle(l).fontWeight==='600')&&[...document.querySelectorAll('.ql-row input')].every(i=>i.labels.length===1)&&[...document.querySelectorAll('.ql-del,#btnAddLink')].every(b=>b.getBoundingClientRect().height>=44)`),'Footer layout and labelled controls '+width+' '+theme);
  if([390,1440].includes(width)){await h.run('scrollTo(0,0)');await shot(role+'-footer-'+width+'-'+theme);}
 }
 await input('#footerBrandName','Revised footer draft');await input('#footerBrandName','Sample Research Center');assert.equal(await h.run(`document.getElementById('btnSaveFooter').disabled`),true);
 await input('#footerBrandName','Revised footer draft');await click('#btnAddLink');const label='<Project "sample">',url='/projects/?a="value"&b=<literal>';
 await input('.ql-row:last-child .ql-label',label);await input('.ql-row:last-child .ql-url',url);assert.equal(await h.run(`document.querySelectorAll('.ql-row img,.ql-row script').length`),0);
 await click('.ql-del');await popup('Remove Quick Link');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup .portal-detail-dialog__close,#adminSystemPopup hr').length`),0);await click('#adminSystemPopupCancel');assert.equal(await h.run(`collectQuickLinks().length`),3);
 await click('.ql-del');await popup('Remove Quick Link');await click('#adminSystemPopupOk');await h.until(`document.querySelectorAll('.ql-row').length===2`);assert.equal(writes.length,0);
 await h.run('void loadSettings()');await h.until(`document.querySelector('#adminSystemPopup.show')`);await click('#adminSystemPopupCancel');assert.equal(await h.run(`document.getElementById('footerBrandName').value`),'Revised footer draft');
 await click('#btnSaveFooter');await popup('Save All Changes');
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`(()=>{const r=document.getElementById('adminSystemPopup'),c=r.querySelector('.portal-detail-dialog__card'),q=c.getBoundingClientRect();return q.left>=0&&q.right<=innerWidth+1&&q.top>=0&&q.bottom<=innerHeight+1&&q.width<=480&&getComputedStyle(c).borderRadius==='12px'&&getComputedStyle(r).backgroundColor==='rgba(17, 24, 39, 0.5)'&&document.body.style.position==='fixed'&&!r.querySelector('.portal-detail-dialog__close,hr')})()`),'Compact no-X footer popup '+width+' '+theme);
  if([390,1440].includes(width))await shot(role+'-footer-confirm-'+width+'-'+theme);
 }
 await click('#adminSystemPopupCancel');assert.equal(writes.length,0);
 fail=true;await click('#btnSaveFooter');await popup('Save All Changes');await click('#adminSystemPopupOk');await popup('Changes Not Saved');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('btnSaveFooter').disabled`),false);assert.equal(settings.footer_brand_name,'Sample Research Center');assert.deepEqual(await h.run('collectQuickLinks().at(-1)'),{label,url});
 fail=false;hold=true;await click('#btnSaveFooter');await popup('Save All Changes');await click('#adminSystemPopupOk');await h.until('settingsSaving');for(let i=0;!releaseSave&&i<100;i++)await h.pause(20);const count=writes.length;await h.run('void doSave();void doSave()');assert.equal(writes.length,count);releaseSave();hold=false;await ready();await h.until(`document.getElementById('btnSaveFooter').disabled`);
 assert.equal(settings.footer_brand_name,'Revised footer draft');assert.equal(settings.footerBrandName,settings.footer_brand_name);assert.deepEqual(JSON.parse(settings.footer_quick_links),[{label:'About Us',url:'/about-page/about.html'},{label,url}]);
 await h.go('/'+role+'-page/website-footer.html');await ready();assert.deepEqual(await h.run('collectQuickLinks()'),JSON.parse(settings.footer_quick_links));assert.equal(await h.run(`document.querySelector('.ql-row:last-child .ql-label').value`),label);assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
