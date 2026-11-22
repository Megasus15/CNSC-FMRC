const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {browserFixture,chrome,root}=require('./helpers/website-browser.cjs');
const defaults=JSON.parse(fs.readFileSync(path.join(root,'backend/resources/support-assistant.json'),'utf8'));
const out=path.join(root,process.env.FMRC_SUPPORT_PREVIEWS||'output/customer-support');
const fontPath=path.join(root,'tmp/support-browser-fonts.css');
const fonts=[fontPath,path.join(root,'tmp/support-browser-fontawesome.css')].filter(p=>fs.existsSync(p)).map(p=>fs.readFileSync(p,'utf8')).join('\n');
const fontSetup=fonts?`{const s=document.createElement('style');s.textContent=${JSON.stringify(fonts)};document.head.append(s);}`:'';
function fixture(){
 let rows=[],messages=new Map(),next=1,entryId=1,failSend=false,available=false,saveFails=false,pack={...structuredClone(defaults),installed:true,revision:'r1'};pack.config.revision='r1';
 const writes=[];
 function present(row){const all=messages.get(row.id)||[],last=all.at(-1),unread=all.filter(e=>['admin','staff'].includes(e.sender_role)&&e.id>row.customer_last_read_entry_id).length;return{...row,last_message:last?.body,last_entry_id:last?.id||0,customer_unread:unread,can_reply:!row.customer_hidden,waiting_for:last?.sender_role==='customer'?'team':'customer',last_team_entry_id:all.filter(e=>e.sender_role!=='customer').at(-1)?.id||0};}
 function create(body='A question for the team.',source='contact'){const id=next++,e={id:entryId++,sender_role:'customer',sender_name:'Customer Fixture',body,created_at:new Date().toISOString()};const row={id,user_id:50,sender_name:'Customer Fixture',sender_email:'customer@example.test',message:body,source,status:'new',is_read:false,last_entry_at:e.created_at,created_at:e.created_at,customer_last_read_entry_id:e.id,team_last_read_entry_id:0,can_reply:true};rows.push(row);messages.set(id,[e]);return present(row);}
 function addReply(id,body='Hello! We can help you with this request. Please tell us the order reference.'){const row=rows.find(r=>r.id===id),e={id:entryId++,sender_role:'staff',sender_name:'FMRC Team',body,created_at:new Date().toISOString()};messages.get(id).push(e);row.last_entry_at=e.created_at;return e;}
 async function handle({req,route,json}){
  const query=new URL(req.url,'http://fixture').searchParams;
  const body=async()=>{let data='';for await(const chunk of req)data+=chunk;return data?JSON.parse(data):{};};
  if(route==='/api/user'){json({id:50,role:'customer',name:'Customer Fixture',email:'customer@example.test'});return true;}
  if(route==='/api/support/assistant'){json({data:pack});return true;}
  if(route==='/api/support/availability'){json({installed:true,available});return true;}
  if(route==='/api/admin/customer-support/presence'){if(req.method==='POST'){available=(await body()).available;writes.push({action:'presence',available});}json({available});return true;}
  if(route==='/api/admin/support/assistant'){
   if(req.method==='PUT'){const data=await body();writes.push({action:'settings',data});if(saveFails){json({message:'Save failed. Your draft is kept.'},503);return true;}pack={...structuredClone(data),installed:true,revision:'r'+Date.now()};pack.config.revision=pack.revision;}
   json({data:pack,defaults});return true;
  }
  if(route==='/api/customer/messages'&&req.method==='POST'){const data=await body();writes.push({action:'create',data});if(failSend){json({message:'Connection interrupted. Please retry.'},503);return true;}json({data:create(data.message,data.source),message:'Message sent.'},201);return true;}
  if(route==='/api/customer/messages/history'){
   const data=await body(),ids=data.ids,eligible=rows.filter(r=>ids.includes(r.id)&&r.status==='resolved'&&!r.customer_hidden);eligible.forEach(r=>r.customer_hidden=true);writes.push({action:'delete-history',ids});json({processed_ids:eligible.map(r=>r.id),skipped_ids:ids.filter(id=>!eligible.some(r=>r.id===id))});return true;
  }
  if(route==='/api/customer/messages') {
   const data=rows.filter(r=>!r.customer_hidden).map(present),page=Number(query.get('page')||1),perPage=15;
   json({data:data.slice((page-1)*perPage,page*perPage),meta:{page,last_page:Math.max(1,Math.ceil(data.length/perPage)),total:data.length},unread_count:data.reduce((n,r)=>n+r.customer_unread,0)});return true;
  }
  if(route==='/api/admin/customer-messages'){const filter=query.get('search')||'',status=query.get('status'),filtered=rows.filter(r=>(r.message+r.sender_name).toLowerCase().includes(filter.toLowerCase())&&(!status||status==='all'||status===r.status||status==='unread'&&!r.is_read)),per=Number(query.get('per_page')||10),page=Number(query.get('page')||1);json({data:filtered.slice((page-1)*per,page*per).map(present),eligible_ids:filtered.map(r=>r.id),meta:{page,last_page:Math.max(1,Math.ceil(filtered.length/per)),total:filtered.length},support_installed:true,summary:{total:rows.length,new:rows.filter(r=>r.status==='new').length,unread:rows.filter(r=>!r.is_read).length,resolved:rows.filter(r=>r.status==='resolved').length}});return true;}
  const match=route.match(/^\/api\/(customer|admin)\/messages\/(\d+)(?:\/(entries|read|end|reopen))?$/)||route.match(/^\/api\/(customer|admin)\/customer-messages\/(\d+)(?:\/(entries|conversation-read|read|resolve|reopen))?$/);
  if(match){const side=match[1],id=Number(match[2]),action=match[3],row=rows.find(r=>r.id===id);if(!row||(side==='customer'&&row.customer_hidden)){json({message:'Not found.'},404);return true;}
   if(action==='entries'&&req.method==='POST'){const data=await body();writes.push({action:'reply',side,id,data});if(failSend){json({message:'Send failed. Please retry.'},503);return true;}const e={id:entryId++,sender_role:side==='customer'?'customer':'staff',sender_name:side==='customer'?'Customer Fixture':'FMRC Team',body:data.body,created_at:new Date().toISOString()};messages.get(id).push(e);row.last_entry_at=e.created_at;json({entry:e,conversation:present(row)});return true;}
   if(action==='entries'){let data=messages.get(id);if(query.has('after'))data=data.filter(e=>e.id>Number(query.get('after')));if(query.has('before'))data=data.filter(e=>e.id<Number(query.get('before')));json({data,has_more:false,conversation:present(row)});return true;}
   if(action==='read'||action==='conversation-read'){const data=await body();if(side==='customer')row.customer_last_read_entry_id=data.through;else{row.team_last_read_entry_id=data.through||messages.get(id).at(-1).id;row.is_read=true;}json({data:present(row)});return true;}
   if(action==='end'||action==='reopen'||action==='resolve'){await body();row.status=action==='reopen'?'new':'resolved';row.closed_by_role=side==='customer'?'customer':'staff';if(action!=='resolve')messages.get(id).push({id:entryId++,event:action==='end'?'ended':'reopened',sender_role:'system',sender_name:'FMRC Support',body:action==='end'?'Chat ended by the customer.':'Chat reopened.',created_at:new Date().toISOString()});writes.push({action,id,side});json({data:present(row)});return true;}
   json({data:present(row)});return true;
  }
  return false;
 }
 return{handle,create,addReply,rows,messages,writes,get pack(){return pack},get available(){return available},set failSend(v){failSend=v},set saveFails(v){saveFails=v},set available(v){available=v}};
}
const setup=`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',JSON.stringify({id:50,role:'customer',name:'Customer Fixture',email:'customer@example.test'}));${fontSetup}`;
async function click(h,selector){await h.run(`document.querySelector(${JSON.stringify(selector)}).click()`);await h.pause(50);}
async function type(h,selector,value){await h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function size(h,width,height=900){await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await h.pause(80);}
async function shot(h,name){await h.run('document.fonts.ready');await h.pause(240);await h.shot(name);fs.mkdirSync(out,{recursive:true});fs.copyFileSync(path.join(h.artifacts,name+'.png'),path.join(out,name+'.png'));}
function contrast(a,b){const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
async function hover(h,selector){const point=await h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await h.pause(180);}
async function colors(h,selector){return h.run(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)})),c=document.createElement('canvas'),x=c.getContext('2d');c.width=c.height=1;const rgb=value=>{x.fillStyle=value;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)};return{background:rgb(s.backgroundColor),text:rgb(s.color)}})()`);}
async function hover(h,selector){const p=await h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await h.pause(180);}

test('Customer help, connected messaging, ending/reopening and single/bulk history controls',{skip:!chrome,timeout:120000},async t=>{
 const f=fixture();const h=await browserFixture(t,f.handle,{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 await size(h,1440);await h.go('/home-page/main.html');await h.until('window.FMRCSupport');await click(h,'.fmrc-support__launcher');await h.until(`document.querySelector('[data-support-topic="order-products"]')`);
 await shot(h,'customer-help-welcome-desktop');await size(h,390);await shot(h,'customer-help-welcome-mobile');await size(h,1440);
 assert(await h.run(`document.querySelector('.fmrc-support__avatar img').src.includes('FMRC%20Logo.png')`));
 await type(h,'#supportInput','hi');await h.run(`document.getElementById('supportComposer').requestSubmit()`);await h.until(`document.querySelector('#supportHelpLog article')`);
 assert.match(await h.run(`document.getElementById('supportHelpLog').textContent`),/Hello! Welcome to FMRC/);assert.doesNotMatch(await h.run(`document.getElementById('supportHelpLog').textContent`),/appointment|order reference|contact the FMRC team/i);assert.equal(await h.run(`document.querySelectorAll('#supportHelpLog ol').length`),0);await click(h,'[data-support-reset]');
 await type(h,'#supportInput','How to oder a prodcut');await h.run(`document.getElementById('supportComposer').requestSubmit()`);await h.until(`document.querySelector('#supportHelpLog ol')`);assert.match(await h.run(`document.getElementById('supportHelpLog').textContent`),/before payment/);
 assert.equal(f.writes.length,0,'automated help stays local');
 for(const width of [320,390,768,1024,1440]){await size(h,width);const geometry=await h.run(`(()=>{const p=document.getElementById('fmrcSupportPanel'),b=document.getElementById('supportBody'),r=p.getBoundingClientRect();return {fit:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight,overflow:b.scrollWidth>b.clientWidth+1,textarea:getComputedStyle(document.getElementById('supportInput')).fontFamily}})()`);assert(geometry.fit&&!geometry.overflow,JSON.stringify({width,geometry}));assert.match(geometry.textarea,/Montserrat/);}
 await size(h,390);await shot(h,'customer-help-mobile');await size(h,1440);await shot(h,'customer-help-desktop');
 await click(h,'[data-support-handoff]');await h.until(`document.getElementById('supportConsent')`);assert.equal(await h.run(`document.getElementById('supportInput').value`),'How to oder a prodcut');
 await h.run(`document.getElementById('supportConsent').checked=true`);await type(h,'#supportInput','A private question.\nSecond paragraph.');f.failSend=true;await h.run(`document.getElementById('supportComposer').requestSubmit()`);await h.until(`!document.getElementById('supportError').hidden`);assert.equal(await h.run(`document.getElementById('supportInput').value`),'A private question.\nSecond paragraph.');f.failSend=false;await h.run(`document.getElementById('supportComposer').requestSubmit()`);await h.until(`document.querySelector('[data-support-end]')`);assert.equal(f.rows.length,1);assert.equal(f.writes[0].data.request_key,f.writes[1].data.request_key,'retry keeps idempotency key');
 const reply=f.addReply(1,'Hello from FMRC. <img src=x onerror="window.unsafeSupport=true">\nA preserved paragraph.');reply.sender_name='Admin User';await h.until(`document.querySelector('[data-support-entry="${reply.id}"]')`);assert.equal(await h.run('window.unsafeSupport===true'),false);assert(await h.run(`document.querySelector('[data-support-entry="${reply.id}"] img').src.includes('FMRC%20Logo.png')`));assert.equal(await h.run(`document.querySelector('[data-support-entry="${reply.id}"] strong').textContent`),'FMRC Team');
 for(const width of [320,390,768,1024,1440]){await size(h,width);assert(await h.run(`(()=>{const b=document.getElementById('supportBody'),r=document.getElementById('fmrcSupportPanel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&b.scrollWidth<=b.clientWidth+1})()`),'Conversation fits at '+width);}
 await size(h,390);await shot(h,'customer-conversation-mobile');
 assert.equal(await h.run(`document.querySelector('.fmrc-support__toolbar strong').textContent`),'Conversation');
 await click(h,'[data-support-end]');await h.until(`document.querySelector('[role=alertdialog]')`);assert.equal(await h.run(`document.querySelectorAll('.fmrc-support__confirm button').length`),2);assert.equal(await h.run(`document.querySelector('.fmrc-support').hidden`),false,'Its own confirmation stays visible');
 const endBefore=await colors(h,'[data-support-confirm]');await hover(h,'[data-support-confirm]');const endHover=await colors(h,'[data-support-confirm]');assert.deepEqual(endHover.text,[255,255,255]);assert(endHover.background.reduce((a,b)=>a+b)<endBefore.background.reduce((a,b)=>a+b),'End chat has a darker hover');await shot(h,'customer-end-chat-hover-mobile');await click(h,'[data-support-cancel]');assert.equal(f.rows[0].status,'new');
 await click(h,'[data-support-end]');await click(h,'[data-support-confirm]');await h.until(`!document.getElementById('supportEnded').hidden`);assert.equal(f.rows[0].status,'resolved');assert(await h.run(`document.getElementById('supportComposer').hidden`));
 await click(h,'[data-support-reopen]');await h.until(`!document.getElementById('supportComposer').hidden`);assert.equal(f.rows[0].status,'new');
 await click(h,'[data-support-end]');await click(h,'[data-support-confirm]');await h.until(`!document.getElementById('supportEnded').hidden`);
 await click(h,'[data-support-delete]');await click(h,'[data-support-confirm]');await h.until(`document.querySelector('[data-support-new]')&&!document.querySelector('[data-support-conversation="1"]')`);assert(f.rows[0].customer_hidden);assert.equal(f.messages.get(1).length,5,'deleting customer history preserves records');
 const two=f.create('Second inquiry'),three=f.create('Third inquiry'),active=f.create('Active inquiry');f.rows.find(r=>r.id===two.id).status='resolved';f.rows.find(r=>r.id===three.id).status='resolved';await h.until(`document.querySelector('[data-support-conversation="${two.id}"]')`);
 assert(await h.run(`document.querySelector('[data-support-select="${active.id}"]').disabled`));await click(h,'[data-support-select-all]');await click(h,'[data-support-bulk]');await click(h,'[data-support-confirm]');await h.until(`!document.querySelector('[data-support-conversation="${two.id}"]')`);assert(!f.rows.find(r=>r.id===active.id).customer_hidden);
 await click(h,`[data-support-conversation="${active.id}"]`);await type(h,'#supportInput','Private unsent draft');await h.run(`localStorage.setItem('customer_token','another-account');localStorage.setItem('customer_info',JSON.stringify({id:99,name:'Other account',email:'other@example.test'}));dispatchEvent(new Event('storage'));`);assert.equal(await h.run(`document.getElementById('supportInput').value`),'');assert.equal(await h.run(`document.querySelector('#supportMessages')?.textContent||''`),'');
 assert.deepEqual(await h.run('fixtureErrors'),[]);
});

test('Quick help shows usable choices below an unmatched question',{skip:!chrome,timeout:45000},async t=>{
 const f=fixture();
 f.pack.config.suggestions=['track-order','book-consultation','order-products','custom-product'];
 f.pack.faqs.find(faq=>faq.key==='track-order').enabled=false;
 const h=await browserFixture(t,f.handle,{setup});
 await h.send('Network.setBlockedURLs',{urls:['https://*']});
 await size(h,390,844);
 const openHelp=async()=>{
  await h.go('/contact-page/contact.html');
  await h.until('window.FMRCSupport');
  await click(h,'.fmrc-support__launcher');
  await h.until(`!document.getElementById('supportComposer').hidden`);
 };
 const reply='#supportHelpLog > article:last-child';
 const suggestionKeys=()=>h.run(`Array.from(document.querySelectorAll('${reply} [data-support-topic]'),button=>button.dataset.supportTopic)`);
 const ask=async question=>{
  await type(h,'#supportInput',question);
  await h.run(`document.getElementById('supportComposer').requestSubmit()`);
 };
 await openHelp();
 await ask('KEKE');
 assert.equal(await h.run(`document.querySelector('${reply}').previousElementSibling.textContent`),'KEKE');
 assert.deepEqual(await suggestionKeys(),['book-consultation','order-products','custom-product'],'Unmatched input gets enabled, configured topics directly below the reply');
 await h.run(`const select=document.getElementById('supportLanguage');select.value='fil';select.dispatchEvent(new Event('change',{bubbles:true}));`);
 const orderTopic=reply+' [data-support-topic="order-products"]';
 assert.equal(await h.run(`document.querySelector('${orderTopic}').textContent.trim()`),f.pack.faqs.find(faq=>faq.key==='order-products').fil.question);
 await click(h,orderTopic);
 assert.equal(await h.run(`document.querySelector('${reply} ol').children.length`),7,'A topic opens its approved answer');
 await ask('payment');
 assert.deepEqual(await suggestionKeys(),['payment-approval','online-payment','cash-pickup'],'Related choices take priority over general topics');
 f.pack.config.suggestions=[];
 await openHelp();
 await ask('KEKE');
 assert.deepEqual(await suggestionKeys(),['order-products','appointment-types','book-consultation'],'Published topics are available even without configured welcome choices');
 f.pack.faqs=[];
 await openHelp();
 await ask('KEKE');
 assert.deepEqual(await suggestionKeys(),[]);
 assert.match(await h.run(`document.querySelector('${reply}').textContent`),/Piliin ang Message FMRC/);
 await click(h,'[data-support-handoff]');
 assert.equal(await h.run(`document.getElementById('supportInput').value`),'KEKE','The team handoff keeps the original question as a draft');
 assert.deepEqual(f.writes,[]);
 assert.deepEqual(await h.run('fixtureErrors'),[]);
});

test('Help keeps footer actions, reading position and focus in all four views',{skip:!chrome,timeout:90000},async t=>{
 const f=fixture();
 const open=f.create('Can you review a design file?', 'widget');
 const ended=f.create('Can I collect an order this Friday?', 'widget');
 for(let i=0;i<20;i++){
  f.addReply(open.id,'Design file information '+i+'. The team can review your notes and suggest options.');
  f.addReply(ended.id,'Pickup inquiry reply '+i+'. Here are the details for your order.');
  f.create('Past question '+i, 'widget');
 }
 f.rows.filter(r=>r.id!==open.id).forEach(r=>r.status='resolved');
 const h=await browserFixture(t,f.handle,{setup});
 await h.send('Network.setBlockedURLs',{urls:['https://*']});
 await size(h,390,790);await h.go('/home-page/main.html');await h.until('window.FMRCSupport');
 await click(h,'.fmrc-support__launcher');await h.until(`document.querySelector('[data-support-topic="order-products"]')`);
 const pinned=async selectors=>{
  const geometry=await h.run(`(()=>{
   const panel=document.getElementById('fmrcSupportPanel'),body=document.getElementById('supportBody'),footer=panel.querySelector('footer');
   const fixed=[panel.querySelector('header'),panel.querySelector('[role=tablist]'),footer];
   body.scrollTop=0;
   const top=fixed.map(node=>node.getBoundingClientRect().top);
   body.scrollTop=body.scrollHeight;
   const controls=${JSON.stringify(selectors)}.map(selector=>panel.querySelector(selector));
   return {scrolled:body.scrollTop>0,pinned:fixed.every((node,i)=>node.getBoundingClientRect().top===top[i]),inside:controls.every(node=>footer.contains(node)&&node.getClientRects().length&&!body.contains(node)),edge:Math.abs(footer.getBoundingClientRect().bottom-panel.getBoundingClientRect().bottom)<2,panelScroll:panel.scrollTop};
  })()`);
  assert.deepEqual(geometry,{scrolled:true,pinned:true,inside:true,edge:true,panelScroll:0},selectors.join(', '));
 };
 await click(h,'[data-support-topic="order-products"]');
 await pinned(['#supportComposer','[data-support-reset]','[data-support-handoff]']);
 await type(h,'#supportInput','A different question I am still writing.');
 await h.run(`const select=document.getElementById('supportLanguage');select.value='fil';select.dispatchEvent(new Event('change',{bubbles:true}));`);
 await click(h,'[data-support-tab=team]');await h.until(`document.querySelector('[data-support-conversation="${ended.id}"]')`);
 await pinned(['[data-support-bulk]','[data-support-page="-1"]','[data-support-page="1"]']);
 const firstCheck=`[data-support-select="${ended.id}"]`;
 await h.run(`document.querySelector(${JSON.stringify(firstCheck)}).focus();document.querySelector(${JSON.stringify(firstCheck)}).click()`);
 assert.equal(await h.run(`document.activeElement.matches(${JSON.stringify(firstCheck)})`),true);
 await h.run(`document.getElementById('supportBody').scrollTop=280;window.historyPosition=document.getElementById('supportBody').scrollTop;`);
 await click(h,'[data-support-bulk]');await h.until(`document.activeElement.hasAttribute('data-support-cancel')`);
 await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});
 await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
 const cancelled=await h.run(`({focused:document.activeElement.hasAttribute('data-support-bulk'),confirmation:!!document.querySelector('.fmrc-support__confirm'),scroll:document.getElementById('supportBody').scrollTop,expected:historyPosition})`);
 assert(cancelled.focused&&!cancelled.confirmation&&Math.abs(cancelled.scroll-cancelled.expected)<2,'Cancel restores the bulk action and reading position: '+JSON.stringify(cancelled));
 await h.run(`document.querySelector('[data-support-page="1"]').focus();document.querySelector('[data-support-page="1"]').click()`);
 await h.until(`document.querySelector('.fmrc-support__pager').textContent.includes('2/2')`);
 assert(await h.run(`document.activeElement.dataset.supportPage==='-1'&&document.querySelector('[data-support-bulk]').textContent.includes('(1)')`),'Page navigation keeps selection and focuses the remaining page button');
 await click(h,'[data-support-page="-1"]');await h.until(`document.querySelector('.fmrc-support__pager').textContent.includes('1/2')`);
 assert(await h.run(`document.querySelector(${JSON.stringify(firstCheck)}).checked&&Math.abs(document.getElementById('supportBody').scrollTop-historyPosition)<2`));
 await shot(h,'customer-help-history-mobile');
 await click(h,'[data-support-tab=help]');
 assert(await h.run(`document.getElementById('supportLanguage').value==='fil'&&document.getElementById('supportInput').value==='A different question I am still writing.'`));
 await click(h,'[data-support-tab=team]');
 const added=f.create('A more recent inquiry.');f.rows.unshift(f.rows.pop());
 await h.until(`document.querySelector('[data-support-conversation="${added.id}"]')`);
 assert(await h.run(`document.getElementById('supportBody').scrollTop>historyPosition`),'Polling keeps the visible history entries anchored when another entry arrives above them');

 await click(h,`[data-support-conversation="${open.id}"]`);
 await h.until(`document.querySelector('#supportMessages .fmrc-support__bubble--own')&&document.getElementById('supportComposer').offsetHeight>0`);
 await pinned(['#supportComposer']);
 const align=await h.run(`(()=>{
  const own=document.querySelector('#supportMessages .fmrc-support__bubble--own'),team=document.querySelector('#supportMessages .fmrc-support__bubble:not(.fmrc-support__bubble--own)');
  return {own:[own.querySelector('strong'),own.querySelector('p'),own.querySelector('time')].map(n=>getComputedStyle(n).textAlign),team:[team.querySelector('strong'),team.querySelector('p'),team.querySelector('time')].map(n=>getComputedStyle(n).textAlign),right:own.getBoundingClientRect().right>team.getBoundingClientRect().right,logo:team.querySelector('img').src.includes('FMRC%20Logo.png')};
 })()`);
 assert.deepEqual(align,{own:['right','right','right'],team:['left','left','left'],right:true,logo:true});
 await type(h,'#supportInput','Keep my private draft.');
 await h.run(`document.getElementById('supportInput').focus({preventScroll:true});document.getElementById('supportInput').setSelectionRange(2,8);document.getElementById('supportBody').scrollTop=120;`);
 const reply=f.addReply(open.id,'This arrives while the customer reads earlier messages.');
 await h.until(`document.querySelector('[data-support-entry="${reply.id}"]')`);
 assert(await h.run(`document.getElementById('supportBody').scrollTop===120&&document.activeElement.id==='supportInput'&&document.activeElement.selectionEnd===8&&document.activeElement.value==='Keep my private draft.'`));
 await h.run(`Object.defineProperties(visualViewport,{height:{value:340,configurable:true},offsetTop:{value:65,configurable:true}});visualViewport.dispatchEvent(new Event('resize'));`);
 await h.until(`document.querySelector('.fmrc-support--keyboard')`);
 assert(await h.run(`(()=>{const panel=document.getElementById('fmrcSupportPanel').getBoundingClientRect(),send=document.querySelector('#supportComposer button').getBoundingClientRect();return panel.top>=visualViewport.offsetTop&&send.bottom<=visualViewport.height+visualViewport.offsetTop&&document.getElementById('supportBody').clientHeight>100;})()`),'A panned phone keyboard leaves the send button and reading space visible');
 await h.run(`delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));`);
 await size(h,1440);await click(h,'[data-support-latest]');
 await h.run(`(()=>{const body=document.getElementById('supportBody'),first=body.querySelector('[data-support-entry]');body.scrollTop+=first.getBoundingClientRect().top-body.getBoundingClientRect().top-14;document.activeElement.blur();})()`);
 await shot(h,'customer-help-transcript-desktop');
 await click(h,'[data-support-history]');await click(h,`[data-support-conversation="${ended.id}"]`);await h.until(`document.querySelector('[data-support-reopen]')`);
 await size(h,390,790);await pinned(['[data-support-reopen]','[data-support-delete="'+ended.id+'"]']);
 await h.run(`document.activeElement.blur()`);await shot(h,'customer-help-ended-mobile');
 assert.deepEqual(await h.run('fixtureErrors'),[]);
});

