const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('Home and About action outlines remain visible on hover in both roles and themes',{skip:!chrome,timeout:90000},async t=>{
 const h=await browserFixture(t,({route,json})=>{
  if(route==='/api/site-settings'){json({data:{vision_image:png,mission_image:png}});return true;}
  if(route==='/api/services'){json({data:[]});return true;}
  if(route==='/api/admin/site-sdgs'){json({data:[{id:1,title:'Sample SDG',image_data:png,is_visible:true}],max_slots:8});return true;}return false;
 });await h.send('Network.setBlockedURLs',{urls:['https://*']});await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:950,deviceScaleFactor:1,mobile:false});
 for(const role of ['admin','staff'])for(const page of ['home','about']){
  await h.go('/'+role+'-page/website-'+page+'.html');await h.until(`settingsLoaded&&${page==='home'?'sdgsLoaded&&servicesLoaded&&':''}!document.querySelector('.website-section-loading')`);
  for(const theme of ['light','dark']){
   await h.run(`document.documentElement.dataset.theme='${theme}'`);
   for(const selector of page==='home'?['#homeSdgGrid button[title="Edit details"]','#homeSdgGrid .btn-del-sm']:['#visionImgPreviewFitBtn','#visionImgPreviewRemoveBtn']){
    await h.run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    const point=await h.run(`(()=>{let r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await h.pause(50);await h.run(`Promise.all(document.querySelector(${JSON.stringify(selector)}).getAnimations().map(a=>a.finished.catch(()=>{})))`);
    const style=await h.run(`(()=>{let b=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(b);return{hover:b.matches(':hover'),border:s.borderTopColor,color:s.color,width:s.borderTopWidth,bg:s.backgroundColor}})()`);
    assert(style.hover&&style.width==='1px'&&style.border===style.color&&style.bg!==style.color,JSON.stringify({role,page,theme,selector,style}));
   }
  }
  assert.deepEqual(await h.run('fixtureErrors'),[]);
 }
});
