const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const north='0501600000',south='0501700000',literal='San <sample>, Demo';
const locations={
 [north]:[{code:'0501603000',name:'Labo'},{code:'0501602000',name:'Daet'},{code:'0501699000',name:literal}],
 [south]:[{code:'0501714000',name:'Naga'}]
};
const zone={id:'10000000-0000-4000-8000-000000000001',name:'Province coverage',province:'Camarines Norte',cities:[],postal_codes:[],fee:75,preparation_days:2,transit_min_days:1,transit_max_days:3};
async function fixture(t,{cities=[],failNorth=false,holdSouth=false}={}){
 let draft={enabled:true,nonworking_weekdays:[7],nonworking_dates:[],zones:[{...zone,cities}]},published=structuredClone(draft),revision=1,releaseSouth;
 const reads=[],writes=[],snapshot=()=>({can_edit:true,revision,published,draft,has_saved_draft:true});
 const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/admin/shipping-settings'){json({data:snapshot()});return true;}
  if(route==='/api/psgc/provinces'){json([{code:north,name:'Camarines Norte'},{code:south,name:'Camarines Sur'}]);return true;}
  const code=route.match(/^\/api\/psgc\/provinces\/(\d+)\/cities-municipalities$/)?.[1];
  if(code){reads.push(code);if(code===north&&failNorth){failNorth=false;json({message:'Unavailable'},503);return true;}if(code===south&&holdSouth)await new Promise(resolve=>releaseSouth=resolve);json(locations[code]);return true;}
  if(route==='/api/admin/shipping-settings/draft'){
   let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);assert.equal(input.expected_revision,revision);writes.push(input);draft=input.settings;revision++;json({data:snapshot()});return true;
  }return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=s=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
 const input=(s,v)=>h.run(`{const n=document.querySelector(${JSON.stringify(s)});n.value=${JSON.stringify(v)};n.dispatchEvent(new Event('input',{bubbles:true}));}`);
 const key=async key=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:{ArrowDown:40,ArrowUp:38,Enter:13,Escape:27,Tab:9}[key]});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
 const province=async name=>{await click('#shipping-0-province-search');await input('#shipping-0-province-search',name);await key('Enter');};
 const choose=async code=>{await click('#shipping-0-cities-search');await click(`[data-city-code="${code}"]`);};
 const values=()=>h.run(`JSON.parse(document.getElementById('shipping-0-cities').value)`);
 const size=async(width,height=950)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await h.pause(100);await h.run(`if(innerWidth<600&&document.body.classList.contains('admin-sidebar-open'))document.querySelector('.admin-sidebar-toggle').click();Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);};
 await size(1440);await h.go('/admin-page/website-shipping.html');await h.until(`document.getElementById('shipping-0-cities-search')&&!document.getElementById('shippingFields').disabled&&!document.getElementById('shippingProvinceStatus').textContent&&!document.querySelector('[data-city-status]').textContent.includes('Loading')&&!document.querySelector('.website-section-loading')`);
 return {...h,click,input,key,province,choose,values,size,reads,writes,published,release:()=>releaseSouth?.(),hasRelease:()=>!!releaseSouth};
}

test('Required city coverage preserves province-wide areas, multiple locations, safe names and save readback',{skip:!chrome,timeout:120000},async t=>{
 const h=await fixture(t);
 assert.deepEqual(await h.values(),[]);assert.equal(await h.run(`document.getElementById('shipping-0-cities-search').value`),'All cities and municipalities');
 assert(await h.run(`document.getElementById('shippingSave').disabled&&document.getElementById('shipping-0-cities-search').required`));
 await h.click('#shipping-0-cities-search');await h.input('#shipping-0-cities-search','Daet');assert.equal(await h.run(`document.getElementById('shippingSave').disabled`),true,'Searching does not edit coverage');await h.key('ArrowDown');await h.key('Enter');assert.deepEqual(await h.values(),['Daet'],'The explicit province-wide entry remains first in filtered results');
 await h.choose('0501603000');await h.choose('0501699000');assert.deepEqual(await h.values(),['Daet','Labo',literal]);assert.equal(await h.run(`document.querySelectorAll('[data-city-picker] sample').length`),0,'Location names render as plain text');
 await h.click('[data-city-remove="Daet"]');assert.deepEqual(await h.values(),['Labo',literal]);assert.deepEqual(h.published.zones[0].cities,[],'Draft selection never changes published coverage');
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.size(width);await h.run(`document.documentElement.dataset.theme='${theme}'`);await h.click('#shipping-0-cities-search');
  assert(await h.run(`(()=>{const input=document.getElementById('shipping-0-cities-search'),list=document.getElementById('shipping-0-cities-list'),r=list.getBoundingClientRect();return input.getAttribute('aria-expanded')==='true'&&getComputedStyle(list).display!=='none'&&r.left>=0&&r.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('[data-city-remove]')].every(n=>n.getBoundingClientRect().height>=44)})()`),'Picker and selected chips fit '+width+' '+theme);
  if([390,1440].includes(width)){await h.run(`document.getElementById('shipping-0-province-search').scrollIntoView({block:'start',behavior:'instant'});document.fonts.ready`);await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot('city-picker-'+width+'-'+theme);}
  await h.key('Escape');assert.equal(await h.run(`document.getElementById('shipping-0-cities-search').getAttribute('aria-expanded')`),'false');
 }
 await h.choose('all');await h.key('Tab');assert.deepEqual(await h.values(),[]);assert.equal(await h.run(`document.getElementById('shippingSave').disabled`),true,'Returning to existing province-wide coverage restores the clean draft');
 await h.province('Sur');await h.until(`!document.querySelector('[data-city-status]').textContent.includes('Loading')`);assert.deepEqual(await h.values(),[]);assert(await h.run(`document.getElementById('shipping-0-cities-search').value===''&&document.getElementById('shippingSave').disabled&&document.getElementById('shippingPublish').disabled`),'Province changes require an explicit new coverage choice');
 await h.province('Norte');assert(await h.run(`!document.getElementById('shippingDiscard').disabled&&document.getElementById('shippingSave').disabled`),'A reset to blank coverage can be discarded even when its array is still empty');
 await h.run(`document.getElementById('shippingForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupMessage')?.textContent.includes('Choose cities')`);assert.equal(h.writes.length,0,'Direct submission cannot save a pending choice');await h.click('#adminSystemPopupOk');await h.click('#shippingDiscard');assert.equal(await h.run(`document.getElementById('shipping-0-cities-search').value`),'All cities and municipalities');
 await h.choose('0501603000');await h.choose('0501699000');await h.key('Tab');await h.click('#shippingSave');await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Save Shipping Draft'`);await h.click('#adminSystemPopupOk');await h.until(`!document.getElementById('shippingFields').disabled&&document.getElementById('shippingSave').disabled`);assert.deepEqual(h.writes[0].settings.zones[0].cities,['Labo',literal]);assert.deepEqual(await h.values(),['Labo',literal]);assert.equal(h.writes[0].settings.zones[0].fee,75);assert.deepEqual(h.reads.sort(),[north,south],'Each province is loaded once across rerenders');assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});