for(const role of ['admin','staff'])test(role+' support inbox replies, availability, responsive layout and Admin-only settings',{skip:!chrome,timeout:120000},async t=>{
 const f=fixture();f.create('Please help with my order.\nHere is my question.');const h=await browserFixture(t,f.handle,{setup:fontSetup});await h.send('Network.setBlockedURLs',{urls:['https://*']});await size(h,1440);await h.go('/'+role+'-page/customer-inquiries.html');await h.until(`document.querySelector('[data-action=view]')&&window.FMRCInquirySupport`);await click(h,'[data-action=view]');await h.until(`document.querySelector('#supportThreadLog [data-support-entry]')`);
 assert(await h.run(`document.body.style.position==='fixed'`));
 f.failSend=true;await type(h,'#supportTeamReply','Hello! We can help with that.');await h.run(`document.querySelector('.support-reply-form').requestSubmit()`);await h.until(`!document.getElementById('supportTeamError').hidden`);assert.equal(await h.run(`document.getElementById('supportTeamReply').value`),'Hello! We can help with that.');f.failSend=false;await h.run(`document.querySelector('.support-reply-form').requestSubmit()`);await h.until(`document.querySelectorAll('#supportThreadLog [data-support-entry]').length===2`);assert.equal(await h.run(`document.getElementById('supportTeamReply').value`),'');
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){await size(h,width);await h.run(`document.documentElement.dataset.theme='${theme}'`);assert(await h.run(`(()=>{const c=document.querySelector('#inquiryDetailModal .portal-detail-dialog__card'),b=document.querySelector('#inquiryDetailModal .portal-detail-dialog__body'),f=c.querySelector('footer').getBoundingClientRect(),r=c.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&f.bottom<=innerHeight+1&&b.scrollWidth<=b.clientWidth+1})()`),role+' '+theme+' '+width);}
 const closeBefore=await colors(h,'#inquiryDetailModal [data-modal-close]');await hover(h,'#inquiryDetailModal [data-modal-close]');const closeHover=await colors(h,'#inquiryDetailModal [data-modal-close]');assert.notDeepEqual(closeHover.background,closeBefore.background,'Close has a visible hover');assert(contrast(closeHover.background,closeHover.text)>=4.5,'Close remains readable: '+JSON.stringify(closeHover));
 await size(h,390);await h.run(`document.documentElement.dataset.theme='light'`);await shot(h,role+'-support-mobile');await size(h,1440);await shot(h,role+'-support-desktop');await click(h,'#inquiryDetailModal [data-modal-close]');await h.until(`!document.getElementById('inquiryDetailModal').classList.contains('show')`);
 for(const width of [320,390,768,1024,1440]){await size(h,width);assert(await h.run(`(()=>{const header=document.querySelector('.page-toolbar'),card=document.querySelector('.support-control-card'),refresh=document.getElementById('inquiriesRefreshBtn'),r=refresh.getBoundingClientRect(),h=header.getBoundingClientRect(),c=card.getBoundingClientRect();const right=h.right-parseFloat(getComputedStyle(header).paddingRight);return c.top>=h.bottom&&Math.abs(r.right-right)<2&&c.right<=innerWidth&&card.scrollWidth<=card.clientWidth+1&&document.getElementById('supportAvailability').closest('.support-control-card')===card})()`),'Refresh and support card fit at '+width);}
 await size(h,1440);assert(await h.run(`(()=>{const header=document.querySelector('.support-control-header').getBoundingClientRect(),settings=document.getElementById('supportSettingsOpen')?.getBoundingClientRect(),label=document.querySelector('.support-availability').getBoundingClientRect(),note=document.getElementById('supportAvailabilityNote').getBoundingClientRect();return (!settings||Math.abs(settings.right-header.right)<2)&&Math.abs(label.top+label.height/2-note.top-note.height/2)<2})()`),'Support controls align into separate header and availability rows');await shot(h,role+'-inquiry-toolbar-desktop');await size(h,390);await shot(h,role+'-inquiry-toolbar-mobile');await size(h,1440);await click(h,'#supportAvailability');await h.until(`document.getElementById('supportAvailability').checked`);assert(f.available);
 const presenceBefore=f.writes.filter(w=>w.action==='presence').length;
 await h.run(`window.supportRealNow=Date.now;Date.now=()=>window.supportRealNow()+21000;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));`);await h.pause(150);
 assert(f.available,'Switching tabs keeps an opted-in, connected operator available');assert(f.writes.filter(w=>w.action==='presence').length>presenceBefore,'Background heartbeat renews presence without a session activity request');
 await h.run(`Date.now=window.supportRealNow;delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));`);
 if(role==='staff'){assert.equal(await h.run(`!!document.getElementById('supportSettingsOpen')`),false);return;}
 await click(h,'#supportSettingsOpen');await h.until(`!document.getElementById('supportSettingsEditor').hidden`);assert(await h.run(`document.getElementById('supportSettingsSave').disabled`));
 for(const width of [320,390,768,1024,1440]){await size(h,width);assert(await h.run(`(()=>{const upload=document.querySelector('.support-avatar-upload'),r=upload.getBoundingClientRect(),defaults=document.getElementById('supportSettingsDefaults').getBoundingClientRect(),footer=document.querySelector('#supportSettingsModal footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&upload.scrollWidth<=upload.clientWidth+1&&defaults.left<footer.left+45&&document.getElementById('supportAvatar').hidden&&document.querySelector('[data-avatar-choose]').getBoundingClientRect().height>=44})()`),'Upload and footer fit at '+width);}
 const {root:uploadDoc}=await h.send('DOM.getDocument'),{nodeId:uploadNode}=await h.send('DOM.querySelector',{nodeId:uploadDoc.nodeId,selector:'#supportAvatar'});await h.send('DOM.setFileInputFiles',{nodeId:uploadNode,files:[path.join(root,'images/FMRC Logo.png')]});await h.until(`document.querySelector('[data-avatar-preview]').src.startsWith('data:image/')&&!document.getElementById('supportSettingsSave').disabled`);assert.match(await h.run(`document.querySelector('[data-avatar-filename]').textContent`),/FMRC Logo\.png/);await click(h,'[data-avatar-default]');assert(await h.run(`document.getElementById('supportSettingsSave').disabled`),'Default logo restores the unchanged draft');
 await h.run(`document.querySelector('.support-avatar-upload').scrollIntoView({block:'center',behavior:'instant'})`);await shot(h,'admin-support-image-upload-desktop');await size(h,390);await h.run(`document.querySelector('.support-avatar-upload').scrollIntoView({block:'center',behavior:'instant'})`);await shot(h,'admin-support-image-upload-mobile');
 assert.equal(await h.run(`document.querySelectorAll('#supportSettingsModal select[multiple]').length`),0,'No Shift/Ctrl multi-select fields');
 assert.equal(await h.run(`document.querySelectorAll('[data-choice-path="config.suggestions"] input:checked').length`),6);
 await click(h,'[data-choice-path="config.suggestions"] .support-choice-option input:checked');assert.equal(await h.run(`document.querySelectorAll('[data-choice-path="config.suggestions"] input:checked').length`),5);
 await click(h,'[data-choice-path="config.suggestions"] .support-choice-option input:not(:checked)');assert.equal(await h.run(`document.querySelectorAll('[data-choice-path="config.suggestions"] input:checked').length`),6);
 assert(await h.run(`[...document.querySelectorAll('[data-choice-path="config.suggestions"] .support-choice-option input:not(:checked)')].every(n=>n.disabled)`));
 await type(h,'#supportField-config-name','FMRC Customer Care');assert.equal(await h.run(`document.getElementById('supportSettingsSave').disabled`),false);
 f.saveFails=true;await click(h,'#supportSettingsSave');await h.until(`!document.getElementById('supportSettingsError').hidden`);assert.equal(await h.run(`document.getElementById('supportField-config-name').value`),'FMRC Customer Care');f.saveFails=false;await click(h,'#supportSettingsSave');await h.until(`document.getElementById('supportSettingsSave').disabled&&!document.getElementById('supportSettingsModal').hasAttribute('data-saving')`);assert.equal(f.pack.config.name,'FMRC Customer Care');
 await h.run(`document.querySelector('.admin-success-notification__close')?.click()`);await h.pause(250);
 await click(h,'[data-settings-tab=answers]');await h.until(`document.getElementById('supportAnswerSelect')`);await click(h,'[data-choice-path="faq.actions"] .support-choice-option input:not(:checked)');assert.equal(await h.run(`document.querySelectorAll('[data-choice-path="faq.actions"] input:checked').length`),3);assert(await h.run(`[...document.querySelectorAll('[data-choice-path="faq.actions"] input:not(:checked)')].every(n=>n.disabled)`));await type(h,'#supportField-faq-en-answer','A revised approved answer.');await click(h,'[data-settings-tab=preview]');assert.match(await h.run(`document.querySelector('.support-settings-preview').textContent`),/A revised approved answer/);
 await click(h,'[data-settings-tab=answers]');await h.run(`document.querySelector('[data-choice-path="faq.actions"]').scrollIntoView({block:'center',behavior:'instant'})`);await size(h,1440);await shot(h,'admin-support-destination-checkboxes-desktop');
 for(const width of [320,390]){await size(h,width);assert(await h.run(`(()=>{const group=document.querySelector('[data-choice-path="faq.actions"]'),r=group.getBoundingClientRect(),b=document.querySelector('#supportSettingsModal .portal-detail-dialog__body');return r.left>=0&&r.right<=innerWidth+1&&b.scrollWidth<=b.clientWidth+1&&[...group.querySelectorAll('.support-choice-option')].every(n=>n.getBoundingClientRect().height>=44)})()`),'Checkbox fields fit at '+width);}
 await h.run(`document.querySelector('[data-choice-path="faq.actions"]').scrollIntoView({block:'center',behavior:'instant'})`);await shot(h,'admin-support-destination-checkboxes-mobile');
 await click(h,'[data-settings-tab=appearance]');await size(h,1440);await shot(h,'admin-support-appearance-desktop');await size(h,390);await shot(h,'admin-support-appearance-mobile');await click(h,'[data-settings-tab=answers]');await size(h,1440);await shot(h,'admin-support-answers-desktop');await click(h,'[data-settings-tab=preview]');
 await size(h,390);await shot(h,'admin-support-settings-mobile');await size(h,1440);await shot(h,'admin-support-settings-desktop');
 await click(h,'#supportSettingsCancel');await h.until(`document.querySelector('.admin-system-popup.show')`);assert(await h.run(`document.getElementById('supportSettingsModal').classList.contains('show')`));
 assert.deepEqual(await h.run('fixtureErrors'),[]);
});

