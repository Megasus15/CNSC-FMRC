const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
for(const role of ['admin','staff'])test(role+' Inquiries refinement preserves read, resolve, delete, filters and nested feedback',{skip:!chrome,timeout:180000},async t=>{
 const message='Literal <img src=x onerror="window.unsafeInquiry=true">\n\n'+('A long customer message with complete paragraphs and details. '.repeat(45));
 let rows=Array.from({length:13},(_,i)=>({id:i+1,sender_name:i===0?'Customer with a long display name':'Customer '+(i+1),sender_email:'client'+(i+1)+'@example.test',message:i===0?message:'Inquiry '+(i+1),status:'new',is_read:false,created_at:'2026-11-14T08:00:00Z'}));
 let failResolve=true,holdResolve=false,release,failDelete=true;const writes=[];
 const font=process.env.FMRC_BROWSER_POPPINS;
 const setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/admin/customer-messages'){
   const p=new URL(req.url,'http://fixture').searchParams,search=(p.get('search')||'').toLowerCase(),status=p.get('status');
   const data=rows.filter(r=>(!status||status==='all'||status==='unread'&&!r.is_read||status===r.status)&&[r.sender_name,r.sender_email,r.message].join(' ').toLowerCase().includes(search));
   json({data,summary:{total:rows.length,new:rows.filter(r=>r.status==='new').length,unread:rows.filter(r=>!r.is_read).length,resolved:rows.filter(r=>r.status==='resolved').length}});return true;
  }
  const match=route.match(/^\/api\/admin\/customer-messages\/(\d+)(?:\/(read|resolve))?$/);
  if(match){const id=Number(match[1]),action=match[2]||'delete',r=rows.find(r=>r.id===id);writes.push({action,id});
   if(action==='resolve'){if(holdResolve)await new Promise(resolve=>release=resolve);if(failResolve){json({message:'Resolution could not be saved.'},503);return true;}r.status='resolved';r.is_read=true;}
   if(action==='read')r.is_read=true;
   if(action==='delete'){if(failDelete){json({message:'Deletion could not be saved.'},503);return true;}rows=rows.filter(r=>r.id!==id);}
   json({data:r,message:'Saved.'});return true;
  }
  return false;
 },{setup});
 t.after(()=>release?.());await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const click=selector=>h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);
 const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
 const key=async key=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Escape'?27:9});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
 const shot=async name=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(name);};
 await h.go('/'+role+'-page/customer-inquiries.html');await h.until(`document.querySelector('[data-action=view]')`);
 const hoverInquiry=async s=>{const r=await h.run(`(()=>{const n=document.querySelector(${JSON.stringify(s)});n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',...r});await h.pause(60);await h.run(`Promise.all(document.querySelector(${JSON.stringify(s)}).getAnimations().map(a=>a.finished.catch(()=>{})))`);return h.run(`getComputedStyle(document.querySelector(${JSON.stringify(s)})).backgroundColor`);};
 assert.equal(await hoverInquiry('[data-action=delete][data-id="1"]'),await hoverInquiry('[data-action=view][data-id="1"]'),'Inquiry delete hover uses the standard maroon');await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
 for(const width of [320,390,768,1024,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
  assert(await h.run(`(()=>{let cards=[...document.querySelectorAll('.inquiry-stat-card')];return cards.length===4&&cards.every(c=>c.scrollWidth<=c.clientWidth+1)&&document.documentElement.scrollWidth<=innerWidth+1})()`),'Summary cards fit '+width);
  assert(await h.run(`[...document.querySelectorAll('.portal-summary-card')].every(c=>{const i=c.querySelector('.portal-summary-icon'),v=c.querySelector('.portal-summary-value'),l=c.querySelector('.portal-summary-label');return i.getBoundingClientRect().width===46&&v.getBoundingClientRect().top<l.getBoundingClientRect().top&&parseFloat(getComputedStyle(v).fontSize)===24})`),'Inquiry summaries use Inventory geometry '+width);
 }
 await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:950,deviceScaleFactor:1,mobile:false});await shot(role+'-inquiries-workspace');
 await click('[data-action=view][data-id="1"]');await h.until(`document.getElementById('inquiryDetailModal').classList.contains('show')`);
 assert.equal(await h.run(`document.getElementById('detailMessage').textContent`),message);assert.equal(await h.run('window.unsafeInquiry===true'),false);
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
  const g=await h.run(`(()=>{let r=document.getElementById('inquiryDetailModal'),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),f=r.querySelector('footer').getBoundingClientRect(),head=r.querySelector('header').getBoundingClientRect(),q=c.getBoundingClientRect();return {fits:q.left>=0&&q.right<=innerWidth+1&&f.bottom<=innerHeight+1,overflow:c.scrollHeight>c.clientHeight+1||b.scrollWidth>b.clientWidth+1,locked:document.body.style.position==='fixed',scroll:b.scrollHeight>b.clientHeight,header:head.bottom<=b.getBoundingClientRect().top+1}})()`);
  assert(g.fits&&!g.overflow&&g.locked&&g.scroll&&g.header,JSON.stringify({width,theme,g}));
  assert(await h.run(`[...document.querySelectorAll('#inquiryDetailModal footer button')].every(b=>b.scrollWidth<=b.clientWidth+1&&b.getBoundingClientRect().height>=44)`),'Footer labels fit at '+width);
  if([390,1440].includes(width))await shot(role+'-inquiry-details-'+width+'-'+theme);
 }
 await h.send('Emulation.setDeviceMetricsOverride',{width:740,height:360,deviceScaleFactor:1,mobile:false});assert(await h.run(`document.querySelector('#inquiryDetailModal footer').getBoundingClientRect().bottom<=innerHeight`));
 await h.send('Emulation.setDeviceMetricsOverride',{width:720,height:450,deviceScaleFactor:1,mobile:false});await h.run(`document.getElementById('inquiryDetailModal').style.letterSpacing='0.12em'`);
 assert(await h.run(`document.querySelector('#inquiryDetailModal .portal-detail-dialog__body').scrollWidth<=document.querySelector('#inquiryDetailModal .portal-detail-dialog__body').clientWidth+1`),'Zoom-equivalent layout and adjusted text spacing fit');
 await key('Tab');assert(await h.run(`document.getElementById('inquiryDetailModal').contains(document.activeElement)`));
 await key('Escape');await h.until(`document.body.style.position!=='fixed'`);assert(await h.run(`document.activeElement.matches('[data-action=view][data-id="1"]')`));
 await click('[data-action=view][data-id="1"]');await click('#detailResolveBtn');await popup('Resolve Inquiry');
 assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup [data-portal-detail-close]').length`),0);
 await click('#adminSystemPopupCancel');assert(await h.run(`document.body.style.position==='fixed'`));
 await click('#detailResolveBtn');await popup('Resolve Inquiry');await click('#adminSystemPopupOk');await popup('Update Failed');
 assert(await h.run(`document.getElementById('inquiryDetailModal').classList.contains('show')`),'Failed resolve keeps details open');assert.equal(rows[0].status,'new');
 await click('#adminSystemPopupOk');failResolve=false;holdResolve=true;await click('#detailResolveBtn');await popup('Resolve Inquiry');await click('#adminSystemPopupOk');
 await h.until(`document.getElementById('inquiryDetailModal').getAttribute('aria-busy')==='true'`);
 await key('Escape');await h.run(`document.querySelector('#inquiryDetailModal [data-modal-close]').click()`);assert(await h.run(`document.getElementById('inquiryDetailModal').classList.contains('show')`));
 holdResolve=false;release();await h.until(`!document.getElementById('inquiryDetailModal').classList.contains('show')&&document.querySelector('.admin-success-notification')`);
 assert.equal(rows[0].status,'resolved');assert.equal(writes.filter(w=>w.action==='resolve').length,2);
 assert.equal(await h.run(`document.querySelectorAll('.admin-success-notification__close svg').length>0`),true);
 await click('.admin-success-notification__close');
 await click('[data-action=read][data-id="2"]');await h.until(`document.querySelector('[data-action=read][data-id="2"]').disabled`);
 await click('[data-action=delete][data-id="2"]');await popup('Delete Inquiry');await click('#adminSystemPopupOk');await popup('Delete Failed');await click('#adminSystemPopupOk');assert(rows.some(r=>r.id===2));
 failDelete=false;await click('[data-action=delete][data-id="2"]');await popup('Delete Inquiry');await click('#adminSystemPopupOk');await h.until(`!document.querySelector('[data-action=view][data-id="2"]')`);assert(!rows.some(r=>r.id===2));
 await h.run(`{let s=document.getElementById('inquirySearchInput');s.value='client13@';s.dispatchEvent(new Event('input',{bubbles:true}));}`);await h.until(`document.querySelectorAll('#inquiriesTableBody [data-action=view]').length===1`);
 assert.equal(await h.run(`document.querySelector('#inquiriesTableBody [data-action=view]').dataset.id`),'13');
 await h.run(`{let s=document.getElementById('inquirySearchInput');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('inquiryStatusFilter').value='resolved';document.getElementById('inquiryStatusFilter').dispatchEvent(new Event('change'));}`);await h.until(`document.querySelectorAll('#inquiriesTableBody [data-action=view]').length===1&&document.querySelector('#inquiriesTableBody [data-action=view]').dataset.id==='1'`);
 assert.deepEqual(await h.run('fixtureErrors'),[]);
 // Read-only visual samples use ordinary text after the unsafe-text assertions.
 await click('[data-action=view][data-id="1"]');await h.run(`document.getElementById('inquiryDetailModal').style.letterSpacing='';document.getElementById('detailSenderName').textContent='Maria Santos';document.getElementById('detailSenderEmail').textContent='maria@example.test';document.getElementById('detailMessage').textContent='Good day. I would like to ask about laser engraving services for a university project.\\n\\nCould you share the available materials, consultation schedule, and documents needed? Thank you.';document.documentElement.dataset.theme='light';`);
 for(const width of [390,1440]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await shot(role+'-inquiry-preview-'+width);}
 t.diagnostic('Screenshots: '+h.artifacts);
});
