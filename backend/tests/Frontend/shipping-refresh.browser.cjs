const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const area=(id,name,fee)=>({id,name,province:'Camarines Norte',cities:[name],postal_codes:[],fee,preparation_days:2,transit_min_days:1,transit_max_days:3});
const initial=()=>({enabled:true,nonworking_weekdays:[7],nonworking_dates:[],zones:[area('10000000-0000-4000-8000-000000000001','Labo',10),area('10000000-0000-4000-8000-000000000002','Santa Elena',1)]});

test('Shipping Refresh retrieves changed rates and tracking health despite a cacheable earlier response in Admin and Staff',{skip:!chrome,timeout:60000},async t=>{
  let published=initial(),revision=1;
  const reads={admin:0,staff:0};let trackingReads=0;
  const h=await browserFixture(t,async({route,json,role})=>{
    if(route==='/api/admin/shipping-settings'){
      reads[role]++;json({data:{revision,can_edit:role==='admin',published,published_at:'2026-11-07 08:00:00',...(role==='admin'?{draft:published,has_saved_draft:true}:{})}},200,{'Cache-Control':'private, max-age=600','Vary':'Authorization'});return true;
    }
    if(route==='/api/admin/shipping-tracking'){trackingReads++;json({data:{installed:true,enabled:false,can_edit:role==='admin',message:'Tracking status loaded',processor_healthy:revision>1}});return true;}
    if(route==='/api/psgc/provinces'){json([{code:'0501600000',name:'Camarines Norte'}]);return true;}
    return false;
  });
  for(const portal of ['admin','staff']){
    await h.go('/'+portal+'-page/website-shipping.html');
    await h.until(`document.getElementById('shippingPublished').textContent.includes('Santa Elena')&&!document.getElementById('shippingRefresh').disabled`);
    const before=reads[portal],beforeTracking=trackingReads;
    published=structuredClone(published);published.zones[0].fee=revision*100+23;published.zones.pop();revision++;
    await h.run(`document.getElementById('shippingRefresh').click()`);
    await h.until(`document.getElementById('shippingPublished').textContent.includes('${published.zones[0].fee}.00')&&!document.getElementById('shippingRefresh').disabled`);
    assert(reads[portal]>before,'Refresh must reach the current settings endpoint for '+portal);
    assert(trackingReads>beforeTracking,'Refresh also reloads tracking health');
    assert.doesNotMatch(await h.run(`document.getElementById('shippingPublished').textContent`),/Santa Elena/);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
    await h.shot(portal+'-shipping-refreshed');
    published=initial();revision++;
  }
  t.diagnostic('Refresh screenshots: '+h.artifacts);
});

