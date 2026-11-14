const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Products forms, nested previews, personal notifications and scoped popups retain their workflows', {skip: !chrome, timeout: 240000}, async t => {
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#faf4e8"/><circle cx="300" cy="300" r="180" fill="#b99c65"/></svg>');
  const seed = () => Array.from({length: 14}, (_, i) => ({id:i+1,name:i?'Workshop product '+i:'Engraved Coaster',category:'Laser Cut',code:'ENG-'+i,stock:12,price:150,stock_status:'in_stock',is_blocked:false,image_data:image,summary:'A personalized workshop product.',media:[{id:'cover',type:'image',url:image}]}));
  let products = seed(), fail = false, hold = false, replies = [], writes = [], sessionMode = 'normal';
  const notifications = new Map();
  const clip=fs.readFileSync(require('node:path').join(__dirname,'../Fixtures/product-media/short.webm')).toString('base64');
  const font = process.env.FMRC_BROWSER_POPPINS;
  const setup = `{
    const originalFetch=window.fetch;window.fetch=(input,init)=>originalFetch(typeof input==='string'?input.replace('http://127.0.0.1:8000/api',window.APP_API_BASE_URL).replace('http://localhost:8000/api',window.APP_API_BASE_URL):input,init);
    ${font ? `const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);` : ''}
  }`;
  const h = await browserFixture(t, async ({req,route,json,role}) => {
    if (route.startsWith('/api/admin/session')) {
      if (route.endsWith('/activity')) sessionMode='normal';
      const now=Date.now();
      json({server_time:new Date(now).toISOString(),idle_warning_at:new Date(now+(sessionMode==='normal'?3600000:-1000)).toISOString(),idle_expires_at:new Date(now+(sessionMode==='expired'?-500:sessionMode==='normal'?3780000:90000)).toISOString(),absolute_expires_at:new Date(now+21600000).toISOString()});return true;
    }
    if (route.startsWith('/api/admin/notifications')) {
      const feed = notifications.get(role) || [{id:1,type:'order',title:'Order request',message:'A new order awaits review.',is_read:false,created_at:new Date().toISOString()}];
      if (req.method !== 'GET') { if (/clear|remove|delete/.test(route) || req.method==='DELETE') notifications.set(role,[]); else notifications.set(role,feed.map(n=>({...n,is_read:true}))); }
      const data=notifications.get(role)||feed; json({user_id:role==='admin'?11:22,data,unread_count:data.filter(n=>!n.is_read).length});return true;
    }
    if (route==='/api/admin/products/catalog-options') {json({data:products});return true;}
    if (route==='/api/admin/products' && req.method==='GET') {json({data:products});return true;}
    if (/^\/api\/admin\/products(?:\/\d+)?$/.test(route) && ['POST','PUT','DELETE'].includes(req.method)) {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=raw?JSON.parse(raw):null;writes.push({route,method:req.method,body});
      if (hold) await new Promise(resolve=>replies.push(resolve));
      if (fail) {json({message:'This product could not be saved or deleted.'},422);return true;}
      const id=Number(route.split('/').at(-1));
      if(req.method==='POST') products.push({...body,id:100,media:[]});
      if(req.method==='PUT') products=products.map(p=>p.id===id?{...p,...body}:p);
      if(req.method==='DELETE') products=products.filter(p=>p.id!==id);
      json({data:products.find(p=>p.id===id),message:'Product saved successfully.'});return true;
    }
    return false;
  }, {setup});
  t.after(()=>replies.splice(0).forEach(resolve=>resolve()));
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const viewport=async(width,height=900,scale=1)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await h.pause(40);};
  const click=async selector=>{await h.until(`document.querySelector(${JSON.stringify(selector)})`);await h.run(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const input=(selector,value)=>h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const key=async key=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:{Tab:9,Escape:27,ArrowDown:40,Enter:13}[key],...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
  const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
  const idle=()=>h.until(`document.body.style.position!=='fixed'&&!document.querySelector('.modal-overlay.show,.admin-system-popup.show,.all-notif-overlay.show,.admin-media-viewer:not([hidden])')`);
  const edit=async()=>{await click('[data-view-id="1"]');await click('#btnOpenEditFromView');await h.until(`document.querySelector('#modalEditProduct.show')&&document.querySelectorAll('#editProductGallery .product-gallery-slot').length===5&&document.getElementById('editProductGallery').getAttribute('aria-busy')==='false'`);};
  const cover=async()=>{
    await h.run(`{const c=document.createElement('canvas');c.width=c.height=600;const x=c.getContext('2d');x.fillStyle='#b99c65';x.fillRect(0,0,600,600);c.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'cover.png',{type:'image/png'}));const n=document.getElementById('addProductPhoto');n.files=dt.files;n.dispatchEvent(new Event('change',{bubbles:true}));});}`);
    await h.until(`document.querySelector('#modalProductPhotoEditor.show')`);
  };
  const geometry=async selector=>{
    await h.run(`Promise.all(document.querySelector(${JSON.stringify(selector)}).getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
    return h.run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),rect=n=>{const q=n.getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right};};return{card:rect(c),head:rect(c.querySelector('.portal-detail-dialog__header')),foot:rect(c.querySelector('.portal-detail-dialog__footer,.all-notif-actions-bar')),body:rect(b),overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1,radius:getComputedStyle(c).borderRadius,locked:document.body.style.position==='fixed'};})()`);
  };
  for (const role of ['admin','staff']) {
    products=seed();fail=false;hold=false;sessionMode='normal';
    await viewport(1440);await h.go('/'+role+'-page/products.html');await h.until(`document.querySelector('[data-view-id="1"]')&&!document.querySelector('.admin-global-page-skeleton')`);
    for(const theme of ['light','dark']) for(const width of [320,390,768,1024,1440]) {
      await viewport(width);await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.scrollTo(0,250);window.savedPageY=scrollY`);
      await click('.notifications');await h.until(`document.querySelector('.notification-dropdown.show')`);
      await h.run(`Promise.all(document.querySelector('.notification-dropdown').getAnimations().map(a=>a.finished.catch(()=>{})))`);
      assert.equal(await h.run(`(()=>{const d=document.querySelector('.notification-dropdown'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1;})()`),true,role+' dropdown fits '+width);
      if(theme==='light'&&[390,1440].includes(width))await h.shot(`products-${role}-dropdown-${width}`);
      await click('.notifications');
      for(const kind of ['add','edit','image','delete','popup','notifications','preview']) {
        const selector={add:'#modalAddProduct',edit:'#modalEditProduct',delete:'#modalDeleteProduct',image:'#modalProductPhotoEditor',popup:'#adminSystemPopup',notifications:'#allNotifOverlay',preview:'.admin-media-viewer'}[kind];
        if(kind==='add') await click('#btnOpenAddProduct');
        if(kind==='edit') await edit();
        if(kind==='image') {await click('#btnOpenAddProduct');await cover();}
        if(kind==='popup') await h.run(`showAdminPopup('Review the product fields and try again.',{title:'Check product details',type:'error'})`);
        if(kind==='delete') await click('[data-delete-id="1"]');
        if(kind==='notifications') await h.run('openAllNotificationsPanel()');
        if(kind==='preview') await h.run(`AdminMediaViewer.open({url:${JSON.stringify(image)},name:'Product reference image.png',type:'image'})`);
        await h.until(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-hidden')==='false'`);
        const g=await geometry(selector);
        assert.deepEqual(await h.run(`(()=>{let s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return [s.backgroundColor,s.backdropFilter]})()`),['rgba(17, 24, 39, 0.5)','blur(3px)'],'Cool glass scrim: '+kind+' '+theme);
        assert(g.card.left>=0&&g.card.right<=width+1&&g.card.top>=0&&g.card.bottom<=901,`${role} ${kind} ${width}: ${JSON.stringify(g)}`);
        assert(!g.overflow&&g.locked&&g.radius===(kind==='notifications'?'0px':'12px'),`${kind}: ${JSON.stringify(g)}`);
        if(kind==='notifications')assert(g.card.top===0&&g.card.bottom===900&&g.card.right===width,'Notification drawer fills the right edge');
        assert(g.head.bottom<=g.body.top+1&&(kind==='notifications'?g.foot.bottom<=g.body.top+1:g.foot.top>=g.body.bottom-1),kind+' fixed chrome and scrolling body');
        assert.equal(await h.run(`document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.portal-detail-dialog__close').length`),['delete','popup'].includes(kind)?0:1);
        if((theme==='light'&&[390,1440].includes(width))||(theme==='dark'&&width===390)) await h.shot(`products-${role}-${kind}-${width}-${theme}`);
        if(kind==='image') {await click('#btnCancelPhotoEdit');await click('#btnCancelAddProduct');}
        else if(kind==='delete') await click('#btnCancelDeleteProduct');
        else if(kind==='add') await click('#btnCancelAddProduct');
        else if(kind==='edit') await click('#btnCancelEditProduct');
        else await key('Escape');
        await idle();
      }
    }
    await viewport(852,393);await edit();let g=await geometry('#modalEditProduct');assert(g.card.bottom<=393&&g.body.bottom>g.body.top+30);await click('#btnCancelEditProduct');await idle();
    await viewport(720,450,2);await click('#btnOpenAddProduct');g=await geometry('#modalAddProduct');assert(!g.overflow&&g.card.bottom<=450);await key('Escape');await idle();
    await viewport(1440);await click('#btnOpenAddProduct');await click('#btnSaveProduct');await popup('Validation Error');
    assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup button[aria-label*="Close"],#adminSystemPopup hr').length`),0);await key('Escape');
    await input('#addProductCategory','Laser Cut');await h.until(`!document.getElementById('addProductNameTrigger').disabled&&document.querySelector('#addProductNameSelect option[value="1"]')`);await click('#addProductNameTrigger');await input('#addProductNameSearch','Engraved');await key('ArrowDown');await key('Enter');
    assert.equal(await h.run(`document.getElementById('addProductNameSelect').value`),'1');
    await click('#addProductNameTrigger');await key('Escape');assert.equal(await h.run(`document.getElementById('modalAddProduct').classList.contains('show')`),true,'Picker Escape does not discard the form');
    await click('#addProductNameTrigger');await click('#addProductNameAddNewBtn');await input('#addProductNewName','New Product');await input('#addProductCode','NEW-1');await input('#addProductStock','0');await input('#addProductPrice','125');await click('#addProductBlocked');
    await h.run(`{const c=document.createElement('canvas');c.width=c.height=600;const x=c.getContext('2d');x.fillStyle='#b99c65';x.fillRect(0,0,600,600);c.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'cover.png',{type:'image/png'}));const n=document.getElementById('addProductPhoto');n.files=dt.files;n.dispatchEvent(new Event('change',{bubbles:true}));});}`);
    await h.until(`document.querySelector('#modalProductPhotoEditor.show')`);await input('#productPhotoRotate','20');await key('Escape');await popup('Discard changes?');await click('#adminSystemPopupCancel');
    await click('#btnApplyProductPhotoEdit');await h.until(`!document.querySelector('#modalProductPhotoEditor.show')`);assert.equal(await h.run(`document.body.style.position`),'fixed','Closing image editor preserves the form lock');
    fail=true;hold=true;const before=writes.length;await click('#btnSaveProduct');await h.until(`document.getElementById('btnCancelAddProduct').disabled`);await key('Escape');await click('#btnSaveProduct');
    assert.equal(writes.length,before+1);hold=false;replies.splice(0).forEach(resolve=>resolve());await popup('Save Failed');await click('#adminSystemPopupOk');
    assert.equal(await h.run(`document.getElementById('addProductNewName').value`),'New Product');fail=false;await click('#btnSaveProduct');await idle();
    const created=writes.filter(w=>w.method==='POST').at(-1).body;assert.equal(created.is_blocked,true);assert.equal(created.stock,0);assert.match(created.image_data,/^data:image\/png/);
    await edit();await input('#editProductName','Retained edit');await click('#editProductBlocked');fail=true;await click('#btnUpdateProduct');await popup('Update Failed');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('editProductName').value`),'Retained edit');
    await click('#modalEditProduct [data-portal-detail-close]');await popup('Discard changes?');await click('#adminSystemPopupCancel');fail=false;await click('#btnUpdateProduct');await idle();assert.equal(products[0].is_blocked,true);
    await edit();await h.run(`AdminMediaViewer.open({url:${JSON.stringify(image)},name:'Preview with a long filename '.repeat(10)+'.png',type:'image',trigger:document.getElementById('editUploadArea')})`);await h.until(`!document.querySelector('.admin-media-viewer').hidden`);await key('Escape');await h.until(`!document.getElementById('modalEditProduct').inert`);assert.equal(await h.run(`document.body.style.position`),'fixed');await click('#btnCancelEditProduct');await idle();
    await h.run(`AdminMediaViewer.open({url:${JSON.stringify('data:video/webm;base64,'+clip)},name:'Process.webm',type:'video'})`);
    await h.until(`document.querySelector('.admin-media-viewer video').readyState>=1`);
    await h.run(`document.querySelector('.admin-media-viewer video').muted=true;document.querySelector('.admin-media-viewer video').play()`);await key('Escape');await idle();
    assert.equal(await h.run(`document.querySelector('.admin-media-viewer video').paused&&!document.querySelector('.admin-media-viewer video').hasAttribute('src')`),true,'Closing preview stops and unloads its video');
    await click('[data-delete-id="1"]');fail=true;hold=true;const deletionCount=writes.filter(w=>w.method==='DELETE').length;await click('#btnConfirmProductDelete');await h.until(`document.getElementById('btnCancelDeleteProduct').disabled`);await key('Escape');await click('#btnCancelDeleteProduct');await click('#btnConfirmProductDelete');assert.equal(writes.filter(w=>w.method==='DELETE').length,deletionCount+1);
    hold=false;replies.splice(0).forEach(resolve=>resolve());await popup('Delete Failed');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.body.style.position`),'fixed');fail=false;await click('#btnConfirmProductDelete');await idle();assert(!products.some(p=>p.id===1));
    await h.run(`openAllNotificationsPanel()`);await click('#allNotifMarkAll');await h.until(`document.querySelector('#allNotifOverlay.show')`);await key('Escape');await idle();assert(notifications.get(role).every(n=>n.is_read));
    await click('.logout-btn');await popup('Log out');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup [data-portal-detail-close]').length`),0);await click('#adminSystemPopupCancel');await idle();
    sessionMode='warning';await h.run(`window.dispatchEvent(new Event('focus'))`);await h.until(`document.querySelector('.admin-session-warning:not([hidden])')`);await key('Escape');assert.equal(await h.run(`document.activeElement.classList.contains('admin-session-warning__stay')`),true);
    await click('.admin-session-warning__stay');await h.until(`document.querySelector('.admin-session-warning').hidden`);await idle();
    await h.run(`window.fixtureSuccessCallback=0;showAdminPopup('Product saved successfully.',{type:'success',onOk:()=>fixtureSuccessCallback++})`);await h.until(`document.querySelector('.admin-success-notification')`);assert.equal(await h.run(`[...document.querySelectorAll('.admin-success-notification__close')].every(b=>!!b.querySelector('svg')&&!b.textContent.trim())`),true);assert.equal(await h.run('fixtureSuccessCallback'),1);await click('.admin-success-notification__close');await h.run(`showAdminSuccessNotification('Product updated successfully.')`);await h.until(`!document.querySelector('.admin-success-notification')`);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
    sessionMode='expired';await h.run(`window.dispatchEvent(new Event('focus'))`);await h.until(`location.pathname.includes('/admin-auth/')`);sessionMode='normal';
  }
  // An unopted page still uses its current popup and toast presentation.
  await h.go('/admin-page/website-payments.html');await h.until(`typeof showAdminConfirmPopup==='function'`);await h.run(`showAdminConfirmPopup('Existing page presentation.',{title:'Unrelated action'})`);await popup('Unrelated action');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup hr').length`),2);assert.equal(await h.run(`document.getElementById('adminSystemPopup').hasAttribute('data-portal-detail-dialog')`),false);await click('#adminSystemPopupCancel');
  await h.run('openAllNotificationsPanel()');await h.until(`document.querySelector('#allNotifOverlay.show')`);
  await h.run(`showAdminPopup('Notifications could not be updated.',{title:'Notifications Not Updated',type:'error'})`);await popup('Notifications Not Updated');assert.equal(await h.run(`document.getElementById('adminSystemPopup').dataset.popupPresentation`),'refined');await click('#adminSystemPopupOk');await key('Escape');await idle();
  await h.run(`showAdminConfirmPopup('Existing page presentation.',{title:'Unrelated action'})`);await popup('Unrelated action');assert.equal(await h.run(`document.getElementById('adminSystemPopup').hasAttribute('data-portal-detail-dialog')`),false,'Notification presentation resets before another page action');await click('#adminSystemPopupCancel');
  console.log('Products dialog previews:',h.artifacts);
});
