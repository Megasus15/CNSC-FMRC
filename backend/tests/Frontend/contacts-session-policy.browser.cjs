const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

const fonts = () => {
  let css = process.env.FMRC_BROWSER_FA_CSS ? fs.readFileSync(process.env.FMRC_BROWSER_FA_CSS, 'utf8') : '';
  for (const [variable, family, weight] of [['FMRC_BROWSER_POPPINS','Poppins','400'],['FMRC_BROWSER_MONTSERRAT','Montserrat','100 900'],['FMRC_BROWSER_FA','Font Awesome 6 Free','900'],['FMRC_BROWSER_FA_REGULAR','Font Awesome 6 Free','400']]) {
    if (process.env[variable]) css += `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(process.env[variable]).toString('base64')})}`;
  }
  return `{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)}`;
};
const body = async req => { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw); };
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const controls = h => ({
  async size(width, height = 950) { await h.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<600}); await h.pause(100); },
  click: selector => h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click()}`),
  input: (id, value, event = 'input') => h.run(`{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))}`),
});

for (const role of ['admin','staff']) test(role+' personal session settings save only the next-sign-in preference', {skip:!chrome,timeout:90000}, async t => {
  let preference = {enabled:true,max_hours:6}, fail = false, missing = false;
  const writes = [], deadline = new Date(Date.now()+21600000).toISOString();
  const h = await browserFixture(t, async ({req,route,json,role:actual}) => {
    if (route === '/api/admin/session/preferences') {
      assert.equal(actual, role);
      if (missing) { json({message:'Automatic sign-out settings require the latest database update. Your existing session protection remains active.'},503); return true; }
      if (req.method === 'PUT') { const value=await body(req); writes.push(value); if(fail) {json({message:'Fixture save unavailable.'},503);return true;} preference=value; }
      json({preferences:preference,effective_on:'next_login'}); return true;
    }
    if (route === '/api/admin/session') { json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:deadline,absolute_limit_enabled:true}); return true; }
    return false;
  }, {setup:fonts()});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const {size,click,input}=controls(h);
  const ready=()=>h.until(`!document.getElementById('sessionPolicyEnabled').disabled&&!document.getElementById('sessionPolicyRetry').getClientRects().length`);
  const saved=()=>h.until(`document.getElementById('sessionPolicyStatus').textContent.startsWith('Saved for your next sign-in')`);
  await size(1440); await h.go('/'+role+'-page/settings.html'); await ready();
  const current=await h.run(`document.getElementById('sessionPolicyCurrent').textContent`);
  for(const width of [320,390,768,1024,1440]) for(const theme of ['light','dark']) {
    await size(width); await h.run(`document.documentElement.dataset.theme='${theme}';document.getElementById('sessionPolicyCard').scrollIntoView({block:'center',behavior:'instant'})`);
    assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1&&document.getElementById('sessionPolicyHours').getBoundingClientRect().height>=44&&document.getElementById('sessionPolicyCard').textContent.includes('60 minutes')&&document.getElementById('sessionPolicyCard').textContent.includes('63 minutes')`),width+' '+theme);
    if ([390,1440].includes(width)) {await h.run('document.fonts.ready');await h.shot(role+'-session-'+width+'-'+theme);}
  }
  await size(1440); await input('sessionPolicyHours','12','change'); await saved(); assert.deepEqual(preference,{enabled:true,max_hours:12});
  await click('#sessionPolicyEnabled'); await saved(); assert.deepEqual(preference,{enabled:false,max_hours:12});
  assert.equal(await h.run(`document.getElementById('sessionPolicyCurrent').textContent`),current);
  await h.go('/'+role+'-page/settings.html'); await ready(); assert(await h.run(`!document.getElementById('sessionPolicyEnabled').checked&&document.getElementById('sessionPolicyHours').disabled&&document.getElementById('sessionPolicyHours').value==='12'`));
  await click('#sessionPolicyEnabled'); await saved(); fail=true; await input('sessionPolicyHours','6','change');
  await h.until(`document.getElementById('sessionPolicyStatus').textContent.includes('has not been saved')`);
  assert.equal(await h.run(`document.getElementById('sessionPolicyHours').value`),'6'); assert.equal(preference.max_hours,12);
  fail=false; await click('#sessionPolicyRetry'); await saved(); assert.equal(preference.max_hours,6);
  await input('sessionPolicyHours','12','change'); await saved(); await click('#settingsResetBtn'); await saved(); assert.deepEqual(preference,{enabled:true,max_hours:6});
  await size(740,360); assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`));
  await size(720,450); await h.run(`{const s=document.createElement('style');s.textContent='#sessionPolicyCard :is(p,label,select){line-height:1.5!important;letter-spacing:.12em;word-spacing:.16em}';document.head.append(s)}`); assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`));
  missing=true; await h.go('/'+role+'-page/settings.html'); await h.until(`document.getElementById('sessionPolicyStatus').textContent.includes('database update')`); assert(await h.run(`document.getElementById('sessionPolicyEnabled').disabled&&document.getElementById('sessionPolicyHours').disabled`));
  missing=false; await click('#sessionPolicyRetry'); await ready();
  assert(writes.every(value=>Object.keys(value).sort().join(',')==='enabled,max_hours')); assert.deepEqual(await h.run('fixtureErrors'),[]); t.diagnostic('Previews: '+h.artifacts);
});