test('FMRC Help loads on five Customer pages, connects Contact, and hides during booking',{skip:!chrome,timeout:120000},async t=>{
 const f=fixture(),h=await browserFixture(t,f.handle,{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});await size(h,1440);
 const publicPages = ['/home-page/', '/about-page/about', '/services-page/service', '/products-page/product', '/contact-page/contact'];
 const pagesWithoutChat = [
  '/customer-auth/auth#login',
  '/products-page/transaction-terms?version=fixture-version',
  '/products-page/refund-policy?version=fixture-version',
  '/customer-auth/auth#signup',
 ];
 for (const prefix of ['', '/apps/customer']) {
  for (const route of publicPages) {
   await h.go(prefix + route);
   await h.until('window.FMRCSupport');
   assert.equal(await h.run(`document.querySelectorAll('.fmrc-support').length`), 1, prefix + route);
   await click(h, '.fmrc-support__launcher');
   await h.until(`document.querySelector('[data-support-topic]')`);
   await click(h, '[data-support-close]');
  }
  for (const route of pagesWithoutChat) {
   await h.go(prefix + route);
   assert(await h.run(`!window.FMRCSupport && !document.querySelector('.fmrc-support, link[href*="customer-support.css"], script[src*="customer-support.js"], script[src*="support-assistant.js"]')`), prefix + route);
   if (route.startsWith('/customer-auth/')) {
    assert(await h.run(`typeof window.FMRC_TURNSTILE?.requireToken === 'function'`), 'The sign-in security check still loads');
   }
  }
 }
 await h.go('/contact-page/contact.html');await h.until(`document.getElementById('contactMessageForm')&&window.FMRCSupport`);
 await type(h,'#contactName','Customer Fixture');await type(h,'#contactEmail','customer@example.test');await type(h,'#contactMessage','Contact inquiry connected to chat.');await h.run(`document.getElementById('contactConsent').checked=true;document.getElementById('contactMessageForm').requestSubmit()`);await h.until(`document.getElementById('customerSystemPopup').classList.contains('show')`);await click(h,'#customerSystemPopupOk');await h.until(`document.getElementById('customerSystemPopupTitle').textContent==='Message Sent'`);await click(h,'#customerSystemPopupOk');await h.until(`document.querySelector('#supportMessages [data-support-entry]')`);assert.equal(f.rows.length,1);assert.equal(f.rows[0].source,'contact');assert.match(await h.run(`document.getElementById('supportMessages').textContent`),/Contact inquiry connected to chat/);
 await h.go('/home-page/main.html');await h.until(`window.FMRCSupport&&document.getElementById('appointmentFlow')`);
 await h.run(`document.getElementById('appointmentFlow').classList.add('show-modal');document.body.style.overflow='hidden';document.getElementById('aptFName').value='Preserved';`);
 for(let step=1;step<=5;step++){
  await h.run(`document.querySelectorAll('#appointmentFlow .apt-content-section').forEach(n=>n.classList.remove('active'));document.getElementById('aptStep${step}')?.classList.add('active');`);
  await h.until(`document.querySelector('.fmrc-support').hidden`);
  assert(await h.run(`document.querySelector('.fmrc-support').getClientRects().length===0`),'Support is hidden during booking step '+step);
  await h.run(`void FMRCSupport.open()`);assert(await h.run(`document.querySelector('.fmrc-support').hidden`),'Programmatic open cannot bypass a booking dialog');assert.equal(await h.run(`document.getElementById('aptFName').value`),'Preserved');
 }
 await h.run(`document.getElementById('appointmentFlow').classList.remove('show-modal');document.body.style.overflow='';localStorage.removeItem('customer_token');localStorage.removeItem('customer_info');dispatchEvent(new Event('storage'));`);
 await h.until(`!document.querySelector('.fmrc-support').hidden`);await click(h,'.fmrc-support__launcher');await click(h,'[data-support-tab=team]');assert.match(await h.run(`document.getElementById('supportBody').textContent`),/Sign in/);assert(await h.run(`document.getElementById('supportComposer').hidden`));
 await click(h,'[data-support-tab=help]');await size(h,640,450);await h.run(`const s=document.createElement('style');s.textContent='.fmrc-support *{letter-spacing:.12em!important;word-spacing:.16em!important;line-height:1.8!important}';document.head.append(s);`);
 assert(await h.run(`(()=>{const p=document.getElementById('fmrcSupportPanel'),r=p.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight+1&&r.right<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1})()`),'200% equivalent with adjusted text spacing');
 await size(h,844,390);assert(await h.run(`(()=>{const p=document.getElementById('fmrcSupportPanel'),r=p.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()`),'Short landscape');
 assert.deepEqual(await h.run('fixtureErrors'),[]);
});

