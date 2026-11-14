const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const png='data:image/png;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../../../images/FMRC Brand Logo.png')).toString('base64');
for(const role of ['admin','staff'])test(role+' Home editor shares Inventory frames, staged editing and nested image fitting',{skip:!chrome,timeout:180000},async t=>{
 let settings={hero_title:'Fabrication and Manufacturing Research Center',hero_bg_type:'color',hero_bg_color:'#800000',nav_logo_image:png,hero_logo_image:png};
 let services=[{id:1,title:'Laser Engraving',category:'Manufacturing',description:'Precision engraving for personal and university projects.',image_data:png,modal_features:['Retained feature'],sort_order:0}],sdgs=[{id:11,title:'Quality Education',description:'Skills and learning opportunities.',image_data:png,is_visible:true,sort_order:0},{id:12,title:'Sustainable communities and responsible innovation',description:'A second badge with a longer title.',image_data:png,is_visible:false,sort_order:1}],failSave=false;
 const writes=[];const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/site-settings'){json({data:settings});return true;}
  if(route==='/api/services'){json({data:services});return true;}
  if(route==='/api/admin/site-sdgs'){json({data:sdgs,max_slots:8});return true;}
  if(route==='/api/admin/website-pages/home'){
   let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);writes.push(payload);if(failSave){json({errors:{title:['Please review the draft and try again.']}},422);return true;}
   Object.assign(settings,payload.settings);for(const [key,rows] of [['services',services],['sdgs',sdgs]]){for(const id of payload[key]?.delete||[]){const i=rows.findIndex(r=>r.id===id);if(i>=0)rows.splice(i,1);}for(const row of payload[key]?.upsert||[]){const old=rows.find(r=>r.id===row.id);if(old)Object.assign(old,row);else rows.push({...row,id:100+rows.length});}}
   json({message:'Saved'});return true;
  }return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=s=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
 const input=(s,v)=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}));}`);
 const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
 const key=async k=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:k==='Escape'?27:9});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:k});};
 const shot=async n=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(n);};
 const checkFrame=async id=>{
  assert(await h.run(`(()=>{let r=document.getElementById('${id}'),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),f=r.querySelector('.portal-detail-dialog__footer'),q=c.getBoundingClientRect();return q.left>=0&&q.right<=innerWidth+1&&q.top>=0&&f.getBoundingClientRect().bottom<=innerHeight+1&&b.scrollWidth<=b.clientWidth+1&&c.scrollHeight<=c.clientHeight+1&&document.body.style.position==='fixed'&&getComputedStyle(c).borderRadius==='12px'})()`),id+' frame');
 };
 await h.go('/'+role+'-page/website-home.html');await h.until(`settingsLoaded&&servicesLoaded&&sdgsLoaded&&!document.querySelector('.website-section-loading')&&document.querySelector('#serviceModal .portal-detail-dialog__close')`);
 assert.equal(await h.run(`document.querySelectorAll('.home-editor-section-icon').length`),6);
 for(const width of [320,390,768,1024,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`),'Home layout '+width);
  assert(await h.run(`(()=>{const grid=document.getElementById('homeSdgGrid'),slot=grid.querySelector('.wm-sdg-slot'),buttons=[...slot.querySelectorAll('.wm-sdg-actions button')],empty=grid.querySelector('.is-empty');return buttons.length===6&&buttons.every(b=>b.getBoundingClientRect().width===44&&b.getBoundingClientRect().height===44&&b.getAttribute('aria-label')&&b.title)&&empty.getBoundingClientRect().height<=170&&slot.getBoundingClientRect().height<300})()`),'Compact SDG cards and equal accessible controls '+width);
  assert(await h.run(`(()=>{let a=document.querySelector('.wm-service-card .card-actions'),b=a.lastElementChild,x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.right-y.right>=0&&x.right-y.right<=19&&[...a.children].every(b=>b.getBoundingClientRect().height>=44)})()`),'Service actions align right '+width);
 }
 await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:950,deviceScaleFactor:1,mobile:false});await shot(role+'-home-workspace');
 for(const width of [1440,390]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.run(`document.getElementById('homeSdgGrid').closest('.wm-section').scrollIntoView({block:'start',behavior:'instant'});scrollBy(0,-90)`);await shot(role+'-home-sdg-'+width);}
 await click('[data-home-service-action=edit]');await h.until(`document.getElementById('serviceModal').classList.contains('show')`);
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);await checkFrame('serviceModal');if([390,1440].includes(width))await shot(role+'-service-editor-'+width+'-'+theme);
 }
 await input('#svcTitle','Revised service draft');await key('Escape');await popup('Discard changes?');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup [data-portal-detail-close],#adminSystemPopup hr').length`),0);await click('#adminSystemPopupCancel');assert.equal(await h.run(`document.getElementById('svcTitle').value`),'Revised service draft');
 await click('#btnSaveService');await popup('Confirm Edit');await click('#adminSystemPopupOk');await h.until(`!document.getElementById('serviceModal').classList.contains('show')`);assert.equal(services[0].title,'Laser Engraving');assert.equal(writes.length,0);
 await h.until(`document.activeElement.matches('[data-home-service-action="edit"][data-service-id="1"]')`);
 await click('#btnAddService');await input('#svcTitle','New service draft');await click('#btnSaveService');await popup('Confirm Add');await click('#adminSystemPopupOk');await h.until(`document.querySelectorAll('.wm-service-card').length===2`);
 await h.run(`deleteService(servicesData.at(-1).id,servicesData.at(-1).title)`);await popup('Remove Service');await click('#adminSystemPopupOk');await h.until(`document.querySelectorAll('.wm-service-card').length===1`);assert.equal(writes.length,0);
 await h.run(`openSdgModal(11)`);await h.until(`document.getElementById('sdgModal').classList.contains('show')`);
 for(const width of [320,390,768,1024,1440]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await checkFrame('sdgModal');}
 await click('#btnSdgModalCrop');await h.until(`document.getElementById('cropModal').classList.contains('show')&&document.getElementById('cropImg').naturalWidth>0`);
 assert(await h.run(`parseInt(getComputedStyle(document.getElementById('cropModal')).zIndex)>parseInt(getComputedStyle(document.getElementById('sdgModal')).zIndex)`),'Crop stays above its parent');
 for(const width of [320,390,768,1024,1440]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await checkFrame('cropModal');if([390,1440].includes(width))await shot(role+'-image-fit-'+width);}
 await h.send('Emulation.setDeviceMetricsOverride',{width:740,height:360,deviceScaleFactor:1,mobile:false});await checkFrame('cropModal');await key('Escape');await h.until(`!document.getElementById('cropModal').classList.contains('show')`);assert(await h.run(`document.getElementById('sdgModal').classList.contains('show')&&!document.getElementById('sdgModal').inert&&document.body.style.position==='fixed'`));
 await click('#btnSdgModalCrop');await h.until(`document.getElementById('cropImg').naturalWidth>0`);await input('#cropScale','125');await input('#cropRotate','15');await click('#btnApplyCrop');await h.until(`!document.getElementById('cropModal').classList.contains('show')`);
 assert.deepEqual(await h.run(`new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=sdgImageData})`),[256,256]);
 await input('#sdgTitle','Revised SDG draft');await click('#btnSaveSdg');await popup('Confirm Edit');await click('#adminSystemPopupOk');await h.until(`!document.getElementById('sdgModal').classList.contains('show')`);assert.equal(sdgs[0].title,'Quality Education');assert.equal(writes.length,0);
 await h.run(`adjustLogo('nav')`);await h.until(`document.getElementById('cropModal').classList.contains('show')&&document.getElementById('cropImg').naturalWidth>0`);await click('#btnApplyCrop');await h.until(`!document.getElementById('cropModal').classList.contains('show')`);assert.deepEqual(await h.run(`new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=brandLogoData.nav})`),[512,512]);
 failSave=true;await h.run(`doSaveAll()`);await h.until(`document.querySelector('#adminSystemPopup.show')`);await click('#adminSystemPopupOk');assert.equal(settings.hero_title,'Fabrication and Manufacturing Research Center');assert(await h.run(`!document.getElementById('btnSaveAllHome').disabled`));
 failSave=false;await h.run(`doSaveAll()`);await h.until(`!settingsSaving&&document.getElementById('btnSaveAllHome').disabled`);assert.equal(services[0].title,'Revised service draft');assert.deepEqual(services[0].modal_features,['Retained feature']);assert.equal(sdgs[0].title,'Revised SDG draft');
 assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