test('official email contacts preview, save/readback, restore and failed-save drafts', {skip:!chrome,timeout:90000}, async t => {
  const defaults={facebook_url:'https://www.facebook.com/WebsiteFMRC',website_url:'https://ucn-fabmanlab.com',phone:'0909-099-0000'};
  const parts={header_title:'UCN-FMRC',header_subtitle:'Order updates',header_color:'#800000',body_heading:'Order received',body_text:'Hello {customer_name}.\n\nKeep your order reference.',footer_note:'Thank you.'};
  let saved=null,fail=false; const writes=[],previews=[];
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/email-templates'){json({data:{key_prefix:'email_tpl_',groups:['Orders'],editable_parts:Object.keys(parts),clearable_parts:['header_subtitle','footer_note'],templates:[{slug:'order_received',label:'Order received',group:'Orders',defaults:parts,saved:{},tokens:['customer_name']}],contact_footer:{key:'email_tpl_official_contacts',defaults,saved,effective:saved||defaults}}});return true;}
    if(route==='/api/admin/email-templates/preview'){const value=await body(req);previews.push(value);json({data:{slug:value.slug,html:`<!doctype html><html><body><h1>${escape(value.parts.header_title)}</h1><p>${escape(value.parts.body_text)}</p><footer>${Object.values(value.contact_footer).map(escape).join(' | ')}</footer></body></html>`}});return true;}
    if(route==='/api/admin/site-settings'&&req.method==='PUT'){const value=await body(req);writes.push(value);if(fail){json({message:'Fixture contacts save failed.'},503);return true;}assert.deepEqual(Object.keys(value),['email_tpl_official_contacts']);saved=value.email_tpl_official_contacts?JSON.parse(value.email_tpl_official_contacts):null;json({message:'Saved'});return true;}
    return false;
  },{setup:fonts()});
  await h.send('Network.setBlockedURLs',{urls:['https://*']}); const {size,click,input}=controls(h);
  const ready=()=>h.until(`state.loaded&&!state.saving&&document.getElementById('emailTemplatePreviewState').textContent==='Sample content'`);
  const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
  const save=async()=>{await click('#emailTemplateSaveBtn');await popup('Save All Changes');await click('#adminSystemPopupOk');};
  await size(1440);await h.go('/admin-page/website-emails.html');await ready();assert.equal(await h.run(`document.getElementById('emailContact_phone').value`),defaults.phone);
  for(const width of [320,390,768,1024,1440]){await size(width);await h.run(`document.getElementById('emailContactsCard').scrollIntoView({block:'center',behavior:'instant'})`);assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('#emailContactsFields input')].every(n=>n.getBoundingClientRect().height>=44)`));if([390,1440].includes(width)){await h.run('document.fonts.ready');await h.shot('email-contacts-'+width);}}
  await input('emailContact_phone','+63 912 345 6789');await h.until(`document.getElementById('emailTemplatePreview').srcdoc.includes('+63 912 345 6789')`);assert.equal(saved,null);fail=true;await save();await popup('Changes Not Saved');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('emailContact_phone').value`),'+63 912 345 6789');assert.equal(saved,null);
  fail=false;await save();await ready();assert.equal(saved.phone,'+63 912 345 6789');assert.equal(await h.run(`document.getElementById('emailTemplateSaveBtn').disabled`),true);
  await h.go('/admin-page/website-emails.html');await ready();assert.equal(await h.run(`document.getElementById('emailContact_phone').value`),saved.phone);
  await click('#emailContactsRestore');await popup('Restore Contact Defaults');await click('#adminSystemPopupOk');assert(saved);await save();await ready();assert.equal(saved,null);assert.equal(writes.at(-1).email_tpl_official_contacts,'');
  assert(previews.every(value=>value.parts.body_text===parts.body_text));assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});