test('City lookup failure, retry and stale responses preserve the draft and current province',{skip:!chrome,timeout:120000},async t=>{
 const h=await fixture(t,{cities:['Labo'],failNorth:true,holdSouth:true});
 assert(await h.run(`!document.querySelector('[data-city-retry]').hidden&&document.getElementById('shippingSave').disabled`));assert.deepEqual(await h.values(),['Labo']);await h.input('#shipping-0-fee','125.50');await h.click('[data-city-retry]');await h.until(`document.querySelector('[data-city-retry]').hidden&&!document.getElementById('shippingSave').disabled`);assert.equal(await h.run(`document.getElementById('shipping-0-fee').value`),'125.50');assert.deepEqual(await h.values(),['Labo']);
 await h.province('Sur');for(let i=0;!h.hasRelease()&&i<100;i++)await h.pause(20);assert(h.hasRelease());await h.province('Norte');await h.click('#shipping-0-cities-search');assert(await h.run(`document.getElementById('shipping-0-cities-list').textContent.includes('Labo')`));h.release();await h.pause(180);assert(await h.run(`document.getElementById('shipping-0-province').value==='Camarines Norte'&&!document.getElementById('shipping-0-cities-list').textContent.includes('Naga')`),'Late response for another province cannot replace the current choices');assert.deepEqual(await h.values(),[],'No old selection leaks back after Province changes');
 await h.choose('all');await h.key('Tab');assert(await h.run(`!document.getElementById('shippingSave').disabled`));assert.equal(await h.run(`document.getElementById('shipping-0-fee').value`),'125.50');assert.equal(h.writes.length,0);assert.deepEqual(await h.run('fixtureErrors'),[]);
});
