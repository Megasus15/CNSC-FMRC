// Presentation audit only. Existing booking/payment browser tests exercise the
// actions; these fixtures never submit a real booking, payment or customer edit.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
test('shared Customer dialogs and booking steps use neutral frames with maroon focus',{skip:!chrome,timeout:120000},async t=>{
  const profile={id:33,role:'customer',name:'Maria Santos',username:'maria',email:'maria@example.test',has_password:true};
  let css=process.env.FMRC_BROWSER_FA_CSS?fs.readFileSync(process.env.FMRC_BROWSER_FA_CSS,'utf8'):'';
  for(const [file,family,weight]of [[process.env.FMRC_BROWSER_FA,'Font Awesome 6 Free','900'],[process.env.FMRC_BROWSER_FA_REGULAR,'Font Awesome 6 Free','400'],[process.env.FMRC_BROWSER_POPPINS,'Poppins','400'],[process.env.FMRC_BROWSER_MONTSERRAT,'Montserrat','100 900']])if(file)css+=`@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})}`;
  const h=await browserFixture(t,async({route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[]}});return true;}
    if(route==='/api/customer/appointments'){json({data:[],current_page:1,last_page:1});return true;}
    if(route==='/api/customer/orders'){json({data:[],returns:[],counts:{all:0}});return true;}
    return false;
  },{setup:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)}`});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const size=async width=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.pause(100);};
  const audit=async(selector,label)=>{
    // Brand badges, filled gold actions and actual payment/OTP warnings retain
    // their semantic colours; decorative frames and focus rings must be neutral.
    const bad=await h.run(`(()=>{const yellow=c=>{const m=c.match(/[\\d.]+/g)||[],[r,g,b]=m.map(Number);return r>170&&g>130&&b<160&&g>r*.6&&(m.length<4||Number(m[3])>0)};return [...document.querySelectorAll(${JSON.stringify(selector)})].flatMap(root=>[root,...root.querySelectorAll('*')]).filter(n=>!n.closest('.ux-dlg__badge,.apt-icon,.success-icon,.success-icon-circle,.user-avatar-initial,.appointment-status,[class*="badge"],[class*="status-pill"],.apt-alert,.otp-lockout-banner')).flatMap(n=>{const s=getComputedStyle(n);return ['borderTopColor','borderBottomColor','borderLeftColor','borderRightColor','outlineColor'].filter(p=>yellow(s[p])&&(p!=='outlineColor'||s.outlineStyle!=='none')&&(p==='outlineColor'||s[p.replace('Color','Style')]!=='none')&&!(p!=='outlineColor'&&n.matches('.apt-btn-blue,.ux-dlg__btn--primary')&&yellow(s.backgroundColor))).map(p=>({id:n.id,tag:n.tagName,classes:n.className,property:p,value:s[p]}))})})()`);
    const decorative=bad.filter(n=>n.id!=='gcashUnconfiguredNote');
    assert.equal(decorative.length,0,label+' '+JSON.stringify(decorative.slice(0,4)));
  };
  const roots='.ux-dlg__card,.shop-modal-box,.lightbox-box,.apt-container,.apt-nested-box,.success-card,.success-modal-card';
  for(const page of ['/home-page/','/products-page/product.html','/services-page/service.html','/about-page/about.html','/contact-page/contact.html']){
    await size(1440);await h.go(page);await h.until(`typeof showCustomerPopup==='function'`);
    for(const width of [320,390,768,1024,1440]){await size(width);await audit(roots,page+' '+width);}
  }
  await h.go('/home-page/');await h.until(`document.getElementById('viewProfileBtn')&&window.FMRCAppointments`);
  await h.run(`document.getElementById('viewProfileBtn').click()`);await h.until(`document.querySelector('#customerProfileModal.show')`);await audit('#customerProfileModal .ux-dlg__card','Account');
  for(const width of [390,1440]){await size(width);await h.run('document.fonts.ready');await h.shot('customer-account-'+width);}
  await h.run(`document.getElementById('openChangePasswordBtn').click()`);await h.until(`document.querySelector('#customerPasswordModal.show')`);await audit('#customerPasswordModal .ux-dlg__card','Password');
  await h.run(`document.getElementById('backToProfileBtn').click();document.getElementById('closeProfileModal').click()`);await h.pause(220);
  await h.run(`document.getElementById('viewOrdersBtn').click()`);await h.until(`document.querySelector('#customerOrdersModal.show')`);await audit('#customerOrdersModal .ux-dlg__card','Orders');
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