test('Customer policy documents preserve wording, safe icons and responsive sticky contents', {skip:!chrome,timeout:90000}, async t => {
  const paragraphs=['Ordering','Payment','Delivery and pickup','Cancellations','Refund concerns','Contact FMRC','An edited <heading> with a very long name that should wrap safely'];
  const text=paragraphs.map((heading,i)=>heading+'\n'+('Published policy paragraph '+(i+1)+'. ').repeat(18)+'\nA preserved line break.').join('\n\n');
  const h=await browserFixture(t,async({route,json})=>{if(route.startsWith('/api/commerce/policy')){json({data:{version:'fixture-version',title:'Published order policies',terms_text:text,refund_text:text,published_at:'2026-11-01 08:00:00'}});return true;}return false;},{setup:fonts()});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});const {size,click}=controls(h);
  for(const type of ['transaction-terms','refund-policy']){
    await size(1440);await h.go('/products-page/'+type+'.html?version=fixture-version');await h.until(`!document.getElementById('policySections').hidden`);
    assert.equal(await h.run(`document.querySelectorAll('.policy-document-section').length`),paragraphs.length);assert.equal(await h.run(`document.querySelector('.policy-document-section:last-child h2 span').textContent`),paragraphs.at(-1));assert.equal(await h.run(`document.querySelector('.policy-document-section:last-child h2 i').className`),'fa-solid fa-file-lines');assert(await h.run(`document.getElementById('policyRefundPageLink').href.endsWith('?version=fixture-version')&&!document.querySelector('.policy-card heading')`));
    for(const width of [320,390,768,1024,1440]){
      await size(width);await h.run(`scrollTo({top:0,behavior:'instant'})`);await h.pause(120);
      assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`),'Policy fits '+width);
      if([390,1440].includes(width)){await h.run('document.fonts.ready');await h.shot(type+'-'+width);}
      await h.run(`scrollTo({top:1000,behavior:'instant'})`);await h.pause(120);
      const layout=await h.run(`(()=>{const c=document.querySelector('.policy-contents').getBoundingClientRect(),header=document.querySelector('.site-header').getBoundingClientRect();return {top:c.top,header:header.bottom,open:document.getElementById('policyContentsDisclosure').open,height:c.height}})()`);
      assert(Math.abs(layout.top-layout.header-(width<=800?8:16))<2,JSON.stringify({width,...layout}));
      if(width<=800){assert.equal(layout.open,false);assert(layout.height<100);await click('#policyContentsDisclosure summary');await click('#policyContentsLinks a:last-child');await h.pause(120);assert.equal(await h.run(`document.getElementById('policyContentsDisclosure').open`),false);assert.equal(await h.run('location.hash'),'#'+type+'-section-7');}
    }
    await size(1024,360);await h.run(`scrollTo({top:1000,behavior:'instant'})`);await h.pause(100);assert(await h.run(`document.querySelector('.policy-contents').getBoundingClientRect().bottom<=innerHeight-15`),'Contents remain usable in short landscape');
    await size(720,450);await h.run(`{const s=document.createElement('style');s.textContent='.policy-page :is(p,a,h1,h2,summary){line-height:1.5!important;letter-spacing:.12em;word-spacing:.16em}';document.head.append(s)}`);assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`));
  }
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});