test('Admin rate edits and removals persist through publication and Staff refresh, including the last area',{skip:!chrome,timeout:60000},async t=>{
  let published=initial(),draft=initial(),revision=1;
  const writes=[];
  const snapshot=role=>({revision,can_edit:role==='admin',published,published_at:'2026-11-07 08:00:00',...(role==='admin'?{draft,has_saved_draft:true}:{})});
  const h=await browserFixture(t,async({req,route,json,role})=>{
    if(route==='/api/admin/shipping-settings'){json({data:snapshot(role)});return true;}
    if(['/api/admin/shipping-settings/draft','/api/admin/shipping-settings/publish'].includes(route)){
      assert.equal(role,'admin');let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
      assert.equal(input.expected_revision,revision);writes.push(route);
      if(route.endsWith('/draft'))draft=input.settings;
      else {assert.equal(input.approved,true);published=structuredClone(draft);}
      revision++;json({data:snapshot(role)});return true;
    }
    if(route==='/api/admin/shipping-tracking'){json({data:{installed:true,enabled:false,can_edit:role==='admin',message:'Tracking status loaded'}});return true;}
    if(route==='/api/psgc/provinces'){json([{code:'0501600000',name:'Camarines Norte'}]);return true;}
    return false;
  });
  const confirm=async title=>{
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
    await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  };
  const save=async()=>{
    const before=writes.length;
    await h.run(`document.getElementById('shippingSave').click()`);await confirm('Save Shipping Draft');
    await h.until(`document.getElementById('shippingSave').disabled&&!document.getElementById('shippingApproved').disabled`);
    assert.equal(writes.length,before+1);
  };
  const publish=async()=>{
    const before=writes.length;
    await h.run(`document.getElementById('shippingApproved').click();document.getElementById('shippingPublish').click()`);await confirm('Publish Shipping Settings');
    await h.until(`document.getElementById('shippingPendingChanges').hidden&&!document.getElementById('shippingRefresh').disabled`);
    assert.equal(writes.length,before+1);
  };
  await h.go('/admin-page/website-shipping.html');
  await h.until(`document.getElementById('shipping-0-fee')&&!document.getElementById('shippingFields').disabled&&!document.getElementById('shippingProvinceStatus').textContent`);
  await h.run(`(()=>{const field=document.getElementById('shipping-0-fee');field.value='123';field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await h.run(`document.getElementById('shippingPendingChanges').hidden`),false);
  // Cancelling Refresh must keep the operator's unsaved rate.
  await h.run(`document.getElementById('shippingRefresh').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Refresh Shipping Settings'`);
  await h.run(`document.getElementById('adminSystemPopupCancel').click()`);
  assert.equal(await h.run(`document.getElementById('shipping-0-fee').value`),'123');
  assert.equal(writes.length,0);
  await h.run(`document.querySelector('[data-remove-zone="1"]').click()`);await confirm('Remove destination zone');
  await save();
  assert.match(await h.run(`document.getElementById('shippingSaveStatus').textContent`),/waiting to be published/);
  assert.match(await h.run(`document.getElementById('shippingPublished').textContent`),/Santa Elena/);
  assert.doesNotMatch(await h.run(`document.getElementById('shippingDraftPreview').textContent`),/Santa Elena/);
  // A reload reads the saved draft while preserving the explicitly published rates.
  await h.go('/admin-page/website-shipping.html');
  await h.until(`document.getElementById('shipping-0-fee')?.value==='123'&&!document.getElementById('shippingApproved').disabled`);
  for(const width of [390,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.go('/admin-page/website-shipping.html');
    await h.until(`document.getElementById('shipping-0-fee')?.value==='123'&&!document.getElementById('shippingApproved').disabled`);
    await h.run(`Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))`);
    assert.equal(await h.run(`document.documentElement.scrollWidth>innerWidth+1`),false,'Pending changes fit '+width+'px');
    await h.shot('admin-saved-draft-pending-publication-'+width);
  }
  await h.run(`document.getElementById('shippingReviewChanges').click()`);
  assert.equal(await h.run(`document.activeElement.id`),'shippingApproved');
  await publish();
  assert.match(await h.run(`document.getElementById('shippingPublished').textContent`),/123\.00/);
  assert.doesNotMatch(await h.run(`document.getElementById('shippingPublished').textContent`),/Santa Elena/);
  await h.go('/staff-page/website-shipping.html');
  await h.until(`document.getElementById('shippingPublished').textContent.includes('123.00')&&!document.getElementById('shippingRefresh').disabled`);
  assert.equal(await h.run(`document.getElementById('shippingEditor').hidden&&document.getElementById('shippingPendingChanges').hidden`),true);
  await h.go('/admin-page/website-shipping.html');
  await h.until(`document.getElementById('shipping-0-fee')&&!document.getElementById('shippingFields').disabled`);
  await h.run(`document.querySelector('[data-remove-zone="0"]').click()`);await confirm('Remove destination zone');
  assert.equal(await h.run(`document.getElementById('shippingEnabled').checked`),false);
  await save();await publish();
  assert.equal(published.enabled,false);assert.deepEqual(published.zones,[]);
  assert.match(await h.run(`document.getElementById('shippingPublished').textContent`),/Delivery is turned off/);
  assert.equal(await h.run(`document.querySelectorAll('#shippingPublished tbody tr').length`),0);
  await h.go('/staff-page/website-shipping.html');
  await h.until(`document.getElementById('shippingPublished').textContent.includes('Delivery is turned off')&&!document.getElementById('shippingRefresh').disabled`);
  await h.run(`document.getElementById('shippingRefresh').click()`);
  await h.until(`document.getElementById('shippingRefreshStatus').textContent==='Delivery settings and tracking status refreshed.'`);
  assert.equal(writes.length,4);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
  await h.shot('staff-after-last-area-removed');
  t.diagnostic('Publication screenshots: '+h.artifacts);
});

test('Refresh waits for tracking health and re-enables the button after failures',{skip:!chrome,timeout:60000},async t=>{
  let trackingDelay=0,trackingFailure=false,ratesFailure=false,trackingReads=0;
  const published=initial();
  const h=await browserFixture(t,async({route,json,role})=>{
    if(route==='/api/admin/shipping-settings'){json(ratesFailure?{message:'Settings unavailable'}:{data:{revision:1,can_edit:role==='admin',published,draft:published,has_saved_draft:true}},ratesFailure?503:200);return true;}
    if(route==='/api/admin/shipping-tracking'){
      trackingReads++;await new Promise(resolve=>setTimeout(resolve,trackingDelay));
      json(trackingFailure?{message:'Tracking unavailable'}:{data:{installed:true,enabled:false,can_edit:role==='admin',message:'Tracking status loaded'}},trackingFailure?503:200);return true;
    }
    if(route==='/api/psgc/provinces'){json([{code:'0501600000',name:'Camarines Norte'}]);return true;}
    return false;
  });
  await h.go('/admin-page/website-shipping.html');
  await h.until(`document.getElementById('shippingPublished').textContent.includes('Santa Elena')&&document.querySelector('[data-tracking-message]').textContent==='Tracking status loaded'&&!document.getElementById('shippingRefresh').disabled`);
  trackingDelay=1200;
  const before=trackingReads;
  // Refresh must join an already-running health load rather than report early success.
  await h.run(`window.FMRCShippingTracking.refresh();document.getElementById('shippingRefresh').click()`);
  await h.until(`document.getElementById('shippingRefresh').disabled`);
  await h.pause(250);
  assert.equal(await h.run(`document.getElementById('shippingRefresh').disabled`),true);
  await h.run(`document.getElementById('shippingRefresh').click()`);
  await h.until(`!document.getElementById('shippingRefresh').disabled`);
  assert.equal(trackingReads,before+1,'Double click must not create a second health request');
  trackingFailure=true;trackingDelay=0;
  await h.run(`document.getElementById('shippingRefresh').click()`);
  await h.until(`!document.getElementById('shippingRefresh').disabled&&document.getElementById('shippingRefreshStatus').textContent.includes('Tracking status could not be refreshed')`);
  ratesFailure=true;
  await h.run(`document.getElementById('shippingRefresh').click()`);
  await h.until(`!document.getElementById('shippingRefresh').disabled&&document.getElementById('shippingRefreshStatus').textContent==='Delivery settings could not be refreshed. Please try again.'`);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
