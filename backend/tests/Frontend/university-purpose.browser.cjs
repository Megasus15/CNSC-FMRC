// Canonical Customer/Admin/Staff pages with isolated persisted settings.
// All statements are synthetic fixtures, not official university content.
const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');
const prefix = 'editorial_about_university_';
const vision = 'CNSC sample institutional vision.';
const mission = 'A sample first paragraph describing teaching and research.\n\nA second paragraph with <b>literal markup</b> and '+ 'community work. '.repeat(28);

test('university statements save through both portals and publish together on About Us', {skip:!chrome, timeout:120000}, async t => {
  const original = {mission_text:'Existing FMRC mission.', vision_text:'Existing FMRC vision.', about_video_url:'',
    mission_gallery:JSON.stringify(['/images/FMRC Brand Logo.png','/images/UCN Logo.png']),
    vision_gallery:JSON.stringify(['/images/UCN Logo.png','/images/FMRC Brand Logo.png'])};
  let settings = {...original}, failSave = false, reads = 0;
  const writes = [];
  const h = await browserFixture(t, async ({req, route, json, role}) => {
    if (route === '/api/site-settings') { reads++; json({data:settings}); return true; }
    if (route === '/api/admin/site-settings' && req.method === 'PUT') {
      let text = ''; for await (const chunk of req) text += chunk;
      const input = JSON.parse(text);
      if (failSave) { json({message:'Temporary save failure'},503); return true; }
      writes.push({role, input}); Object.assign(settings,input); json({message:'Saved'}); return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const ready = () => h.until(`typeof settingsLoaded!=='undefined' && settingsLoaded && !settingsSaving && !document.querySelector('.website-section-loading,.admin-global-page-skeleton')`);
  const edit = async (suffix, value) => h.run(`(()=>{const e=document.getElementById(${JSON.stringify(prefix+suffix)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const save = async () => {
    await h.run(`document.getElementById('btnSaveAllHome').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Save All Changes'`);
    await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  };
  const saved = async () => { await ready(); await h.until(`document.getElementById('btnSaveAllHome').disabled`); };
  const visible = async () => {
    await h.until(`!document.getElementById('universityPurposeSection').hidden && !document.querySelector('.fmrc-load-veil.is-on')`);
    await h.until(`[...document.querySelectorAll('.fmrc-load-boot,.fmrc-load-veil')].every(e=>getComputedStyle(e).visibility==='hidden' || getComputedStyle(e).display==='none' || getComputedStyle(e).opacity==='0')`);
  };
  const viewport = async width => {
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false}); await h.pause(120);
  };

  await h.go('/about-page/about.html');
  await h.until(`document.getElementById('missionTextEl').textContent===${JSON.stringify(original.mission_text)}`);
  assert.equal(await h.run(`document.getElementById('universityPurposeSection').hidden && document.getElementById('universityPurposeSection').getBoundingClientRect().height===0`), true);
  for (const role of ['admin','staff']) {
    settings = {...original};
    await h.go(`/${role}-page/website-about.html`); await ready();
    assert.equal(await h.run(`document.querySelector('#editorialContentFields summary').textContent`),'University Vision and Mission');
    assert.deepEqual(await h.run(`[...document.querySelectorAll('[data-editorial-setting^="${prefix}"]')].map(e=>e.maxLength)`),[100,100,80,1000,80,2500]);
    assert.equal(await h.run(`document.getElementById('${prefix}vision_copy').value`),'');
    assert.equal(await h.run(`document.getElementById('${prefix}mission_copy').value`),'');
    // Partial entry is saveable, but does not publish an incomplete section.
    await edit('vision_copy',vision); await save(); await saved();
    assert.equal(writes.at(-1).role,role);
    await h.go('/about-page/about.html');
    await h.until(`FMRC_PAGE_CONTENT.get('${prefix}vision_copy')===${JSON.stringify(vision)}`);
    assert.equal(await h.run(`document.getElementById('universityPurposeSection').hidden`),true);

    await h.go(`/${role}-page/website-about.html`); await ready();
    await edit('mission_copy','x'.repeat(2501));
    assert.equal(await h.run(`document.getElementById('${prefix}mission_copy').checkValidity()`),false);
    await edit('mission_copy',mission);
    await edit('name','Sample University');
    await edit('title','Institutional Vision and Mission');
    await edit('vision_title','University Vision');
    await edit('mission_title','University Mission');
    failSave = true; await save();
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Changes Not Saved'`);
    assert.equal(await h.run(`document.getElementById('${prefix}mission_copy').value`),mission);
    assert.equal(settings[prefix+'mission_copy'],'');
    await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    failSave = false; await save(); await saved();
    assert.equal(settings.mission_text,original.mission_text);
    assert.equal(settings.vision_text,original.vision_text);
    assert.equal(settings.mission_gallery,original.mission_gallery);

    await h.go(`/${role}-page/website-about.html`); await ready();
    assert.equal(await h.run(`document.getElementById('${prefix}mission_copy').value`),mission);
    for (const theme of ['light','dark']) for (const width of [320,390,768,1024,1440]) {
      await viewport(width);
      await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('${prefix}vision_copy').scrollIntoView({block:'center',behavior:'instant'})`);
      const geometry = await h.run(`(()=>{const e=document.getElementById('${prefix}vision_copy'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {fits:r.left>=0 && r.right<=innerWidth+1,overflow:document.documentElement.scrollWidth>innerWidth+1,text:s.color,surface:s.backgroundColor};})()`);
      assert.equal(geometry.fits,true,`${role} ${theme} ${width}: university fields fit`);
      assert.equal(geometry.overflow,false,`${role} ${theme} ${width}: editor fits`);
      assert.notEqual(geometry.text,geometry.surface);
      if (width===390 && theme==='dark') await h.shot(`university-${role}-dark-390`);
    }
    await h.run(`document.getElementById('${prefix}vision_copy').focus()`);
    await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert.equal(await h.run(`document.activeElement.id`),prefix+'mission_title','keyboard moves through the shared editor');
    await edit('vision_copy','Unsaved replacement');
    await h.run(`void loadAllData()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Discard changes?'`);
    await h.run(`document.getElementById('adminSystemPopupCancel').click()`);
    assert.equal(await h.run(`document.getElementById('${prefix}vision_copy').value`),'Unsaved replacement');
    await h.run(`void loadAllData()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Discard changes?'`);
    await h.run(`document.getElementById('adminSystemPopupOk').click()`); await ready();
    assert.equal(await h.run(`document.getElementById('${prefix}vision_copy').value`),vision);
    assert.deepEqual(await h.run('fixtureErrors'),[]);

    await h.go('/about-page/about.html'); await visible();
    assert.equal(await h.run(`document.querySelector('[data-editorial-copy="${prefix}mission_copy"]').textContent`),mission);
    assert.equal(await h.run(`document.querySelector('.university-purpose-copy b')===null`),true,'markup stays literal');
    const footer = await h.run(`document.querySelector('.site-footer').innerHTML`);
    for (const width of [320,390,768,1024,1440]) {
      await viewport(width);
      await h.run(`document.getElementById('universityPurposeSection').scrollIntoView({block:'start',behavior:'instant'})`);
      const geometry = await h.run(`(()=>{const cards=[...document.querySelectorAll('.university-purpose-card')],a=cards[0].getBoundingClientRect(),b=cards[1].getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,stacked:b.top>=a.bottom,ratio:b.width/a.width,paragraphs:getComputedStyle(document.querySelector('.university-purpose-copy')).whiteSpace,ordered:!!(document.getElementById('aboutPurposeHeading').compareDocumentPosition(document.getElementById('universityPurposeSection')) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(document.getElementById('universityPurposeSection').compareDocumentPosition(document.getElementById('aboutAudienceHeading')) & Node.DOCUMENT_POSITION_FOLLOWING)};})()`);
      assert.equal(geometry.overflow,false,`Customer ${width}: page fits`);
      assert.equal(geometry.stacked,width<768,`Customer ${width}: responsive card layout`);
      if(width>=768) assert(geometry.ratio>1.9,'mission has the wider panel');
      assert.equal(geometry.paragraphs,'pre-wrap'); assert.equal(geometry.ordered,true);
      if(role==='admin' && [390,1440].includes(width)) await h.shot(`university-customer-${width}`);
    }
    // Exercise the existing carousel and lightbox beside the new content.
    await h.until(`document.querySelectorAll('#missionDeck [data-current]').length===2`);
    await h.run(`document.querySelector('#missionDeck [data-current="true"]').focus()`);
    await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
    await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
    assert.equal(await h.run(`document.getElementById('missionDeck')._editorialIndex`),1);
    await h.run(`document.querySelector('#missionDeck [data-current="true"]').click()`);
    await h.until(`document.getElementById('serviceImageLightboxModal').classList.contains('show-modal')`);
    await h.run(`document.getElementById('closeServiceLightboxBtn').click()`);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
    const before = reads;
    settings[prefix+'mission_copy'] = ' \n\t ';
    await h.run(`localStorage.setItem('fmrc_site_content_updated_at',String(Date.now()));window.dispatchEvent(new StorageEvent('storage',{key:'fmrc_site_content_updated_at'}))`);
    await h.until(`document.getElementById('universityPurposeSection').hidden`);
    assert(reads>before,'existing realtime settings path refreshed the customer section');
    assert.equal(await h.run(`document.getElementById('universityPurposeSection').getBoundingClientRect().height`),0);
    assert.equal(await h.run(`document.querySelector('.site-footer').innerHTML`),footer);
  }
  console.log('University statement browser screenshots:',h.artifacts);
});