test('circular launcher follows Back to top; other dialogs hide chat without losing a draft',{skip:!chrome,timeout:90000},async t=>{
 const f=fixture(),h=await browserFixture(t,f.handle,{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});await size(h,1440);await h.go('/home-page/main.html');await h.until(`window.FMRCSupport&&document.getElementById('customerBackToTop')`);
 await h.run(`document.activeElement.blur()`);await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await h.pause(180);
 assert(await h.run(`(()=>{const r=document.querySelector('.fmrc-support__launcher').getBoundingClientRect();return Math.abs(r.width-r.height)<1&&r.height>=44})()`),'Launcher starts as a circle');
 await shot(h,'customer-launcher-circle-desktop');await hover(h,'.fmrc-support__launcher');assert(await h.run(`document.querySelector('.fmrc-support__launcher').offsetWidth>100`),'Hover reveals its label');await shot(h,'customer-launcher-expanded-desktop');
 await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await h.run(`window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);await h.until(`document.getElementById('customerBackToTop').classList.contains('is-visible')`);await h.pause(200);
 assert(await h.run(`(()=>{const a=document.getElementById('customerBackToTop').getBoundingClientRect(),b=document.querySelector('.fmrc-support__launcher').getBoundingClientRect();return Math.abs(a.left+a.width/2-b.left-b.width/2)<1&&a.top-b.bottom>=11})()`),'Launcher shares the arrow column with a clear gap');await shot(h,'customer-launcher-above-arrow-desktop');
 await click(h,'.fmrc-support__launcher');await h.until(`document.querySelector('[data-support-topic]')`);await type(h,'#supportInput','Keep this unsent question.');
 for(const modal of ['#customerProfileModal','#customerOrdersModal','#customerAppointmentsModal','#announcementModal']){
  const action={'#customerProfileModal':'viewProfileBtn','#customerOrdersModal':'viewOrdersBtn','#customerAppointmentsModal':'viewAppointmentsBtn','#announcementModal':'announcementBell'}[modal];
  await h.run(`document.getElementById(${JSON.stringify(action)}).click()`);await h.until(`document.querySelector('.fmrc-support').hidden`);assert(await h.run(`document.querySelector('.fmrc-support').getClientRects().length===0`),modal+' fully hides support');
  await h.run(`(()=>{const modal=document.querySelector(${JSON.stringify(modal)});modal.querySelector('.ux-dlg__close,.fmrc-announcement__close,[data-appointments-close]').click()})()`);await h.until(`!document.querySelector('.fmrc-support').hidden`);
  assert.equal(await h.run(`document.getElementById('supportInput').value`),'Keep this unsent question.');
 }
 await h.run(`const a=document.createElement('div');a.id='supportExternalOverlay';a.className='shop-modal-overlay';a.style.cssText='display:flex;position:fixed;inset:0;z-index:25000';document.body.append(a);const b=document.createElement('dialog');b.id='supportExternalDialog';b.innerHTML='<button>Close</button>';document.body.append(b);b.showModal();`);await h.until(`document.querySelector('.fmrc-support').hidden`);
 await h.run(`document.getElementById('supportExternalOverlay').remove()`);await h.pause(80);assert(await h.run(`document.querySelector('.fmrc-support').hidden`),'A nested native dialog keeps support hidden');
 await h.run(`document.getElementById('supportExternalDialog').close();document.getElementById('supportExternalDialog').remove()`);await h.until(`!document.querySelector('.fmrc-support').hidden`);assert.equal(await h.run(`document.getElementById('supportInput').value`),'Keep this unsent question.');
 await h.run(`{const a=document.createElement('div');a.id='supportHiddenPopup';a.className='status-modal';a.hidden=true;a.style.cssText='display:flex;visibility:visible;opacity:1;position:fixed;inset:0';document.body.append(a)}`);await h.pause(80);assert.equal(await h.run(`document.querySelector('.fmrc-support').hidden`),false,'Hidden popup markup does not hide support');
 await h.run(`document.getElementById('supportHiddenPopup').hidden=false`);await h.until(`document.querySelector('.fmrc-support').hidden`);await h.run(`document.getElementById('supportHiddenPopup').remove()`);await h.until(`!document.querySelector('.fmrc-support').hidden`);
 await size(h,390);await shot(h,'customer-chat-header-mobile');await size(h,1440);await shot(h,'customer-chat-header-desktop');
 await h.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await h.run(`getComputedStyle(document.querySelector('.fmrc-support')).transitionDuration`),'0s','Reduced motion also applies to launcher repositioning');
 assert.deepEqual(await h.run('fixtureErrors'),[]);assert.equal(f.writes.length,0,'Visibility changes never send messages');
});

test('paused automated help and an offline team remain separate, usable Customer states',{skip:!chrome,timeout:60000},async t=>{
 const f=fixture();f.pack.config.enabled=false;f.pack.config.suggestions=['custom-product'];
 const h=await browserFixture(t,f.handle,{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});await size(h,1440);await h.go('/contact-page/contact.html');await h.until('window.FMRCSupport');await click(h,'.fmrc-support__launcher');await h.until(`document.querySelector('.fmrc-support__state-card')`);
 assert.match(await h.run(`document.getElementById('supportBody').textContent`),/Quick help is paused/);assert.doesNotMatch(await h.run(`document.getElementById('supportBody').textContent`),/Live messaging is not available/);assert(await h.run(`document.getElementById('supportComposer').hidden`));await shot(h,'customer-help-paused-desktop');
 await click(h,'[data-support-tab=team]');await h.until(`document.querySelector('[data-support-new]')`);assert.match(await h.run(`document.getElementById('supportBody').textContent`),/messages are open/);
 await size(h,390);await shot(h,'customer-support-away-mobile');await click(h,'[data-support-new]');await h.until(`!document.getElementById('supportComposer').hidden`);await type(h,'#supportInput','A message while the team is away.');await h.run(`document.getElementById('supportConsent').checked=true;document.getElementById('supportComposer').requestSubmit()`);await h.until(`document.querySelector('#supportMessages [data-support-entry]')`);assert.equal(f.rows.length,1,'Offline availability does not prevent messages');
 assert.deepEqual(await h.run('fixtureErrors'),[]);
});
