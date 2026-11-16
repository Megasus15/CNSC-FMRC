// Presentation audit only. Existing booking/payment browser tests exercise the
// actions; these fixtures never submit a real booking, payment or customer edit.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
test('shared Customer dialogs and booking steps use neutral frames with maroon focus',{skip:!chrome,timeout:120000},async t=>{
  const profile={id:33,role:'customer',name:'Maria Santos',username:'maria',email:'maria@example.test',has_password:true};
  const order={id:104,order_no:'ORD-104',product_name:'Prototype',quantity:2,customer_stage:'completed',lifecycle_status:'completed',payment_status:'paid',payment_is_confirmed:true,payment_method:'COP',total_amount:300,return_eligible:true,has_rating:false,created_at:'2026-11-08T02:00:00Z',items:[{id:11,product_id:1,product_name:'Prototype',quantity:2,unit_price:150}]};
  const incoming={...order,id:105,order_no:'ORD-105',customer_stage:'to_pay',lifecycle_status:'incoming',payment_status:'pending',payment_is_confirmed:false,payment_method:'GCash',payment_is_automated:true,awaiting_customer_payment:true,can_request_cancel:true,cancel_is_immediate:true,return_eligible:false};
  let css=process.env.FMRC_BROWSER_FA_CSS?fs.readFileSync(process.env.FMRC_BROWSER_FA_CSS,'utf8'):'';
  for(const [file,family,weight]of [[process.env.FMRC_BROWSER_FA,'Font Awesome 6 Free','900'],[process.env.FMRC_BROWSER_FA_REGULAR,'Font Awesome 6 Free','400'],[process.env.FMRC_BROWSER_POPPINS,'Poppins','400'],[process.env.FMRC_BROWSER_MONTSERRAT,'Montserrat','100 900']])if(file)css+=`@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})}`;
  const h=await browserFixture(t,async({route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[]}});return true;}
    if(route==='/api/customer/appointments'){json({data:[],current_page:1,last_page:1});return true;}
    if(route==='/api/announcements'){json({data:[{id:1,title:'FMRC Announcement',message:'Visit FMRC for project consultations.',is_enabled:true}]});return true;}
    if(route==='/api/customer/notifications/unread-count'){json({unread_count:1});return true;}
    if(route==='/api/customer/notifications'){json({data:[{id:54,type:'order',title:'Order update',message:'Your order has been received.',target:'/home-page/?orders=1',published_at:'2026-11-16T07:00:00Z',read_at:null}],current_page:1,last_page:1});return true;}
    if(route==='/api/customer/orders'){json({data:[order,incoming],returns:[],counts:{all:2}});return true;}
    if(route==='/api/customer/orders/104'||route==='/api/customer/orders/105'){json({data:route.endsWith('104')?order:incoming});return true;}
    if(route==='/api/customer/orders/104/return/eligibility'){json({eligible:true,window_days:7,days_remaining:5,items:[{order_item_id:11,product_name:'Prototype',quantity:2,unit_price:150,returned_quantity:0}],reasons:[{value:'damaged',label:'Damaged item'}],resolutions:[{value:'refund',label:'Refund'}]});return true;}
    if(route==='/api/customer/orders/105/payment-status'){json({status:'pending',order_status:'incoming',checkout_method:'qrph',method_label:'QR Ph',retry_allowed:true,checkout_url:null,refunds:[]});return true;}
    return false;
  },{setup:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});sessionStorage.setItem('fmrc_announcement_seen_1','1');{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)}`});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const size=async width=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.pause(100);};
  const audit=async(selector,label)=>{
    // Keep branded badges and semantic status pills. Warning cards still keep
    // their background/text colour, but their frames must also be neutral.
    const bad=await h.run(`(()=>{const yellow=c=>{const m=c.match(/[\\d.]+/g)||[],[r,g,b]=m.map(Number);return r>170&&g>130&&r>=g-12&&g-b>20&&(m.length<4||Number(m[3])>0)};return [...document.querySelectorAll(${JSON.stringify(selector)})].flatMap(root=>[root,...root.querySelectorAll('*')]).filter(n=>!n.closest('.ux-dlg__badge,.apt-icon,.success-icon,.success-icon-circle,.user-avatar-initial,.appointment-status,.customer-order-status,.customer-return-status,[class*="badge"],[class*="status-pill"]')).flatMap(n=>{const s=getComputedStyle(n);return ['borderTopColor','borderBottomColor','borderLeftColor','borderRightColor','outlineColor'].filter(p=>yellow(s[p])&&(p!=='outlineColor'||s.outlineStyle!=='none')&&(p==='outlineColor'||s[p.replace('Color','Style')]!=='none')&&!(p!=='outlineColor'&&n.matches('.apt-btn-blue,.ux-dlg__btn--primary')&&yellow(s.backgroundColor))).map(p=>({id:n.id,tag:n.tagName,classes:n.className,property:p,value:s[p]}))})})()`);
    assert.equal(bad.length,0,label+' '+JSON.stringify(bad.slice(0,4)));
  };
  const roots='.ux-dlg__card,.fmrc-announcement-card,.fmrc-payment-modal,.shop-modal-box,.lightbox-box,.apt-container,.apt-nested-box,.success-card,.success-modal-card';
  for(const page of ['/home-page/','/products-page/product.html','/services-page/service.html','/about-page/about.html','/contact-page/contact.html','/products-page/refund-policy?version=fixture-version','/products-page/transaction-terms?version=fixture-version','/apps/customer/home-page/']){
    await size(1440);await h.go(page);await h.until(`typeof showCustomerPopup==='function'`);
    await h.run(`document.getElementById('announcementBell').click()`);await h.until(`document.querySelector('[data-notification-id="54"]')`);
    for(const width of [320,390,768,1024,1440]){await size(width);await audit(roots,page+' '+width);if(page==='/home-page/'&&[390,1440].includes(width)){await h.run('document.fonts.ready');await h.shot('customer-notifications-'+width);}}
    await h.run(`document.querySelector('[data-notifications-tab="announcements"]').click()`);await audit('#announcementModal','Public announcements');
    await h.run(`document.querySelector('#announcementModal .fmrc-announcement__close').click()`);
  }
  await h.go('/home-page/');await h.until(`document.getElementById('viewProfileBtn')&&window.FMRCAppointments`);
  await h.run(`document.getElementById('viewProfileBtn').click()`);await h.until(`document.querySelector('#customerProfileModal.show')`);await audit('#customerProfileModal .ux-dlg__card','Account');
  for(const width of [390,1440]){await size(width);await h.run('document.fonts.ready');await h.shot('customer-account-'+width);}
  await h.run(`document.getElementById('openChangePasswordBtn').click()`);await h.until(`document.querySelector('#customerPasswordModal.show')`);await audit('#customerPasswordModal .ux-dlg__card','Password');
  await h.run(`document.getElementById('backToProfileBtn').click();document.getElementById('closeProfileModal').click()`);await h.pause(220);
  await h.run(`document.getElementById('viewOrdersBtn').click()`);await h.until(`document.querySelector('#customerOrdersModal.show')`);await audit('#customerOrdersModal .ux-dlg__card','Orders');
  await h.until(`document.querySelector('[data-panel="all"] [data-order-detail="104"]')`);
  await h.run(`document.querySelector('[data-panel="all"] [data-order-detail="104"]').click()`);await h.until(`document.querySelector('#customerOrderDetailModal.show')&&document.getElementById('customerOrderDetailTitle').textContent.includes('104')`);await audit('#customerOrderDetailModal','Order details');
  await h.run(`document.getElementById('closeCustomerOrderDetail').click()`);await h.pause(220);
  await h.until(`document.querySelector('[data-panel="all"] [data-order-cancel="105"]')`);await h.run(`document.querySelector('[data-panel="all"] [data-order-cancel="105"]').click()`);await h.until(`document.querySelector('.customer-cancel-card')`);await audit('.customer-cancel-card','Cancellation popup');
  await h.run(`document.querySelector('[data-cancel-close]').click()`);await h.pause(220);
  await h.run(`document.querySelector('[data-panel="all"] [data-order-return="104"]').click()`);await h.until(`document.querySelector('#customerReturnRequestModal.show [data-return-reason]')`);await audit('#customerReturnRequestModal','Return / refund request');
  await h.run(`document.querySelector('[data-return-request-close]').click()`);await h.pause(220);
  await h.run(`[...document.querySelectorAll('#customerOrdersTabs [data-tab]')].find(n=>/rate/i.test(n.textContent)).click();document.querySelector('[data-order-rate="104"]').click()`);await h.until(`document.querySelector('#customerRatingModal.show [data-rating-item]')`);await audit('#customerRatingModal','Product review');
  await h.run(`document.getElementById('closeRatingModal').click();void FMRCGatewayPayments.open(105)`);await h.until(`document.querySelector('.fmrc-payment-modal[open]')`);await audit('.fmrc-payment-modal','Payment / refund details');
  await h.run(`document.querySelector('[data-gateway-close]').click()`);
  await h.run(`document.querySelector('#customerOrdersModal .ux-dlg__close').click()`);await h.pause(220);
  await h.run(`void FMRCAppointments.open()`);await h.until(`document.querySelector('#customerAppointmentsModal.show')`);await audit('#customerAppointmentsModal .ux-dlg__card','My Appointments');
  await h.run(`document.querySelector('#customerAppointmentsModal .ux-dlg__close').click()`);await h.pause(220);
  await h.run(`void showCustomerPopup('Please review your appointment details.',{title:'Review appointment',isConfirm:true})`);await h.until(`document.querySelector('#customerSystemPopup.show')`);await audit('#customerSystemPopup .ux-dlg__card','Shared confirmation');
  await h.run(`document.getElementById('customerSystemPopupCancel').focus()`);await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab'});
  assert(await h.run(`getComputedStyle(document.activeElement).outlineStyle!=='none'&&getComputedStyle(document.activeElement).outlineColor==='rgb(107, 32, 43)'`),'Keyboard focus is visible maroon');
  await h.run(`document.getElementById('customerSystemPopupCancel').click();document.querySelector('.btn-appointment').click()`);
  await h.until(`document.getElementById('appointmentFlow').classList.contains('show')||document.getElementById('appointmentFlow').classList.contains('show-modal')||getComputedStyle(document.getElementById('appointmentFlow')).display!=='none'`);
  // Render every existing step for a CSS-only audit; no booking is submitted.
  for(const step of [1,2,3,4,5]){
    await h.run(`document.querySelectorAll('.apt-content-section').forEach(n=>n.classList.toggle('active',n.id==='aptStep${step}'))`);
    for(const width of [320,390,768,1024,1440]){await size(width);await audit('#appointmentFlow','Booking step '+step+' at '+width);}
  }
  for(const id of ['aptPrivacyModal','aptConfirmModal','aptLeaveConfirmModal','successAppointmentModal'])await audit('#'+id,'Booking '+id);
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});

test('Customer sign-in and recovery dialogs retain neutral borders and visible maroon focus',{skip:!chrome,timeout:45000},async t=>{
  const h=await browserFixture(t);await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.go('/customer-auth/auth.html#login');await h.until(`document.getElementById('forgotPasswordLink')`);
  await h.run(`document.getElementById('forgotPasswordLink').click()`);await h.until(`document.getElementById('forgotPasswordModal').classList.contains('show')`);
  for(const width of [320,390,768,1024,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    assert(await h.run(`(()=>{const r=document.querySelector('#forgotPasswordModal .forgot-box').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})()`));
    assert(await h.run(`[...document.querySelectorAll('.forgot-box,.success-box,.status-box')].every(n=>{const s=getComputedStyle(n),rgb=s.borderTopColor.match(/[\\d.]+/g)?.map(Number)||[];return s.borderTopStyle==='none'||!(rgb[0]>170&&rgb[1]>130&&rgb[0]>=rgb[1]-12&&rgb[1]-rgb[2]>20)})`));
  }
  const {root:dom}=await h.send('DOM.getDocument');const {nodeId}=await h.send('DOM.querySelector',{nodeId:dom.nodeId,selector:'#forgotEmail'});
  await h.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['focus','focus-visible']});
  await h.until(`getComputedStyle(document.getElementById('forgotEmail')).outlineColor==='rgb(107, 32, 43)'`);
  assert.equal(await h.run(`getComputedStyle(document.getElementById('forgotEmail')).outlineColor`),'rgb(107, 32, 43)');
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
