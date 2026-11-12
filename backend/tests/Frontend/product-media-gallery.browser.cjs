// Full Admin/Staff/Customer scripts with isolated API fixtures; no production data or provider calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {browserFixture, chrome, root} = require('./helpers/website-browser.cjs');

const output = path.join(root, 'output/product-media-phase1');
const initial = () => ({id:41,name:'Fabrication sample',category:'3D Print',code:'FMRC-041',stock:12,price:150,stock_status:'in_stock',is_blocked:false,
  summary:'Explore the finish, details, and fabrication process before placing your order.',details_chips:['Made at FMRC','Custom finish available'],availability:['Available for pickup'],recommended_for:['Student projects','Product prototypes'],
  media_count:3,media_revision:1,cover:'101',image_data:'/images/3Dprint.png',media:[
    {id:101,name:'Product overview.png',type:'image',url:'/images/3Dprint.png',thumbnail_url:'/images/3Dprint.png'},
    {id:102,name:'Fabrication detail.png',type:'image',url:'/images/cnc-milling.png',thumbnail_url:'/images/cnc-milling.png'},
    {id:103,name:'Product showcase.mp4',type:'video',url:'/api/fixture-video',size:31539036},
  ]});
function fixture() {
  const state={product:initial(),writes:[],discards:[],uploads:0,failUpload:false,failSave:false,failGallery:false};
  const handler=async ({req,res,route,json})=>{
    if(route==='/api/fixture-video') {
      const file=path.join(root,'images/Product showcase.mp4'),length=fs.statSync(file).size;
      const match=String(req.headers.range||'').match(/bytes=(\d+)-(\d*)/);
      const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),length-1):length-1;
      res.writeHead(match?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${length}`}:{})});
      if(req.method==='HEAD')res.end();else fs.createReadStream(file,{start,end}).pipe(res);return true;
    }
    if(route==='/api/products'||route==='/api/admin/products'&&req.method==='GET') {json({data:[state.product]});return true;}
    if(route==='/api/products/41/media') {json(state.failGallery?{message:'Try again'}:{data:{media:state.product.media,cover:state.product.cover,media_revision:state.product.media_revision}},state.failGallery?503:200);return true;}
    if(route==='/api/admin/products/media-uploads') {
      state.uploads++;for await(const chunk of req){};
      await new Promise(resolve=>setTimeout(resolve,150));
      if(state.failUpload){json({message:'Upload interrupted. Please retry.'},503);return true;}
      const id=200+state.uploads;json({data:{id,token:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,type:'image',name:'Additional view.png',size:1500}},201);return true;
    }
    if(route.startsWith('/api/admin/products/media-uploads/')&&req.method==='DELETE') {state.discards.push(route.split('/').at(-1));json({message:'Draft upload discarded.'});return true;}
    if(route==='/api/admin/products/41'&&req.method==='PUT') {
      let body='';for await(const chunk of req)body+=chunk;const values=JSON.parse(body);state.writes.push(values);
      if(state.failSave){json({message:'The product could not be saved. Your gallery draft is preserved.'},422);return true;}
      state.product={...state.product,...values,media_revision:state.product.media_revision+1,media_count:values.media.length,
        media:values.media.map((entry,index)=>entry.id?state.product.media.find(item=>item.id===entry.id):{id:301+index,type:'image',name:'Additional view.png',url:'/images/3dscanning.png',thumbnail_url:'/images/3dscanning.png'})};
      if(values.cover?.startsWith('0000'))state.product.cover=String(state.product.media.at(-1).id);
      json({data:state.product,message:'Product saved.'});return true;
    }
    if(route==='/api/products/41/reviews'){json({data:[{id:1,customer_name:'Customer',stars:5,feedback:'The fabrication details are clear.',media:[{type:'image',url:'/images/3Dprint.png'}]}],meta:{current_page:1,last_page:1,total:1},summary:{total:1,average:5}});return true;}
    return false;
  };
  return {state,handler};
}
async function screenshot(browser,name) {
  fs.mkdirSync(output,{recursive:true});await browser.shot(name);fs.copyFileSync(path.join(browser.artifacts,name+'.png'),path.join(output,name+'.png'));
}
async function edit(browser) {
  await browser.until('document.querySelector("[data-view-id]")');
  await browser.run('document.querySelector("[data-view-id]").click();document.getElementById("btnOpenEditFromView").click()');
  await browser.until('document.querySelectorAll("#editProductMediaEditor .pme-item").length===3');
}
async function addPhoto(browser,mode='edit') {
  await browser.run(`(async()=>{const blob=await(await fetch('/images/3dscanning.png')).blob();const transfer=new DataTransfer();transfer.items.add(new File([blob],'Additional view.png',{type:'image/png'}));const input=document.querySelector('#${mode}ProductMediaEditor input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function navigate(browser,route) {
  // Analytics data is intentionally empty; avoid waiting for an unrelated CDN chart script.
  await browser.send('Network.setBlockedURLs',{urls:['*cdn.jsdelivr.net/npm/chart.js*']});
  const previous = await browser.run('performance.timeOrigin');
  await browser.send('Page.navigate',{url:browser.base+route});
  await browser.until(`performance.timeOrigin!==${previous} && document.readyState!=='loading' && !!document.querySelector(${JSON.stringify(route.includes('products-page')?'[data-action="view-info"]':'[data-view-id="41"]')})`);
}

for(const role of ['admin','staff'])test(`${role}: gallery drafts, upload retry, ordering, cover and save boundary`,{skip:!chrome,timeout:120000},async t=>{
  const {state,handler}=fixture(),browser=await browserFixture(t,handler);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate(browser,`/${role}-page/products.html`);await edit(browser);
  await browser.run(`window.galleryMessages=[];window.showAdminPopup=(message)=>galleryMessages.push(message);document.querySelector('#editProductMediaEditor [data-key="102"] [data-action="cover"]').click();document.querySelector('#editProductMediaEditor [data-key="102"] [data-action="earlier"]').click();`);
  assert.equal(state.writes.length,0);
  assert.equal(await browser.run('document.querySelector("#editProductMediaEditor .pme-item").dataset.key'),'102');
  state.failUpload=true;await addPhoto(browser);
  assert.equal(await browser.run('document.getElementById("btnUpdateProduct").disabled'),true);
  await browser.until('document.querySelector("#editProductMediaEditor [data-action=retry]")');
  state.failUpload=false;await browser.run('document.querySelector("#editProductMediaEditor [data-action=retry]").click()');
  await browser.until('!document.querySelector("#editProductMediaEditor .pme-progress")&&!document.querySelector("#editProductMediaEditor [data-action=retry]")');
  assert.equal(state.uploads,2);assert.equal(state.writes.length,0);
  state.failSave=true;await browser.run('document.getElementById("btnUpdateProduct").click()');
  await browser.until('galleryMessages.length>0');
  assert.equal(await browser.run('document.querySelectorAll("#editProductMediaEditor .pme-item").length'),4);
  assert.equal(await browser.run('document.getElementById("modalEditProduct").classList.contains("show")'),true);
  state.failSave=false;await browser.run('document.getElementById("btnUpdateProduct").click()');
  await browser.until('!document.getElementById("modalEditProduct").classList.contains("show")');
  assert.equal(state.writes.length,2);assert.equal(state.writes[1].media_revision,1);assert.equal(state.writes[1].cover,'102');
  assert.deepEqual(state.writes[1].media.slice(0,3),[{id:102},{id:101},{id:103}]);assert.ok(state.writes[1].media[3].token);
  assert.equal(state.product.media_count,4);
  // Open the latest revision, remove only in the draft, then confirm discard.
  await browser.until('document.querySelector("[data-view-id]")');
  await browser.run('document.querySelector("[data-view-id]").click();document.getElementById("btnOpenEditFromView").click()');
  await browser.until('document.querySelectorAll("#editProductMediaEditor .pme-item").length===4');
  await browser.run(`document.querySelector('#editProductMediaEditor [data-action="remove"]').click();window.discardRequested=false;window.showAdminConfirmPopup=(m,o)=>{window.discardRequested=true;o.onConfirm();};document.getElementById('btnCancelEditProduct').click()`);
  await browser.until('!document.getElementById("modalEditProduct").classList.contains("show")');
  assert.equal(await browser.run('discardRequested'),true);assert.equal(state.writes.length,2);assert.equal(state.product.media_count,4);
  for(const width of [1440,768,390])for(const theme of ['light','dark']){
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
    await browser.run(`window.setAdminTheme('${theme}');document.querySelector('[data-view-id="41"]').click();document.getElementById('btnOpenEditFromView').click();document.getElementById('editProductMediaEditor').scrollIntoView({block:'center'});`);
    await browser.pause(150);
    assert.equal(await browser.run('document.documentElement.dataset.theme'),theme);
    const bounds=await browser.run(`(()=>{const box=document.querySelector('#modalEditProduct .product-modal').getBoundingClientRect();const media=document.getElementById('editProductMediaEditor');return {left:box.left,right:box.right,width:innerWidth,overflow:media.scrollWidth-media.clientWidth};})()`);
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.overflow<=1,JSON.stringify(bounds));
    await screenshot(browser,`${role}-${theme}-${width}`);
    await browser.run('document.getElementById("btnCancelEditProduct").click()');
  }
  await browser.run('document.getElementById("btnOpenAddProduct").click()');await addPhoto(browser,'add');
  await browser.until('document.querySelectorAll("#addProductMediaEditor .pme-item").length===1&&!document.querySelector("#addProductMediaEditor .pme-progress")');
  const discardsBefore=state.discards.length;await browser.run('document.getElementById("btnCancelAddProduct").click()');
  await browser.until('!document.getElementById("modalAddProduct").classList.contains("show")');await browser.pause(150);
  assert.ok(state.discards.length>discardsBefore);assert.equal(state.writes.length,2);
  assert.deepEqual(await browser.run('fixtureErrors'),[]);
});

test('customer: responsive gallery, real video playback, fullscreen navigation, focus, retry and review compatibility',{skip:!chrome,timeout:120000},async t=>{
  const {state,handler}=fixture(),browser=await browserFixture(t,handler);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate(browser,'/products-page/product.html');await browser.until('document.querySelector("[data-action=view-info]")');
  await browser.run('document.querySelector("[data-action=view-info]").focus();document.querySelector("[data-action=view-info]").click()');
  await browser.until('document.querySelectorAll(".product-gallery-thumb").length===3');
  await screenshot(browser,'customer-initial');
  await browser.pause(300);
  await browser.until('document.activeElement.id==="closeProductInfoModal"');
  assert.equal(await browser.run('document.querySelector(".product-gallery-count").textContent'),'1 / 3');
  await browser.run('document.querySelector(".product-gallery-next").click();document.querySelector(".product-gallery-expand").focus();document.querySelector(".product-gallery-expand").click()');
  await browser.until('document.getElementById("imageLightboxModal").classList.contains("show-modal")');
  assert.equal(await browser.run('document.querySelector(".product-lightbox-navigation").hidden'),false);
  await browser.until('document.activeElement.id==="closeLightboxBtn"');
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
  assert.match(await browser.run('document.getElementById("lightboxCaption").textContent'),/3 of 3/);
  await browser.run('document.getElementById("closeLightboxBtn").click()');
  assert.equal(await browser.run('document.activeElement.className'),'product-gallery-expand');
  await browser.until('document.querySelector(".product-gallery-stage video")?.readyState>=2');
  assert.equal(await browser.run('(async()=>{window.lastGalleryVideo=document.querySelector(".product-gallery-stage video");await lastGalleryVideo.play();return lastGalleryVideo.paused;})()'),false);
  await browser.run('document.querySelector(".product-gallery-prev").click()');
  assert.equal(await browser.run('lastGalleryVideo.paused'),true);
  for(const width of [1440,768,390]){
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
    await browser.run('document.querySelector(".product-gallery").scrollIntoView({block:"center"})');await browser.pause(120);
    const bounds=await browser.run(`(()=>{const modal=document.querySelector('#productInfoModal .modal-box').getBoundingClientRect();const gallery=document.querySelector('.product-gallery');return {left:modal.left,right:modal.right,width:innerWidth,overflow:gallery.scrollWidth-gallery.clientWidth};})()`);
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.overflow<=1,JSON.stringify(bounds));
    const imageFit=await browser.run(`(()=>{const stage=document.querySelector('.product-gallery-stage').getBoundingClientRect();const image=document.querySelector('.product-gallery-stage img').getBoundingClientRect();return {stageHeight:stage.height,imageHeight:image.height,stageWidth:stage.width,imageWidth:image.width};})()`);
    assert.ok(imageFit.imageHeight<=imageFit.stageHeight+1&&imageFit.imageWidth<=imageFit.stageWidth+1,JSON.stringify(imageFit));
    await screenshot(browser,`customer-${width}`);
  }
  await browser.run('document.querySelector(".product-gallery-next").click()');await browser.until('document.querySelector(".product-gallery-stage video")?.readyState>=2');
  await browser.run('(async()=>{window.lastGalleryVideo=document.querySelector(".product-gallery-stage video");await lastGalleryVideo.play();document.getElementById("closeProductInfoModal").click()})()');
  assert.equal(await browser.run('lastGalleryVideo.paused'),true);
  assert.equal(await browser.run('document.activeElement.dataset.action'),'view-info');
  state.failGallery=true;await browser.run('document.querySelector("[data-action=view-info]").click()');await browser.until('!document.querySelector(".product-gallery-retry").hidden');
  assert.equal(await browser.run('!!document.querySelector(".product-gallery-stage img")'),true);
  state.failGallery=false;await browser.run('document.querySelector(".product-gallery-retry").click()');await browser.until('document.querySelectorAll(".product-gallery-thumb").length===3');
  await browser.run('document.getElementById("productInfoReviews").click()');
  await browser.until('document.querySelector("[data-review-media]")');await browser.run('document.querySelector("[data-review-media]").click()');
  assert.equal(await browser.run('document.querySelector(".product-lightbox-navigation").hidden'),true);
  state.product={...initial(),media_count:1,cover:'legacy',media:[{id:'legacy',type:'image',name:'Current product photo',url:'/images/3Dprint.png'}]};
  await navigate(browser,'/products-page/product.html');await browser.run('document.querySelector("[data-action=view-info]").click()');
  await browser.until('document.querySelector(".product-gallery-count").textContent==="1 / 1"');
  assert.equal(await browser.run('document.querySelector(".product-gallery-thumbs").hidden'),true);
  state.product={...initial(),media_count:0,image_data:null,cover:null,media:[]};
  await navigate(browser,'/products-page/product.html');await browser.run('document.querySelector("[data-action=view-info]").click()');
  await browser.until('document.querySelector(".product-gallery-stage").textContent.includes("No product photos")');
  assert.equal(await browser.run('document.querySelector(".product-gallery-toolbar").hidden'),true);
  assert.deepEqual(await browser.run('fixtureErrors'),[]);
});
