const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('Policy and shipping publication actions align, and payment switches keep keyboard-only focus rings',{skip:!chrome,timeout:120000},async t=>{
 const settings={payment_cash_on_pickup_enabled:'1',payment_gcash_enabled:'1',payment_checkout_method:'qrph',payment_gcash_ready:'1'};
 const policy={title:'Published policy',terms_text:'Sample transaction terms for reviewing the existing presentation.',refund_text:'Sample refund wording for reviewing the existing presentation.'};
 const shipping={enabled:true,nonworking_weekdays:[7],nonworking_dates:[],zones:[{id:'10000000-0000-4000-8000-000000000001',name:'Province coverage',province:'Camarines Norte',cities:[],postal_codes:[],fee:75,preparation_days:2,transit_min_days:1,transit_max_days:3}]};
 const writes=[];
 const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,({req,route,json})=>{
  if(route==='/api/site-settings'){json({data:settings});return true;}
  if(route==='/api/admin/commerce-policy'){json({data:{can_edit:true,revision:1,published:{...policy,version:'sample'},draft:{...policy,title:'Draft policy'},has_saved_draft:true}});return true;}
  if(route==='/api/admin/shipping-settings'){json({data:{can_edit:true,revision:1,published:shipping,draft:{...shipping,zones:shipping.zones.map(z=>({...z,fee:90}))},has_saved_draft:true}});return true;}
  if(route==='/api/psgc/provinces'){json([{code:'0501600000',name:'Camarines Norte'}]);return true;}
  if(route==='/api/psgc/provinces/0501600000/cities-municipalities'){json([{code:'0501603000',name:'Daet'},{code:'0501606000',name:'Labo'}]);return true;}
  if(req.method!=='GET'&&route!=='/api/admin/session/activity')writes.push(route);
  return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const size=async(width,height=950)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await h.pause(150);await h.run(`if(innerWidth<600&&document.body.classList.contains('admin-sidebar-open'))document.querySelector('.admin-sidebar-toggle').click()`);};
 const shot=async name=>{await h.run('document.fonts.ready');await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(name);};
 for(const page of ['policies','shipping']){
  await size(1440);await h.go('/admin-page/website-'+page+'.html');await h.until(page==='policies'?`!document.getElementById('policyEditorFields').disabled&&!document.querySelector('.website-section-loading')`:`document.getElementById('shipping-0-cities-search')&&!document.getElementById('shippingFields').disabled&&!document.getElementById('shippingProvinceStatus').textContent&&!document.querySelector('.website-section-loading')`);
  const prefix=page==='policies'?'policy':'shipping';
  for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
   await size(width);await h.run(`document.documentElement.dataset.theme='${theme}'`);
   assert(await h.run(`(()=>{const p='${prefix}',root=document.querySelector('.'+p+'-publish-controls'),action=document.querySelector('.'+p+'-publish-action'),button=document.getElementById(p+'Publish'),hint=document.getElementById(p+'PublishHint'),label=root.querySelector('label'),r=root.getBoundingClientRect(),a=action.getBoundingClientRect(),b=button.getBoundingClientRect(),c=hint.getBoundingClientRect(),l=label.getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+1&&Math.abs(b.right-r.right)<1&&Math.abs(c.right-r.right)<1&&c.top>=b.bottom+7&&b.height>=44&&(innerWidth<=720||Math.abs(l.top-b.top)<1)})()`),'Publish action, approval and hint align '+page+' '+width+' '+theme);
   if(page==='policies'&&width===1440)assert(await h.run(`(()=>{const root=document.querySelector('.policy-published-overview').getBoundingClientRect(),p=document.getElementById('policyPublishedMessage').getBoundingClientRect(),links=document.querySelector('.policy-customer-links').getBoundingClientRect();return Math.abs(root.right-links.right)<1&&Math.abs(p.top+p.height/2-links.top-links.height/2)<1})()`),'Published document links align with the subtitle');
   if([390,1440].includes(width)){
    await h.run(`document.querySelector('.${prefix}-publish-controls').scrollIntoView({block:'center',behavior:'instant'})`);await shot(page+'-publish-'+width+'-'+theme);
    if(page==='policies'){await h.run(`scrollTo({top:0,behavior:'instant'})`);await shot('policy-links-'+width+'-'+theme);}
   }
  }
  const checkbox=page==='policies'?'policyApproval':'shippingApproved';await h.run(`document.getElementById('${checkbox}').click()`);assert.equal(await h.run(`document.getElementById('${prefix}Publish').disabled`),false,'Reviewed drafts remain publishable after explicit approval');
 }
 await size(1440);await h.go('/admin-page/website-payments.html');await h.until(`!document.getElementById('paymentSettingsFields').disabled&&!document.querySelector('.website-section-loading')`);
 const pointerClick=async id=>{
  const point=await h.run(`(()=>{const n=document.getElementById('${id}');n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await h.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await h.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
 };
 for(const theme of ['light','dark']){
  await h.run(`document.documentElement.dataset.theme='${theme}'`);
  for(const id of ['payment_cash_on_pickup_enabled','payment_gcash_enabled']){
   await pointerClick(id);
   assert(await h.run(`(()=>{const n=document.getElementById('${id}'),s=getComputedStyle(n),r=getComputedStyle(n.closest('.payment-method-row'));return n===document.activeElement&&!n.matches(':focus-visible')&&s.outlineStyle==='none'&&s.boxShadow==='none'&&s.borderTopColor==='rgba(0, 0, 0, 0)'&&r.outlineStyle==='none'})()`),'Pointer toggles have no persistent red outline '+id+' '+theme);
   await pointerClick(id);
  }
  await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab'});await h.run(`document.getElementById('payment_gcash_enabled').focus()`);
  assert(await h.run(`(()=>{const n=document.getElementById('payment_gcash_enabled'),s=getComputedStyle(n);return n.matches(':focus-visible')&&s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0})()`),'Keyboard focus remains visible '+theme);
  await pointerClick('payment_gcash_enabled');await pointerClick('payment_gcash_enabled');await h.run(`scrollTo({top:0,behavior:'instant'})`);await shot('payment-switch-pointer-'+theme);
 }
 assert.equal(await h.run(`document.getElementById('savePaymentSettings').disabled`),true,'Repeated toggles restore the unchanged draft');assert.equal(writes.length,0,'Layout and focus checks never publish settings');assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});
