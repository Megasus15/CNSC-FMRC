// Canonical Customer/Admin/Staff pages with isolated persisted settings.
// All statements are synthetic fixtures, not official university content.
const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');
const fs = require('node:fs');
const prefix = 'editorial_about_university_';
const vision = 'CNSC sample institutional vision.';
const mission = 'A sample first paragraph\ndescribing teaching and research.\n\nA second paragraph with <b>literal markup</b> and '+ 'community work. '.repeat(28);
const displayedMission = mission.replace('paragraph\ndescribing','paragraph describing');
const widths = [320,390,768,1024,1440,1920];
const contrast = (foreground, background) => {
  const luminance = color => color.slice(0,3).map(c => c/255).map(c => c<=.04045 ? c/12.92 : ((c+.055)/1.055)**2.4)
    .reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const a=luminance(foreground), b=luminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};
const rgb = color => color.match(/[\d.]+/g).map(Number);

test('university statements save through both portals and publish together on About Us', {skip:!chrome, timeout:180000}, async t => {
  const original = {mission_text:'Existing FMRC mission.', vision_text:'Existing FMRC vision.', about_video_url:'',
    mission_gallery:JSON.stringify(['/images/FMRC Brand Logo.png','/images/UCN Logo.png']),
    vision_gallery:JSON.stringify(['/images/UCN Logo.png','/images/FMRC Brand Logo.png'])};
  let settings = {...original}, failSave = false, reads = 0;
  const writes = [];
  // Optional local font keeps visual review offline and uses the production
  // typeface without making the test suite depend on an external font CDN.
  const fontPath = process.env.FMRC_BROWSER_MONTSERRAT;
  const fontSetup = fontPath ? `{const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Montserrat;src:url(data:font/ttf;base64,${fontPath ? fs.readFileSync(fontPath).toString('base64') : ''}) format('truetype');font-weight:100 900;font-display:swap}`)};document.head.append(s);}` : '';
  const h = await browserFixture(t, async ({req, route, json, role}) => {
    if (route === '/api/site-settings') { reads++; json({data:settings}); return true; }
    if (route === '/api/admin/site-settings' && req.method === 'PUT') {
      let text = ''; for await (const chunk of req) text += chunk;
      const input = JSON.parse(text);
      if (failSave) { json({message:'Temporary save failure'},503); return true; }
      writes.push({role, input}); Object.assign(settings,input); json({message:'Saved'}); return true;
    }
    return false;
  }, {setup:fontSetup});
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
  const viewport = async (width, scale=1) => {
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:scale,mobile:false}); await h.pause(120);
  };
  const statementLayout = () => h.run(`(()=>{const root=document.getElementById('universityPurposeSection');return {overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...root.querySelectorAll('.university-purpose-card')].map(card=>{const copy=card.querySelector('.university-purpose-copy'),r=card.getBoundingClientRect(),p=copy.getBoundingClientRect(),style=getComputedStyle(card);return {copyTop:p.top,contained:p.left>=r.left-1&&p.right<=r.right+1&&p.bottom<=r.bottom-parseFloat(style.paddingBottom)+1,copyClipped:copy.scrollHeight>copy.clientHeight+1||copy.scrollWidth>copy.clientWidth+1};})};})()`);

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
    for (const theme of ['light','dark']) for (const width of widths) {
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
    assert.equal(await h.run(`document.querySelector('[data-editorial-copy="${prefix}mission_copy"]').textContent`),displayedMission);
    assert.equal(await h.run(`FMRC_PAGE_CONTENT.get('${prefix}mission_copy')`),mission,'saved wording and document line breaks remain intact');
    assert.equal(await h.run(`document.querySelector('.university-purpose-copy b')===null`),true,'markup stays literal');
    const footer = await h.run(`document.querySelector('.site-footer').innerHTML`);
    if(fontPath){
      await h.run(`document.fonts.ready`);
      assert.equal(await h.run(`[...document.fonts].some(font=>font.family==='Montserrat'&&font.status==='loaded')`),true,'visual review uses the actual Montserrat typeface');
    }
    for (const width of widths) {
      await viewport(width);
      await h.run(`document.getElementById('universityPurposeSection').scrollIntoView({block:'start',behavior:'instant'})`);
      const geometry = await h.run(`(()=>{const cards=[...document.querySelectorAll('.university-purpose-card')],a=cards[0].getBoundingClientRect(),b=cards[1].getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth+1,stacked:b.top>=a.bottom,ratio:b.width/a.width,paragraphs:getComputedStyle(document.querySelector('.university-purpose-copy')).whiteSpace,ordered:!!(document.getElementById('aboutPurposeHeading').compareDocumentPosition(document.getElementById('universityPurposeSection')) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(document.getElementById('universityPurposeSection').compareDocumentPosition(document.getElementById('aboutAudienceHeading')) & Node.DOCUMENT_POSITION_FOLLOWING)};})()`);
      assert.equal(geometry.overflow,false,`Customer ${width}: page fits`);
      assert.equal(geometry.stacked,width<768,`Customer ${width}: responsive card layout`);
      if(width>=768) assert(geometry.ratio>1.9,'mission has the wider panel');
      assert.equal(geometry.paragraphs,'pre-wrap'); assert.equal(geometry.ordered,true);
      const reading = await h.run(`(()=>{const root=document.getElementById('universityPurposeSection'),vision=root.querySelector('.university-purpose-card--vision .university-purpose-copy'),mission=root.querySelector('.university-purpose-card--mission .university-purpose-copy');return {visionSize:parseFloat(getComputedStyle(vision).fontSize),missionSize:parseFloat(getComputedStyle(mission).fontSize),textWidth:mission.getBoundingClientRect().width,bodyWidth:mission.parentElement.getBoundingClientRect().width,icons:root.querySelectorAll('.university-purpose-icon svg').length,font:getComputedStyle(mission).fontFamily};})()`);
      assert(reading.visionSize>=24 && reading.missionSize>=18,`Customer ${width}: comfortable statement type sizes`);
      assert(Math.abs(reading.textWidth-reading.bodyWidth)<1,'mission uses the full reading column');
      assert.equal(reading.icons,2); assert.match(reading.font,/Montserrat/);
      const layout=await statementLayout();
      assert(layout.cards.every(card=>card.contained&&!card.copyClipped),`${width}: complete statements stay inside their panels`);
      if(width>=768)assert(Math.abs(layout.cards[0].copyTop-layout.cards[1].copyTop)<1,`${width}: statement starts align across wrapping labels`);
      const detail=await h.run(`(()=>{const root=document.getElementById('universityPurposeSection'),v=root.querySelector('.university-purpose-card--vision'),m=root.querySelector('.university-purpose-card--mission');return {icon:getComputedStyle(v.querySelector('.university-purpose-icon')).width,visionText:getComputedStyle(v.querySelector('.university-purpose-copy')).color,missionText:getComputedStyle(m.querySelector('.university-purpose-copy')).color,paper:getComputedStyle(root.querySelector('.university-purpose-grid')).backgroundColor,gradient:getComputedStyle(v).backgroundImage,arc:getComputedStyle(v,'::before').borderColor};})()`);
      assert.equal(parseFloat(detail.icon),width<768?44:48);
      assert(contrast(rgb(detail.missionText),rgb(detail.paper))>=4.5,'Mission text has readable contrast');
      const arc=rgb(detail.arc);
      for(const stop of detail.gradient.match(/rgb\([^)]+\)/g)||[]){
        const background=rgb(stop),decorated=background.map((c,i)=>c*(1-arc[3])+arc[i]*arc[3]);
        assert(contrast(rgb(detail.visionText),decorated)>=4.5,'Vision text stays readable over the decorative linework');
      }
      if(role==='admin' && [390,1440].includes(width)) await h.shot(`university-customer-${width}`);
    }
    if(role==='admin'){
      const sample = (text,length) => text.repeat(Math.ceil(length/text.length)).slice(0,length);
      const fixtures=[
        {name:'Sample University',title:'Vision and Mission',vision_title:'Vision',mission_title:'Mission',vision_copy:'A sample vision for a learning community that connects creative thinking, practical research and shared progress across the region.',mission_copy:'This illustrative mission brings education, research and community partnerships together through thoughtful projects, practical learning and shared responsibility. It supports a welcoming environment where ideas become useful skills and collaborative work benefits the wider community.\n\nThe statement demonstrates how a complete institutional paragraph fits within the reading panel. It provides enough sample text to review line spacing, alignment and comfortable reading without introducing official content into the application.'},
        {name:sample('A university with an intentionally long editable institutional name ',100),title:sample('An extended editable vision and mission heading ',100),vision_title:sample('An extended editable Vision heading ',80),mission_title:'Mission',vision_copy:sample('Illustrative direction for learning, research and community progress. ',1000),mission_copy:sample('Illustrative teaching, research and community partnerships build lasting opportunities.\n\n',2500)},
        {name:'Sample University',title:'Vision and Mission',vision_title:'Vision',mission_title:'Mission',vision_copy:'Forward.',mission_copy:'Together.'},
      ];
      for(const [index,fixture]of fixtures.entries()){
        await h.run(`FMRC_PAGE_CONTENT.apply({...${JSON.stringify(settings)},...${JSON.stringify(Object.fromEntries(Object.entries(fixture).map(([k,v])=>[prefix+k,v])))}})`);
        for(const width of widths){
          await viewport(width);
          const layout=await statementLayout();
          assert(!layout.overflow&&layout.cards.every(card=>card.contained&&!card.copyClipped),`fixture ${index}, ${width}: text reflows without clipping`);
          if(width>=768)assert(Math.abs(layout.cards[0].copyTop-layout.cards[1].copyTop)<1,`fixture ${index}, ${width}: headers share their natural row height`);
          if(index===0&&[390,1440,1920].includes(width)){
            await h.run(`document.getElementById('universityPurposeSection').scrollIntoView({block:'start',behavior:'instant'})`);
            await h.shot(`university-refined-${width}`);
          }
        }
        // A 1440px display at 200% zoom has a 720px CSS viewport.
        await viewport(720,2);
        let layout=await statementLayout();
        assert(!layout.overflow&&layout.cards.every(card=>card.contained&&!card.copyClipped),`fixture ${index}: 200% zoom reflows`);
        await h.run(`{const s=document.createElement('style');s.id='fixture-text-spacing';s.textContent='#universityPurposeSection :is(p,h2,h3){line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;margin-bottom:2em!important}';document.head.append(s);}`);
        for(const width of [320,768,1440]){
          await viewport(width);layout=await statementLayout();
          assert(!layout.overflow&&layout.cards.every(card=>card.contained&&!card.copyClipped),`fixture ${index}, ${width}: user text spacing is supported`);
        }
        await h.run(`document.getElementById('fixture-text-spacing').remove()`);
      }
      await h.run(`FMRC_PAGE_CONTENT.apply(${JSON.stringify(settings)})`);
      await viewport(1440);
      await h.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await h.run(`getComputedStyle(document.querySelector('.university-purpose-card--vision'),'::before').animationName`),'none');
      await h.send('Emulation.setEmulatedMedia',{features:[]});
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
