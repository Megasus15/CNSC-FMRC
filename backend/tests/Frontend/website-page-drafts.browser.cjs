const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('Home, About and Services publish only the complete explicit page save in both portals', {skip:!chrome,timeout:180000},async t=>{
  let settings={hero_title:'Saved Home',about_heading:'Saved About',mission_gallery:'[]',vision_gallery:'[]'};
  let services=[{id:1,title:'Saved service',category:'Prototyping',description:'Saved description',image_data:png,modal_description:'Saved details',modal_features:['Existing feature'],modal_materials:[],modal_best_for:[],sort_order:0}];
  let sdgs=[{id:11,title:'Saved SDG',description:'Saved badge',image_data:png,sort_order:0,is_visible:true}];
  let nextId=100,fail=false;
  const writes=[];
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/site-settings'){json({data:settings});return true;}
    if(route==='/api/services'){json({data:services});return true;}
    if(route==='/api/admin/site-sdgs'){json({data:sdgs,max_slots:8});return true;}
    if(route.startsWith('/api/admin/website-pages/')||route==='/api/admin/site-settings'){
      assert.equal(req.method,'PUT');let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);
      writes.push({route,payload});
      if(fail){json({errors:{title:['Please review the draft and try again.']}},422);return true;}
      if(route==='/api/admin/site-settings')Object.assign(settings,payload);
      else{
        Object.assign(settings,payload.settings);
        for(const [key,rows]of [['services',services],['sdgs',sdgs]]){
          const change=payload[key];if(!change)continue;
          for(const id of change.delete||[]){const index=rows.findIndex(row=>row.id===id);if(index>=0)rows.splice(index,1);}
          for(const row of change.upsert||[]){const original=rows.find(item=>item.id===row.id);if(original)Object.assign(original,row);else rows.push({id:nextId++,...row});}
          rows.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
        }
      }
      json({message:'Saved'});return true;
    }
    return false;
  });
  const confirm=()=>h.run("window.showAdminConfirmPopup=(_message,options)=>options.onConfirm()");
  const type=async(id,value)=>h.run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  for(const portal of ['admin-page','staff-page']){
    await h.send('Emulation.setDeviceMetricsOverride',{width:portal==='admin-page'?1440:390,height:900,deviceScaleFactor:1,mobile:portal==='staff-page'});
    await h.go('/'+portal+'/website-home.html');
    await h.until("settingsLoaded&&servicesLoaded&&sdgsLoaded&&!document.querySelector('.website-section-loading')");
    await confirm();
    const before=structuredClone({settings,services,sdgs});const count=writes.length;
    await type('heroTitle','Draft Home '+portal);
    await h.run(`saveLogoSetting(BRAND_LOGOS[0],${JSON.stringify(png)});openEditService(1)`);
    await type('svcTitle','Draft service '+portal);
    await h.run("document.getElementById('btnSaveService').click()");
    await h.run(`openSdgModal(null,${JSON.stringify(png)})`);
    await type('sdgTitle','Draft badge '+portal);
    await h.run("document.getElementById('btnSaveSdg').click();reorderSdg(sdgsData.at(-1).id,-1);deleteSdg(sdgsData.at(-1).id)");
    assert.equal(writes.length,count,'dialogs, logos and collection operations do not publish');
    assert.deepEqual({settings,services,sdgs},before,'all public records remain unchanged');
    assert.equal(await h.run("document.getElementById('btnSaveAllHome').disabled"),false);
    // A rejected save retains the complete staged state.
    fail=true;await h.run('doSaveAll()');
    assert.deepEqual({settings,services,sdgs},before);
    assert.equal(await h.run("document.getElementById('btnSaveAllHome').disabled"),false);
    fail=false;await h.run('doSaveAll()');
    assert.equal(settings.hero_title,'Draft Home '+portal);
    assert.equal(services.find(row=>row.id===1).title,'Draft service '+portal);
    assert.deepEqual(services.find(row=>row.id===1).modal_features,['Existing feature']);
    assert.equal(sdgs[0].title,'Draft badge '+portal);
    assert.equal(writes.at(-1).route,'/api/admin/website-pages/home');
    assert.equal(await h.run("document.getElementById('btnSaveAllHome').disabled"),true);
    await h.go('/'+portal+'/website-home.html');
    await h.until('settingsLoaded&&servicesLoaded&&sdgsLoaded');
    assert.equal(await h.run("document.getElementById('heroTitle').value"),'Draft Home '+portal);

    await h.go('/'+portal+'/website-about.html');
    await h.until('settingsLoaded');await confirm();
    const oldGallery=settings.vision_gallery;const oldCount=writes.length;
    await h.run(`saveGallery('vision',[${JSON.stringify(png)},${JSON.stringify(png)}])`);
    assert.equal(settings.vision_gallery,oldGallery);
    assert.equal(writes.length,oldCount);
    await h.run('doSaveAll()');assert.equal(JSON.parse(settings.vision_gallery).length,2);
    await h.run("saveGallery('vision',[])");assert.equal(JSON.parse(settings.vision_gallery).length,2);
    await h.run('doSaveAll()');assert.equal(settings.vision_gallery,'[]');

    await h.go('/'+portal+'/website-services.html');
    await h.until('servicesLoaded&&copyLoaded&&categoriesLoaded&&pageDraft&&!pageDraft.isDirty()');
    assert.equal(await h.run("document.querySelectorAll('#serviceCustomCopyFields input, #serviceCustomCopyFields textarea').length"),3);
    const previousCustomTitle = settings.editorial_services_custom_title;
    await type('pageCopy_editorial_services_custom_title','Made for you '+portal);
    await confirm();const savedTitle=settings.editorial_services_title;const savedService=services[0].title;const oldWrites=writes.length;
    await h.run(`copyFields.get('editorial_services_title').value='Draft services heading';copyFields.get('editorial_services_title').dispatchEvent(new Event('input',{bubbles:true}));serviceCategories.push(${JSON.stringify('New category '+portal)});openEdit(1)`);
    await type('svcTitle','Full service edit '+portal);
    await h.run("document.getElementById('btnSaveService').click()");
    assert.equal(writes.length,oldWrites);assert.equal(settings.editorial_services_title,savedTitle);assert.equal(services[0].title,savedService);
    assert.equal(settings.editorial_services_custom_title,previousCustomTitle);
    assert.equal(await h.run("document.querySelectorAll('.website-section-save:not([hidden])').length"),0);
    await h.run('saveAllServices()');
    assert.equal(settings.editorial_services_title,'Draft services heading');
    assert.equal(settings.editorial_services_custom_title,'Made for you '+portal);
    assert.ok(JSON.parse(settings.editorial_services_categories).includes('New category '+portal));
    assert.equal(services[0].title,'Full service edit '+portal);
    assert.equal(writes.at(-1).route,'/api/admin/website-pages/services');
    assert.equal(await h.run("document.getElementById('btnSaveAllServices').disabled"),true);
    await h.go('/'+portal+'/website-services.html');
    await h.until('servicesLoaded&&copyLoaded&&categoriesLoaded');
    assert.equal(await h.run("copyFields.get('editorial_services_title').value"),'Draft services heading');
    assert.equal(await h.run("copyFields.get('editorial_services_custom_title').value"),'Made for you '+portal);
    // Both confirmation outcomes preserve the promised navigation behavior.
    await h.run("copyFields.get('editorial_services_title').value='Unsaved refresh';copyFields.get('editorial_services_title').dispatchEvent(new Event('input',{bubbles:true}));window.showAdminConfirmPopup=(_message,options)=>{window.fixtureConfirm=options};void refreshServicesPage()");
    await h.until('!!window.fixtureConfirm');await h.run('fixtureConfirm.onCancel()');
    assert.equal(await h.run("copyFields.get('editorial_services_title').value"),'Unsaved refresh');
    await h.run('void refreshServicesPage()');await h.run('fixtureConfirm.onConfirm()');
    await h.until("copyFields.get('editorial_services_title').value==='Draft services heading'");
    await h.until("!document.querySelector('.website-section-loading')");
    await h.shot(portal+'-services');
    await h.run("openEdit(1);document.getElementById('svcTitle').focus()");
    await h.pause(250);
    await h.shot(portal+'-service-modal');
    await h.run('closeModal()');
    assert.deepEqual(await h.run('fixtureErrors'),[],portal+' runtime errors');
  }
  fs.writeFileSync(path.join(h.artifacts,'page-save-requests.json'),JSON.stringify(writes,null,2));
  console.log('Verified staged logos, service/SDG changes, galleries, unified Services saves, rejected-save recovery, readback and discard confirmation in both portals. Artifacts: '+h.artifacts);
});
