const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {browserFixture,chrome,root}=require('./helpers/website-browser.cjs');

test('every Admin/Staff page and modal field uses one thin focus treatment at every viewport and theme', {skip:!chrome,timeout:300000}, async t=>{
  const h=await browserFixture(t);
  const pages=['admin-page','staff-page','admin-auth'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(name=>name.endsWith('.html')&&name!=='maintenance-preview.html').map(name=>'/'+folder+'/'+name));
  const selector='input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),textarea,select,.custom-select-trigger';
  const coverage=[];
  for(const page of pages){
    await h.go(page);
    assert.equal(await h.run("!!document.querySelector('link[href*=\"admin-form-controls.css\"]')"),true,page);
    await h.run("document.querySelectorAll('.chip-hidden-input').forEach(input=>input.dataset.fixtureChip='true')");
    const doc=await h.send('DOM.getDocument',{depth:-1});
    const nodes=await h.send('DOM.querySelectorAll',{nodeId:doc.root.nodeId,selector});
    for(const nodeId of nodes.nodeIds)await h.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['focus','focus-visible']});
    const rows=[];
    for(const width of [1440,768,390])for(const theme of ['light','dark']){
      await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      await h.run(`document.documentElement.dataset.theme=${JSON.stringify(page.startsWith('/admin-auth')?'light':theme)}`);
      await h.pause(230);
      const measure=`(()=>{const selector=${JSON.stringify(selector)};return [...document.querySelectorAll(selector)].filter(e=>!e.classList.contains('chip-hidden-input')).map(e=>{const s=getComputedStyle(e);return {id:e.id||e.name||e.className,type:e.type,border:s.borderTopWidth,color:s.borderTopColor,outline:s.outlineWidth,outlineStyle:s.outlineStyle,shadow:s.boxShadow};});})()`;
      let result=await h.run(measure);
      const expected=theme==='dark'&&!page.startsWith('/admin-auth')?'rgb(239, 176, 188)':'rgb(128, 0, 0)';
      if(result.some(field=>!['checkbox','radio','range'].includes(field.type)&&field.color!==expected)){await h.pause(250);result=await h.run(measure);}
      for(const field of result){
        if(['checkbox','radio','range'].includes(field.type)){assert.equal(field.outline,'1px',`${page} ${width} ${theme} ${field.id}`);continue;}
        assert.equal(field.border,'1px',`${page} ${width} ${theme} ${field.id}: border`);
        assert.equal(field.color,expected,`${page} ${width} ${theme} ${field.id}: color`);
        assert.equal(field.outlineStyle,'none',`${page} ${width} ${theme} ${field.id}: no double outline`);
        assert.match(field.shadow,/0px 0px 0px 3px/,`${page} ${field.id}: soft halo`);
      }
      rows.push({width,theme,fields:result.length});
    }
    coverage.push({page,fields:nodes.nodeIds.length,cases:rows});
  }
  // Dynamically inserted controls use the same behavior as existing fields.
  await h.go('/admin-page/website-services.html');
  await h.run(`(()=>{const panel=document.createElement('section');panel.id='fixtureFields';panel.style='padding:24px;position:fixed;inset:80px 24px auto;z-index:99999;background:#fdfaf6';panel.innerHTML='<label>Dropdown <select id="fixtureSelect"><option value="a">First option</option><option value="b">Second option</option></select></label><label>Text <input id="fixtureText"></label><div class="combobox-wrap open"><input class="combobox-input" value="Camarines Norte"><button class="combobox-caret"><i>⌄</i></button></div>';document.body.append(panel);})()`);
  await h.until("document.querySelector('#fixtureSelect').parentElement.classList.contains('admin-select-wrap')");
  assert.equal(await h.run("document.querySelectorAll('#fixtureFields .admin-select-chevron').length"),1);
  await h.run("document.querySelector('#fixtureSelect').focus();window.fixtureChanges=0;document.querySelector('#fixtureSelect').addEventListener('change',()=>fixtureChanges++)");
  await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  assert.equal(await h.run("document.querySelector('#fixtureSelect').value"),'b');
  assert.equal(await h.run('fixtureChanges'),1);
  await h.run("document.querySelector('#fixtureText').focus()");
  await h.shot('thin-focus-phone');
  await h.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await h.pause(100);
  assert.equal(await h.run("getComputedStyle(document.querySelector('#fixtureFields .admin-select-chevron')).transitionDuration"),'0s');
  for(const portal of ['admin-page','staff-page']){
    await h.go('/apps/team/'+portal+'/website-about');
    assert.equal(await h.run("!!document.querySelector('link[href*=\"admin-form-controls.css\"]')"),true,'Team PWA '+portal);
  }
  fs.writeFileSync(path.join(h.artifacts,'field-coverage.json'),JSON.stringify(coverage,null,2));
  console.log(`Verified ${pages.length} pages across three widths and both themes, existing modal fields, dynamic dropdowns and Team PWA routes. Artifacts: ${h.artifacts}`);
});

test('native dropdown arrows follow the real picker and focused modal fields match Province', {skip:!chrome,timeout:60000},async t=>{
  const h=await browserFixture(t);
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await h.go('/admin-page/website-services.html');
  await h.until('servicesLoaded&&categoriesLoaded&&copyLoaded');
  await h.run('openAdd()');
  await h.until("document.getElementById('svcCategory').parentElement.classList.contains('admin-select-wrap')");
  await h.run("document.getElementById('svcCategory').focus();document.getElementById('svcCategory').showPicker()");
  await h.until("document.getElementById('svcCategory').matches(':open')");
  await h.pause(250);
  const arrow=await h.run("(()=>{const e=document.querySelector('#svcCategory + .admin-select-chevron'),s=getComputedStyle(e);return {transform:s.transform,duration:s.transitionDuration};})()");
  assert.match(arrow.transform,/matrix\(-0\.707/);
  assert.equal(arrow.duration,'0.2s, 0.2s');
  await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await h.until("!document.getElementById('svcCategory').matches(':open')");
  for(const [width,theme]of [[1440,'light'],[390,'light'],[390,'dark']]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('svcTitle').focus()`);
    await h.pause(350);
    assert.equal(await h.run("document.activeElement.id"),'svcTitle');
    const field=await h.run("(()=>{const s=getComputedStyle(document.getElementById('svcTitle'));return {border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow};})()");
    assert.equal(field.border,'1px');assert.equal(field.outline,'none');assert.match(field.shadow,/0px 0px 0px 3px/);
    await h.shot('service-modal-focus-'+width+'-'+theme);
  }
  await h.run("document.documentElement.dataset.portalMotion='reduced'");
  assert.equal(await h.run("getComputedStyle(document.querySelector('#svcCategory + .admin-select-chevron')).transitionDuration"),'0s');
  await h.run(`(()=>{const trigger=document.createElement('button');trigger.className='custom-select-trigger';trigger.setAttribute('aria-expanded','true');trigger.innerHTML='Custom selection <span class="custom-select-arrow">⌄</span>';document.body.append(trigger);window.fixtureCustom=trigger;})()`);
  const custom=await h.run("(()=>{const s=getComputedStyle(fixtureCustom);return {border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow};})()");
  assert.equal(custom.border,'1px');assert.equal(custom.outline,'none');assert.match(custom.shadow,/0px 0px 0px 3px/);
  console.log('Verified native open/close arrow rotation, 200 ms timing and focused modal appearance. Artifacts: '+h.artifacts);
});
