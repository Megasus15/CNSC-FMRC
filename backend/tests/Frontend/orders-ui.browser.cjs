const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const row=id=>({id,order_no:'ORD-'+id,customer_name:id===2?'Unique incoming client':'Sample Customer',product_name:'Engraved bamboo tumbler',quantity:1,total_amount:100,total_label:'₱100.00',payment_method:'COP',payment_method_label:'Cash on pickup',payment_status:'pending',lifecycle_status:'incoming',items:[{product_name:'Engraved bamboo tumbler',quantity:1,unit_price:100}],approval:{allowed:true},is_pickup:true});
for(const role of ['admin','staff'])test(role+' Orders refined dialogs, searches and decided cancellation totals',{skip:!chrome,timeout:150000},async t=>{
 const orders=[{...row(1),payment_method:'GCash',payment_is_automated:true},row(2)],cancelled={...row(3),lifecycle_status:'cancelled',cancel_state:'approved',cancel_pending:false,cancel_reason:'Changed requirements'};
 const font=process.env.FMRC_BROWSER_POPPINS;
 const setup=font?`{const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${font?fs.readFileSync(font).toString('base64'):''}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);}`:'';
 const h=await browserFixture(t,async({route,json})=>{
  if(route==='/api/admin/orders'){json({review:[],incoming:orders,directory:[cancelled],returns:[],payments:[]});return true;}
  if(route==='/api/admin/gateway-payments'){json({can_approve:role==='admin',payments:{data:[],current_page:1,last_page:1,total:0},refunds:[],receipts:[]});return true;}
  if(route==='/api/admin/orders/1'){json({data:orders[0]});return true;}
  if(route==='/api/admin/orders/1/gateway-payment'){json({can_approve:role==='admin',payments:{data:[{id:1,order_id:1,order_no:'ORD-1',amount:100,status:'pending',refund_action:{allowed:false}}]},receipts:[],refunds:[],attempts:[]});return true;}
  return false;
 },{setup});
 const shot=async name=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(name);};
 await h.send('Network.setBlockedURLs',{urls:['https://*']});
 await h.go('/'+role+'-page/orders.html');await h.until(`document.querySelector('[data-order-view="1"]')&&document.querySelector('#modalOrderDetails .portal-detail-dialog__close')`);
 await h.run(`{const d=document.createElement('dialog');d.id='lateFixtureDialog';document.body.append(d);}`);await h.pause(80);
 assert.equal(await h.run(`document.querySelectorAll('#modalOrderDetails .portal-detail-dialog__close').length`),1,'Late overlays do not register duplicate headers or handlers');
 await h.run(`document.getElementById('lateFixtureDialog').remove()`);
 assert.equal(await h.run(`document.querySelector('[data-tab=cancellations] .tab-count').textContent`),'1','Decided records count even with no pending requests');
 await h.run(`document.querySelector('[data-tab=cancellations]').click()`);await h.until(`document.querySelector('#orderCancellationsTable tbody').textContent.includes('ORD-3')`);
 await h.run(`(()=>{document.querySelector('[data-tab=orders]').click();let i=document.getElementById('incomingOrdersSearch');i.value='Unique';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert.equal(await h.run(`document.querySelectorAll('#incomingOrdersTable tbody [data-order-view]').length`),1);
 assert.match(await h.run(`document.querySelector('#incomingOrdersTable tbody').textContent`),/Unique incoming/);
 await h.run(`(()=>{let i=document.getElementById('incomingOrdersSearch');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-order-view="1"]').click()})()`);
 await h.until(`document.getElementById('modalOrderDetails').classList.contains('show')`);
 assert.equal(await h.run(`document.querySelector('#modalOrderDetails [data-modal-close]').disabled`),false,'Close remains available on read-only order details');
 for(const width of [320,390,768,1024,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
  for(const theme of ['light','dark']){
   await h.run(`document.documentElement.dataset.theme='${theme}'`);
   const g=await h.run(`(()=>{let r=document.getElementById('modalOrderDetails'),c=r.querySelector('.portal-detail-dialog__card').getBoundingClientRect(),b=r.querySelector('.portal-detail-dialog__body'),f=r.querySelector('.portal-detail-dialog__footer').getBoundingClientRect();return {fits:c.left>=0&&c.right<=innerWidth+1&&c.top>=0&&f.bottom<=innerHeight+1,overflow:b.scrollWidth>b.clientWidth+1,locked:getComputedStyle(document.body).position==='fixed',x:r.querySelectorAll('.portal-detail-dialog__close').length}})()`);
   assert(g.fits&&!g.overflow&&g.locked&&g.x===1,JSON.stringify({width,theme,g}));
   if(width===1440)assert.equal(await h.run(`Math.round(document.querySelector('#modalOrderDetails .portal-detail-dialog__card').getBoundingClientRect().width)`),1040,'Complex order details have more room');
   if([390,1440].includes(width))await shot(role+'-orders-details-'+width+'-'+theme);
  }
 }
 await h.send('Emulation.setDeviceMetricsOverride',{width:740,height:360,deviceScaleFactor:1,mobile:false});
 assert(await h.run(`document.querySelector('#modalOrderDetails .portal-detail-dialog__footer').getBoundingClientRect().bottom<=innerHeight`),'Footer stays available in short landscape');
 await h.send('Emulation.setDeviceMetricsOverride',{width:720,height:450,deviceScaleFactor:1,mobile:false});
 await h.run(`document.getElementById('modalOrderDetails').style.letterSpacing='0.12em'`);
 assert(await h.run(`document.querySelector('#modalOrderDetails .portal-detail-dialog__body').scrollWidth<=document.querySelector('#modalOrderDetails .portal-detail-dialog__body').clientWidth+1`),'Zoom-equivalent viewport and increased text spacing do not clip');
 await h.run(`document.querySelector('#modalOrderDetails .portal-detail-dialog__close').click()`);await h.until(`!document.getElementById('modalOrderDetails').classList.contains('show')`);
 // Every legacy compact dialog adopts the no-X frame and keeps all action IDs.
 const compact=await h.run(`Array.from(document.querySelectorAll('.modal-confirm')).map(c=>({id:c.closest('.modal-overlay').id,x:c.querySelectorAll('[data-portal-detail-close]').length,body:!!c.querySelector('.portal-detail-dialog__body'),footer:!!c.querySelector('.portal-detail-dialog__footer')}))`);
 assert(compact.length>=5);assert(compact.every(c=>!c.x&&c.body&&c.footer));
 await h.run(`document.querySelector('[data-order-reject="1"]').click()`);await h.until(`document.getElementById('rejectIncomingOrderDialog').open`);
 assert(await h.run(`document.getElementById('rejectIncomingOrderDialog').hasAttribute('data-portal-detail-dialog')`));
 for(const theme of ['light','dark']){await h.run(`document.documentElement.dataset.theme='${theme}'`);assert.deepEqual(await h.run(`(()=>{let s=getComputedStyle(document.getElementById('rejectIncomingOrderDialog'),'::backdrop');return [s.backgroundColor,s.backdropFilter]})()`),['rgba(17, 24, 39, 0.5)','blur(3px)'],'Native dialog cool glass: '+theme);}
 await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await h.until(`!document.getElementById('rejectIncomingOrderDialog').open`);
 // Native payment dialog can also open directly through its existing history entry.
 await h.run(`document.querySelector('[data-order-view="1"]').click()`);await h.until(`document.getElementById('modalOrderDetails').classList.contains('show')`);
 // Present the real gateway history, retaining the existing owner and API read.
 await h.run(`document.querySelector('#modalOrderDetails [data-gateway-manage]').click()`);await h.until(`document.querySelector('dialog.gateway-team-dialog').open`);
 for(const width of [320,390,768,1024,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
  assert(await h.run(`(()=>{let d=document.querySelector('dialog.gateway-team-dialog'),r=d.getBoundingClientRect(),b=d.querySelector('.portal-detail-dialog__body'),f=d.querySelector('.portal-detail-dialog__footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&f.bottom<=innerHeight+1&&b.scrollWidth<=b.clientWidth+1})()`),'Payment history fits at '+width);
  if([390,1440].includes(width))await shot(role+'-payment-details-'+width);
 }
 await h.run(`document.querySelector('dialog.gateway-team-dialog .portal-detail-dialog__close').click()`);await h.until(`!document.querySelector('dialog.gateway-team-dialog').open`);
 await h.run(`document.querySelector('#modalOrderDetails [data-modal-close]').click()`);
 await h.until(`getComputedStyle(document.body).position!=='fixed'`);
 await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:true});
 await h.run(`document.querySelector('[data-tab=walkin]').click();document.getElementById('openWalkInOrderModalBtn').click()`);
 await h.until(`document.getElementById('modalAddWalkInOrder').classList.contains('show')`);
 await h.run(`{const i=document.getElementById('walkInCustomerNameInput');i.value='Retained walk-in draft';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('saveWalkInOrderBtn').click();}`);
 await h.until(`document.querySelector('#adminSystemPopup.show')`);
 assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup [data-portal-detail-close]').length`),0,'Validation popup has no X');
 await h.run(`document.getElementById('adminSystemPopupOk').click()`);
 assert.equal(await h.run(`document.getElementById('walkInCustomerNameInput').value`),'Retained walk-in draft');
 assert.equal(await h.run(`document.body.style.position`),'fixed','Nested popup never unlocks the form');
 await shot(role+'-walk-in-390');
 await h.run(`document.querySelector('#modalAddWalkInOrder [data-portal-detail-close]').click()`);
 await h.until(`document.querySelector('#adminSystemPopup.show')`);
 await h.run(`document.getElementById('adminSystemPopupCancel').click()`);
 assert.equal(await h.run(`document.getElementById('walkInCustomerNameInput').value`),'Retained walk-in draft');
 await h.run(`document.querySelector('#modalAddWalkInOrder [data-portal-detail-close]').click()`);
 await h.until(`document.querySelector('#adminSystemPopup.show')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
 await h.until(`getComputedStyle(document.body).position!=='fixed'`);
 assert.deepEqual(await h.run('fixtureErrors'),[]);
 t.diagnostic('Screenshots: '+h.artifacts);
});
