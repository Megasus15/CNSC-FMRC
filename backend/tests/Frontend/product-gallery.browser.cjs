const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {browserSession,chrome}=require('./browser-helper.cjs');
const repo=path.resolve(__dirname,'../../..');
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#fffaf2"/><rect x="220" y="70" width="160" height="460" rx="30" fill="#ba9753"/><path d="M220 110h160M220 490h160" stroke="#6b202b" stroke-width="8"/></svg>');
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Product gallery, fixed media layout and shared operator editor work across viewports',{skip:!chrome,timeout:180000},async()=>{
  let product={id:1,name:'Bamboo Tumbler',category:'Products',code:'BT-01',price:150,sale_price:150,stock:5,stock_status:'in_stock',is_blocked:false,image_data:image,summary:'Price varies depending on size, design and production requirements.\n'.repeat(35),details_chips:['Bamboo','Made to order'],availability:['Available while supplies last'],recommended_for:['Everyday use','Personalized gifts'],review_count:2,rating_average:4.5,media:[{id:'cover',type:'image',url:image},...Array.from({length:3},(_,i)=>({id:uuid(i+1),type:'image',url:image})),{id:uuid(4),type:'video',url:'/fixtures/short.webm',duration_seconds:1.2}]};
  let failSave=false,uploads=0,discards=0,writes=0,uploadReplies=[],holdUploads=false;
  let aboutEmpty=false;
  let saveReply=null,holdSave=false;
  let galleryModuleFails=false;
  const drafts=new Map();
  const server=http.createServer(async(req,res)=>{
    try {
      const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
      if(route.startsWith('/api/')) {
        if(route==='/api/products'||route==='/api/admin/products') return json({data:[product]});
        if(route==='/api/admin/products/1'&&req.method==='PUT') {
          let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes++;
          if(holdSave)await new Promise(resolve=>{saveReply=resolve;});
          if(failSave)return json({message:'Save interrupted. Your edits are still here.'},503);
          product={...product,...body,media:[{id:'cover',type:'image',url:body.image_data||product.image_data},...body.gallery_media.map(item=>item.upload_token?{id:item.upload_token,...drafts.get(item.upload_token)}:product.media.find(saved=>saved.id===item.id))]};
          return json({data:product,message:'Product updated successfully.'});
        }
        if(route==='/api/admin/products/1/media-uploads'&&req.method==='POST') {
          const chunks=[];for await(const chunk of req)chunks.push(chunk);
          const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();
          const file=form.get('file'),id=uuid(++uploads+10),video=file.type.startsWith('video/');
          drafts.set(id,{type:video?'video':'image',url:video?'/fixtures/short.webm':image,duration_seconds:video?1.2:null});
          if(holdUploads)await new Promise(resolve=>uploadReplies.push(resolve));
          return json({data:{upload_token:id,type:video?'video':'image',duration_seconds:video?1.2:null}},201);
        }
        if(route.includes('/media-uploads/')&&req.method==='DELETE'){discards++;return json({message:'Discarded.'});}
        if(route.endsWith('/reviews'))return json({data:[],summary:{average:4.5,count:2,total:2,stars:{}},meta:{current_page:1,last_page:1}});
        if(route==='/api/site-settings') return json({data:aboutEmpty?{}:{mission_gallery:JSON.stringify([image,image,image]),vision_gallery:JSON.stringify([image,image,image])}});
        if(route==='/api/user')return json({id:11,role:String(req.headers.authorization).includes('staff')?'staff':'admin',email:'editor@example.com',name:'Editor'});
        if(route==='/api/admin/preferences')return json({user_id:11,preferences:{theme:'light',compact:false,reducedMotion:false}});
        return json({data:[]});
      }
      if(route==='/fixtures/short.webm'){res.setHeader('Content-Type','video/webm');res.end(fs.readFileSync(path.join(repo,'backend/tests/Fixtures/product-media/short.webm')));return;}
      if (route === '/admin-page/product-gallery.js' && galleryModuleFails) { res.writeHead(503, {'Content-Type':'text/javascript'}); res.end(''); return; }
      const sourceRoute = /^\/(admin|staff)-page\/products$/.test(route) ? route+'.html' : route;
      const file=path.resolve(repo,'.'+sourceRoute);
      if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
      const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'})[ext]||'application/octet-stream');
      let data=fs.readFileSync(file);
      if(ext==='.html')data=data.toString().replace('<head>',`<head><script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',e=>{if(e.message)fixtureErrors.push(e.message)});addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:11,role,email:role+'@example.com'}));}</script>`);
      if (['/admin-page/products.html','/staff-page/products.html'].includes(sourceRoute)) data = data.toString().replace('</head>', `<script>
        document.addEventListener('DOMContentLoaded', () => {
          const factory = window.createProductGalleryEditor;
          delete window.createProductGalleryEditor;
          setTimeout(() => { window.createProductGalleryEditor = factory; window.fixtureGalleryStartupSettled = true; }, 150);
        }, {once:true});
      </script></head>`);
      res.end(data);
    }catch(error){res.statusCode=500;res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    await browserSession(async({send,run,until,artifacts})=>{
      console.log('Browser artifacts: '+artifacts);
      const navigate=async route=>{await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+route});await until(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'`);};
      const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const frame=()=>run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const shot=async name=>{const result=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(result.data,'base64'));};
      await navigate('/products-page/product.html');
      await until("document.querySelector('#productGrid .btn-view-info')");
      await click('#productGrid .btn-view-info');
      await until("document.querySelector('#productInfoGallery img')?.naturalWidth>0");
      for(const [width,height] of [[320,568],[390,844],[768,900],[1024,900],[1440,900],[844,390],[568,320]]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await frame();
        await run("Promise.all(document.getAnimations().filter(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))");
        const layout=await run(`(()=>{const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const card=document.querySelector('#productInfoModal .modal-box'),copy=document.getElementById('productInfoCopy'),gallery=document.getElementById('productInfoGallery'),footer=card.querySelector('.modal-actions');return {card:box(card),copy:box(copy),gallery:box(gallery),footer:box(footer),copyScrollable:copy.scrollHeight>copy.clientHeight,bodyOverflow:card.scrollWidth>card.clientWidth+1,fit:getComputedStyle(gallery.querySelector('img')).objectFit,buttons:['.btn-add-cart','.btn-buy-now'].map(sel=>{const style=n=>{const s=getComputedStyle(n);return [s.height,s.borderRadius,s.fontSize,s.borderColor,s.backgroundColor,s.gap,n.querySelector('svg')?.outerHTML];};return {card:style(document.querySelector('#productGrid '+sel)),modal:style(document.querySelector('.product-purchase-actions '+sel))};})};})()`);
        assert(layout.card.x>=0&&layout.card.y>=0&&layout.card.right<=width+1&&layout.card.bottom<=height+1,JSON.stringify(layout));
        assert(layout.copy.height>=60&&layout.copyScrollable,`Text remains independently scrollable at ${width}x${height}: `+JSON.stringify(layout));
        assert(layout.copy.y>=layout.card.y&&layout.copy.bottom<=layout.footer.y+1,`The entire text pane remains above the footer at ${width}x${height}: `+JSON.stringify(layout));
        assert(layout.gallery.bottom<=layout.footer.y+1,`Gallery stays above the footer at ${width}x${height}`);
        assert(layout.footer.bottom<=layout.card.bottom+1);assert.equal(layout.bodyOverflow,false);assert.equal(layout.fit,'contain');
        for(const buttons of layout.buttons)assert.deepEqual(buttons.card,buttons.modal,'Card and modal purchase buttons match');
        const before=await run("document.getElementById('productInfoGallery').getBoundingClientRect().top");
        await run("document.getElementById('productInfoCopy').scrollTop=500");await frame();
        assert.equal(await run("document.getElementById('productInfoGallery').getBoundingClientRect().top"),before);
        await shot('customer-'+width+'-'+height);
      }
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await click('#productInfoGallery .editorial-gallery-arrow--next');
      assert.equal(await run("document.querySelector('#productInfoGallery [data-current=true]').getAttribute('aria-hidden')"),'false');
      await run("document.querySelector('#productInfoGallery [data-current=true]').click()");
      await until("document.getElementById('imageLightboxModal').classList.contains('show-modal')");
      await click('#closeLightboxBtn');
      await run("document.querySelector('[data-gallery-dot=\"0\"]').focus()");
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Home'});
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight'});
      assert.equal(await run("document.getElementById('productInfoGallery')._editorialIndex"),1);
      const gesture=await run("(()=>{const r=document.getElementById('productInfoGallery').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...gesture,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:gesture.x-70,y:gesture.y,button:'left',buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:gesture.x-70,y:gesture.y,button:'left',clickCount:1});
      assert.equal(await run("document.getElementById('productInfoGallery')._editorialIndex"),2);
      assert.equal(await run("document.getElementById('imageLightboxModal').classList.contains('show-modal')"),false);
      await run("window.originalMediaPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'))");
      await click('[data-gallery-dot="4"]');
      await until("!document.querySelector('#productInfoGallery .fmrc-gallery-play').hidden");
      await run("HTMLMediaElement.prototype.play=window.originalMediaPlay");await click('#productInfoGallery .fmrc-gallery-play');
      await until("document.querySelector('#productInfoGallery video').currentTime>0");
      assert.equal(await run("document.querySelector('#productInfoGallery video').muted"),true);
      await run("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
      assert.equal(await run("document.querySelector('#productInfoGallery video').paused"),true);
      await run("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
      await until("!document.querySelector('#productInfoGallery video').paused");
      await click('[data-gallery-dot="0"]');
      assert.equal(await run("document.querySelector('#productInfoGallery video').paused"),true);
      await click('[data-gallery-dot="4"]');
      await until("!document.querySelector('#productInfoGallery video').paused");
      await click('#closeProductInfoModal');
      await until("document.querySelector('#productInfoGallery video').paused");
      await click('#productGrid .btn-view-info');
      assert.equal(await run("document.querySelector('#productInfoGallery [data-current=true] img').id"),'productInfoImage');
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert.equal(await run("getComputedStyle(document.querySelector('#productInfoGallery .vm-deck__card')).transitionDuration"),'0s');
      await click('[data-gallery-dot="4"]');await until("!document.querySelector('#productInfoGallery video').paused");
      await send('Emulation.setEmulatedMedia',{features:[]});
      await run("window.fixtureActions=[];for(const name of ['product:add-to-cart','product:buy-now'])document.addEventListener(name,e=>fixtureActions.push({type:name,id:e.detail.id}),{once:true})");
      await click('#productInfoAddToCart');await click('#productGrid .btn-view-info');await click('#productInfoBuyNow');
      assert.deepEqual(await run('window.fixtureActions'),[{type:'product:add-to-cart',id:1},{type:'product:buy-now',id:1}]);
      await navigate('/about-page/about.html');
      await until("document.querySelector('#missionDeck .editorial-gallery-arrow')");
      await click('#missionDeck .editorial-gallery-arrow--next');
      assert.equal(await run("document.getElementById('missionDeck')._editorialIndex"),1);
      assert.equal(await run("getComputedStyle(document.querySelector('#missionDeck .vm-deck__card')).transitionDuration"),'0.22s');
      assert.deepEqual(await run('window.fixtureErrors'),[]);

      // Exercise the canonical editor through both its Admin and Staff loaders.
      product={...product,summary:'A carefully made bamboo tumbler.',media:product.media.slice(0,1)};
      for(const role of ['admin','staff']) {
        await navigate('/'+role+'-page/products');
        await until("document.querySelector('[data-view-id=\"1\"]')");
        await click('[data-view-id="1"]');await click('#btnOpenEditFromView');
        await until("document.querySelectorAll('#editProductGallery .product-gallery-slot').length===5");
        for(const [width,theme] of [[390,'light'],[768,'dark'],[1440,'light']]) {
          await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
          await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('editProductGallery').scrollIntoView({block:'center'})`);await frame();
          assert.equal(await run("(()=>{const root=document.getElementById('editProductGallery');return root.scrollWidth>root.clientWidth+1})()"),false);
          await shot(role+'-editor-'+width+'-'+theme);
        }
        const addFile=async(name,video=false)=>run(`(async()=>{const input=document.querySelector('#editProductGallery').nextElementSibling;document.querySelector('#editProductGallery [data-gallery-action=add]').click();const data=${video?"await (await fetch('/fixtures/short.webm')).blob()":"await new Promise(r=>{const c=document.createElement('canvas');c.width=100;c.height=60;c.getContext('2d').fillRect(0,0,100,60);c.toBlob(r,'image/png')})"};const files=new DataTransfer();files.items.add(new File([data],${JSON.stringify(name)},{type:${JSON.stringify(video?'video/webm':'image/png')}}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        holdUploads=true;const prior=uploads;
        await addFile('detail.png');
        for(let i=0;i<100&&uploads===prior;i++)await delay(20);
        assert.equal(await run("document.getElementById('btnUpdateProduct').disabled"),true);
        holdUploads=false;uploadReplies.splice(0).forEach(resolve=>resolve());
        await until("!document.getElementById('btnUpdateProduct').disabled&&document.querySelector('#editProductGallery .product-gallery-heading>span').textContent==='2 / 5 items'");
        failSave=true;holdSave=true;const savedBefore=writes;await click('#btnUpdateProduct');
        await until("document.getElementById('btnCancelEditProduct').disabled&&document.querySelector('#modalEditProduct .modal-body-scroll').inert");
        for(let i=0;i<100&&!saveReply;i++)await delay(20);
        assert(saveReply,'Save reaches the API');holdSave=false;saveReply();saveReply=null;
        await until("document.querySelector('#adminSystemPopup.show')");
        assert.equal(writes,savedBefore+1);assert.equal(product.media.length,1);
        assert.equal(await run("document.getElementById('modalEditProduct').classList.contains('show')"),true);
        await click('#adminSystemPopupOk');failSave=false;
        await click('#btnUpdateProduct');await until("!document.getElementById('modalEditProduct').classList.contains('show')");
        assert.equal(product.media.length,2);
        await until("!document.getElementById('btnUpdateProduct').disabled");
        await click('[data-view-id="1"]');await click('#btnOpenEditFromView');
        await addFile('process.webm',true);await until("!document.getElementById('btnUpdateProduct').disabled&&document.querySelector('#editProductGallery .product-gallery-heading>span').textContent==='3 / 5 items'");
        await click('#editProductGallery [data-gallery-action="earlier"][data-index="2"]');
        assert.match(await run("document.querySelectorAll('#editProductGallery .product-gallery-number span')[1].textContent"),/Video/);
        await click('#editProductGallery [data-gallery-action="later"][data-index="1"]');
        const uploaded=uploads;await addFile('second.webm',true);
        await until("document.querySelector('#editProductGallery .is-error')");assert.equal(uploads,uploaded);
        const discarded=discards;await click('#btnCancelEditProduct');await until("document.querySelector('#adminSystemPopup.show')");
        await click('#adminSystemPopupOk');await until("!document.getElementById('modalEditProduct').classList.contains('show')");
        for(let i=0;i<100&&discards===discarded;i++)await delay(20);
        assert(discards>discarded,'Discard removes unpublished uploads');assert.equal(product.media.length,2);
        assert.deepEqual(await run('window.fixtureErrors'),[]);
        product={...product,media:product.media.slice(0,1)};
      }
      product={...product,stock:0,stock_status:'out_of_stock'};
      await navigate('/products-page/product.html');await until("document.querySelector('#productGrid .btn-view-info')");await click('#productGrid .btn-view-info');
      assert.equal(await run("document.querySelectorAll('#productInfoGallery .editorial-gallery-arrow').length"),0);
      assert.equal(await run("document.getElementById('productInfoAddToCart').disabled&&document.getElementById('productInfoBuyNow').disabled"),true);
      assert.equal(await run("document.querySelectorAll('#productGrid video,#productGrid .editorial-gallery-arrow').length"),0);
      product={...product,image_data:null,media:[]};
      await navigate('/products-page/product.html');await until("document.querySelector('#productGrid .btn-view-info')");await click('#productGrid .btn-view-info');
      assert.equal(await run("document.querySelector('#productInfoGallery .fmrc-gallery-status').textContent"),'No product image available.');
      aboutEmpty=true;await navigate('/about-page/about.html');
      await until("document.getElementById('missionDeck').classList.contains('fmrc-gallery')");
      assert.equal(await run("!!document.getElementById('missionImgEl')&&document.querySelectorAll('#missionDeck .editorial-gallery-arrow').length===0"),true,'Empty About galleries retain their live image setting target');
      product={...product,image_data:image,media:[{id:'cover',type:'image',url:image}],stock:5,stock_status:'in_stock'};
      galleryModuleFails=true;
      await navigate('/admin-page/products');await until("document.querySelector('[data-view-id=\"1\"]')");
      await click('[data-view-id="1"]');await click('#btnOpenEditFromView');
      await until("document.querySelector('[data-gallery-retry]')&&window.fixtureGalleryStartupSettled");
      assert.equal(await run("document.getElementById('btnUpdateProduct').disabled"),true,'A missing helper shows Retry and cannot silently save without gallery state');
      const unchangedWrites=writes;await click('#btnUpdateProduct');assert.equal(writes,unchangedWrites);
      galleryModuleFails=false;await click('[data-gallery-retry]');
      await until("document.querySelectorAll('#editProductGallery .product-gallery-slot').length===5&&!document.getElementById('btnUpdateProduct').disabled");
      await click('#btnCancelEditProduct');await until("!document.getElementById('modalEditProduct').classList.contains('show')");
      await run("(()=>{const root=document.getElementById('editProductGallery');root.replaceWith(root.cloneNode(true));})()");
      await click('[data-view-id="1"]');await click('#btnOpenEditFromView');
      await until("document.querySelectorAll('#editProductGallery .product-gallery-slot').length===5&&!document.getElementById('btnUpdateProduct').disabled");
      assert.equal(await run("document.querySelectorAll('#modalEditProduct input[accept*=\"video/mp4\"]').length"),1,'Rebinding a replaced gallery cleans up the old hidden input');
      await run("window.fixtureFileClicks=0;document.getElementById('editProductGallery').nextElementSibling.addEventListener('click',event=>{event.preventDefault();window.fixtureFileClicks++;})");
      await click('#editProductGallery [data-gallery-action="add"]');
      assert.equal(await run('window.fixtureFileClicks'),1,'Replaced gallery has working Add media controls');
      await click('#btnCancelEditProduct');await until("!document.getElementById('modalEditProduct').classList.contains('show')");
      await run("document.getElementById('editProductGallery').remove()");
      await click('[data-view-id="1"]');await click('#btnOpenEditFromView');
      await until("document.querySelectorAll('#editProductGallery .product-gallery-slot').length===5");
      assert.equal(await run("document.querySelectorAll('#modalEditProduct input[accept*=\"video/mp4\"]').length"),1,'Older markup gains a gallery without duplicate upload controls');
    });
  } finally {saveReply?.();uploadReplies.splice(0).forEach(resolve=>resolve());server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
