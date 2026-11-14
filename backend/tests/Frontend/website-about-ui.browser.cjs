// Source portals and real image-fitting/dialog owners against an isolated settings API.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const png='data:image/jpeg;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../../../images/pic1.jpg')).toString('base64');
for(const role of ['admin','staff'])test(role+' About editor refines sections, fit dialogs and popups without changing staged saves',{skip:!chrome,timeout:180000},async t=>{
 const initial={about_heading:'About our center',about_text_1:'Existing first paragraph.',vision_text:'Our center vision.',mission_text:'Our center mission.',vision_image:png,mission_image:png,vision_gallery:JSON.stringify([png,'/images/pic2.jpg']),mission_gallery:JSON.stringify([png]),editorial_about_university_name:'Sample University',editorial_about_university_vision_text:'Sample vision.',editorial_about_university_mission_text:'Sample mission.'};
 let settings={...initial},fail=false;const writes=[];
 const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/site-settings'){json({data:settings});return true;}
  if(route==='/api/admin/site-settings'){let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);writes.push(payload);if(fail){json({message:'Please try saving again.'},503);return true;}Object.assign(settings,payload);json({message:'Saved'});return true;}return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=s=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
 const input=(s,v)=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}));}`);
 const escape=()=>h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 const shot=async n=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(n);};
 const ready=()=>h.until(`settingsLoaded&&!settingsSaving&&!document.querySelector('.website-section-loading')&&document.querySelector('#cropModal .portal-detail-dialog__close')`);
 const fitReady=()=>h.until(`document.getElementById('cropModal').classList.contains('show')&&document.getElementById('cropImg').naturalWidth>0`);
 const checkFrame=()=>h.run(`(()=>{let r=document.getElementById('cropModal'),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),f=r.querySelector('.portal-detail-dialog__footer'),q=c.getBoundingClientRect(),s=getComputedStyle(r),box=document.getElementById('cropCircle');return {fits:q.left>=0&&q.right<=innerWidth+1&&q.top>=0&&f.getBoundingClientRect().bottom<=innerHeight+1,overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1,locked:document.body.style.position==='fixed',radius:getComputedStyle(c).borderRadius,bg:s.backgroundColor,blur:s.backdropFilter,ratio:box.clientWidth/box.clientHeight}})()`);
 await h.go('/'+role+'-page/website-about.html');await ready();
 assert.equal(await h.run(`document.querySelectorAll('.home-editor-section-icon').length`),4);
 assert.equal(await h.run(`[...document.querySelectorAll('[data-config-section=home]')].every(n=>n.hidden)`),true);
 assert(await h.run(`[...document.querySelectorAll('.wm-gal-grid .wm-sdg-actions button')].every(b=>b.getAttribute('aria-label')&&b.querySelector('svg'))`),'Gallery controls identify their action and photo');
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.wm-gal-grid .wm-sdg-actions button')].every(b=>b.getBoundingClientRect().height===44)`),'About layout and equal gallery controls '+width+' '+theme);
  assert(await h.run(`[...document.querySelectorAll('.wm-gal-grid')].every(grid=>{const cards=[...grid.children],height=cards[0].getBoundingClientRect().height;return cards.every(c=>Math.abs(c.getBoundingClientRect().height-height)<1)&&[...grid.querySelectorAll('.wm-sdg-actions')].every(a=>a.children.length===5&&[...a.children].every(b=>b.getBoundingClientRect().width===44))&&[...grid.querySelectorAll('.wm-gal-thumb,.wm-gal-add')].every(a=>Math.abs(a.getBoundingClientRect().width/a.getBoundingClientRect().height-1.6)<.05)})`),'Gallery shares balanced SDG layout and retains photo aspect '+width+' '+theme);
 }
 for(const width of [1440,390]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='light';document.getElementById('visionGalleryGrid').closest('.field-stack').scrollIntoView({block:'start',behavior:'instant'});scrollBy(0,-90)`);await shot(role+'-about-gallery-'+width);}
 const galleryBefore=await h.run('galleryData.vision.slice()');
 await click(`#visionGalleryGrid button[onclick="moveGalleryImage('vision', 0, 1)"]`);assert.deepEqual(await h.run('galleryData.vision'),[galleryBefore[1],galleryBefore[0]],'Gallery order changes stay in the draft');
 await click(`#visionGalleryGrid button[onclick="moveGalleryImage('vision', 1, -1)"]`);assert.deepEqual(await h.run('galleryData.vision'),galleryBefore);
 await click(`#visionGalleryGrid button[onclick="removeGalleryImage('vision', 1)"]`);assert.deepEqual(await h.run('galleryData.vision'),[galleryBefore[0]]);assert.equal(settings.vision_gallery,initial.vision_gallery);assert.equal(writes.length,0);
 await h.run(`saveGallery('vision',${JSON.stringify(galleryBefore)})`);
 await click('#visionImgPreviewFitBtn');await fitReady();
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  const frame=await checkFrame();assert(frame.fits&&!frame.overflow&&frame.locked&&frame.radius==='12px',JSON.stringify({width,theme,frame}));assert.equal(frame.bg,'rgba(17, 24, 39, 0.5)');assert.equal(frame.blur,'blur(3px)');assert(Math.abs(frame.ratio-1.6)<.02,'Retain 16:10 image frame');if([390,1440].includes(width))await shot(role+'-about-fit-'+width+'-'+theme);
 }
 await h.send('Emulation.setDeviceMetricsOverride',{width:740,height:360,deviceScaleFactor:1,mobile:false});assert((await checkFrame()).fits,'Short landscape footer');
 await h.send('Emulation.setDeviceMetricsOverride',{width:720,height:450,deviceScaleFactor:1,mobile:false});await h.run(`document.getElementById('cropModal').style.letterSpacing='.12em'`);assert(!(await checkFrame()).overflow,'Zoom-equivalent viewport and text spacing');
 await input('#cropScale','130');await escape();await h.until(`!document.getElementById('cropModal').classList.contains('show')&&document.body.style.position!=='fixed'`);assert.equal(await h.run('visionImageData'),png);assert.equal(await h.run('document.activeElement.id'),'visionImgPreviewFitBtn');assert.equal(writes.length,0);
 await click('#missionImgPreviewFitBtn');await fitReady();await input('#cropRotate','12');await click('#btnApplyCrop');await h.until(`!document.getElementById('cropModal').classList.contains('show')`);assert.deepEqual(await h.run(`new Promise(resolve=>{let i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=missionImageData})`),[1000,625]);assert.equal(settings.mission_image,png,'Adjustments remain unpublished');
 await h.run(`adjustGalleryFit('vision',0)`);await fitReady();await click('#btnApplyCrop');await h.until(`!document.getElementById('cropModal').classList.contains('show')`);assert.deepEqual(await h.run(`new Promise(resolve=>{let i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=galleryData.vision[0]})`),[1000,625]);
 await input('#aboutHeading','Updated About draft');await click('#btnSaveAllHome');await h.until(`document.querySelector('#adminSystemPopup.show')`);
 for(const theme of ['light','dark']){await h.run(`document.documentElement.dataset.theme='${theme}'`);const popup=await h.run(`(()=>{let r=document.getElementById('adminSystemPopup'),c=r.querySelector('.portal-detail-dialog__card');return {x:r.querySelectorAll('[data-portal-detail-close],.admin-system-popup__close').length,lines:r.querySelectorAll('hr').length,bg:getComputedStyle(r).backgroundColor,child:getComputedStyle(r.querySelector('.admin-system-popup__backdrop')).backgroundColor,width:c.getBoundingClientRect().width}})()`);assert.equal(popup.x,0);assert.equal(popup.lines,0);assert.equal(popup.bg,'rgba(17, 24, 39, 0.5)');assert.equal(popup.child,'rgba(0, 0, 0, 0)');assert(popup.width<=480);}
 await click('#adminSystemPopupCancel');assert.equal(writes.length,0);
 fail=true;await h.run('doSaveAll()');await h.until(`document.querySelector('#adminSystemPopup.show')`);await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('aboutHeading').value`),'Updated About draft');assert.equal(settings.about_heading,initial.about_heading);
 fail=false;await h.run('doSaveAll()');await h.until(`!settingsSaving&&document.getElementById('btnSaveAllHome').disabled`);assert.equal(settings.about_heading,'Updated About draft');assert.equal(settings.vision_image,png);assert.equal(settings.mission_gallery,initial.mission_gallery);
 await h.go('/'+role+'-page/website-about.html');await ready();assert.equal(await h.run(`document.getElementById('aboutHeading').value`),'Updated About draft');assert.deepEqual(await h.run('fixtureErrors'),[]);
 t.diagnostic('Screenshots: '+h.artifacts);
});
