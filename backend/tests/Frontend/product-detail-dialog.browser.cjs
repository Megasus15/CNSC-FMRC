const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Product details shares the Inventory dialog across Admin and the dynamic Staff loader', {skip: !chrome, timeout: 180000}, async t => {
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#fffdf8"/><g fill="#e9dfcc" stroke="#ae9771" stroke-width="4"><circle cx="175" cy="135" r="72"/><circle cx="345" cy="135" r="72"/><circle cx="260" cy="290" r="72"/><circle cx="430" cy="290" r="72"/></g><g fill="none" stroke="#6b202b" stroke-width="3"><circle cx="175" cy="135" r="53"/><circle cx="345" cy="135" r="53"/><circle cx="260" cy="290" r="53"/><circle cx="430" cy="290" r="53"/></g></svg>');
  const base = {id: 1, name: 'Engraved Coaster', category: 'Laser Cut', code: 'ENG-CS001', stock: 461, price: 150, stock_status: 'in_stock', is_blocked: false, image_data: image,
    summary: 'Custom engraving for thoughtful gifts and everyday essentials. Pricing depends on the size, design and production requirements.', details_chips: ['Personalized engraving', 'Made to order'], availability: ['Available while supplies last'], recommended_for: ['Events and personalized gifts'], media: [{id:'cover',type:'image',url:image}]};
  const products = [base,
    {...base, id: 2, name: 'A long <b>literal</b> product & name '.repeat(5), code: 'LONG'.repeat(30), stock: 0, price: 0, stock_status: 'out_of_stock', is_blocked: true,
      summary: 'First paragraph <script>literal text</script>.\n\n' + 'A detailed product summary.\n'.repeat(80), details_chips: ['Long detail '.repeat(20), '<i>Literal detail</i>'], availability: ['A'.repeat(180)], recommended_for: ['First group\nSecond group']},
    {...base, id: 3, name: 'Missing details', code: null, stock: null, price: null, image_data: null, stock_status: null, summary: '', details_chips: [], availability: [], recommended_for: [], media: []},
    {...base, id: 4, name: 'Unavailable image', image_data: '/fixtures/missing-product.png'},
    ...Array.from({length: 12}, (_, i) => ({...base, id: i + 10, name: `Sample product ${i}`})),
  ];
  let writes = 0;
  const font = process.env.FMRC_BROWSER_POPPINS;
  const setup = `{
    const originalFetch=window.fetch;window.fetch=(input,init)=>originalFetch(typeof input==='string'?input.replace(/^http:\\/\\/(?:localhost|127\\.0\\.0\\.1):8000\\/api/,window.APP_API_BASE_URL):input,init);
    ${font ? `const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);` : ''}
  }`;
  const h = await browserFixture(t, ({req, route, json}) => {
    if (route === '/api/admin/products') { json({data: products}); return true; }
    if (route === '/api/admin/products/1' && req.method === 'PUT') { writes++; json({message: 'Temporary product save failure.'}, 503); return true; }
    return false;
  }, {setup});
  await h.send('Network.setBlockedURLs', {urls: ['https://*']});
  const viewport = async (width, height = 900) => {await h.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}); await h.pause(100);};
  const key = async key => {await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,windowsVirtualKeyCode:{Tab:9,Escape:27,PageDown:34}[key]});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
  const click = selector => h.run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const open = async id => {
    await h.run(`document.querySelector('[data-view-id="${id}"]').scrollIntoView({block:'center',behavior:'instant'});window.originalProductPageY=scrollY;window.originalProductHeaderRight=document.querySelector('.top-header').getBoundingClientRect().right;document.querySelector('[data-view-id="${id}"]').click()`);
    await h.until(`document.querySelector('#modalViewProduct.show') && document.body.style.position==='fixed'`);
    await h.run(`Promise.all(document.getElementById('modalViewProduct').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))`);
  };
  const closed = () => h.until(`!document.querySelector('#modalViewProduct.show') && document.body.style.position!=='fixed'`);
  const geometry = () => h.run(`(()=>{const r=document.getElementById('modalViewProduct'),c=r.querySelector('.portal-detail-dialog__card'),b=document.getElementById('viewProductBody'),rect=n=>{const q=n.getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right};};return{card:rect(c),head:rect(r.querySelector('header')),foot:rect(r.querySelector('footer')),body:rect(b),overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1||r.scrollHeight>r.clientHeight+1,locked:getComputedStyle(document.documentElement).overflowY==='hidden',inert:document.querySelector('.dashboard-container').inert,radius:getComputedStyle(c).borderRadius};})()`);
  for (const role of ['admin', 'staff']) {
    await viewport(1440); await h.go(`/${role}-page/products.html`);
    await h.until(`document.querySelector('[data-view-id="1"]') && !document.querySelector('.admin-global-page-skeleton')`);
    if (font) await h.run('document.fonts.ready');
    const otherRadius = await h.run(`getComputedStyle(document.querySelector('#modalAddProduct .modal-card')).borderRadius`);
    await open(1);
    assert.equal(await h.run(`document.activeElement.id`),'viewProductHeading');
    assert.equal(await h.run(`document.getElementById('viewProductTitle').textContent`),base.name);
    await h.until(`document.querySelector('.product-detail-media img')?.naturalWidth>0 && !document.querySelector('.product-detail-media img').hidden`);
    assert.equal(await h.run(`getComputedStyle(document.querySelector('.product-detail-media img')).objectFit`),'contain');
    assert.match(await h.run(`document.getElementById('viewProductContent').textContent`),/461[\s\S]*In Stock[\s\S]*₱150.00[\s\S]*ENG-CS001[\s\S]*Active/);
    await click('#modalViewProduct'); assert.equal(await h.run(`document.getElementById('modalViewProduct').classList.contains('show')`),true);
    await h.run(`showAdminPopup('A product message.',{title:'Product message',type:'error'})`);
    await h.until(`document.querySelector('#adminSystemPopup.show') && document.getElementById('modalViewProduct').inert`);
    await click('#adminSystemPopupOk'); await h.until(`!document.getElementById('modalViewProduct').inert`);
    await click('[data-portal-detail-close]'); await closed();
    assert.equal(await h.run(`document.activeElement.getAttribute('data-view-id')`),'1');
    for (const theme of ['light','dark']) for (const width of [320,390,768,1024,1440]) {
      await viewport(width); await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await open(2);
      const g = await geometry();
      assert(g.card.left>=0&&g.card.right<=width&&g.card.top>=0&&g.card.bottom<=900,`${role} ${theme} ${width}: frame fits`);
      assert(!g.overflow&&g.locked&&g.inert&&g.radius==='12px',JSON.stringify(g));
      assert(g.head.bottom<=g.body.top+1&&g.foot.top>=g.body.bottom-1,'Only the body scrolls');
      assert.equal(await h.run(`document.querySelector('.portal-detail-quantity').textContent`),'0');
      assert.equal(await h.run(`document.querySelector('.product-detail-price').textContent`),'₱0.00');
      assert.equal(await h.run(`document.getElementById('viewProductTitle').textContent`),products[1].name);
      assert.equal(await h.run(`document.querySelector('#viewProductTitle b,#viewProductContent script,#viewProductContent i')`),null);
      await h.run(`document.getElementById('viewProductBody').focus()`); await key('PageDown');
      assert((await h.run(`document.getElementById('viewProductBody').scrollTop`))>0,'Keyboard scrolls the content');
      const after = await geometry(); assert.equal(after.head.top,g.head.top); assert.equal(after.foot.top,g.foot.top);
      assert.equal(await h.run(`Math.abs(document.querySelector('.top-header').getBoundingClientRect().right-originalProductHeaderRight)<2`),true);
      await h.run(`document.getElementById('btnOpenEditFromView').focus()`); await key('Tab');
      assert.equal(await h.run(`document.activeElement.matches('[data-portal-detail-close]')`),true);
      await key('Escape'); await closed();
      assert.equal(await h.run(`Math.abs(scrollY-originalProductPageY)<2`),true);
      assert.equal(await h.run(`document.activeElement.getAttribute('data-view-id')`),'2');
    }
    await viewport(852,393); await open(2); let g=await geometry(); assert(g.card.bottom<=393&&g.body.bottom>g.body.top+30); await click('#btnCloseViewProduct'); await closed();
    await viewport(1440); await open(3);
    assert.match(await h.run(`document.getElementById('viewProductContent').textContent`),/No product image added\.[\s\S]*Not provided[\s\S]*No summary added\.[\s\S]*No product details added\.[\s\S]*No availability added\.[\s\S]*No recommendations added\./);
    await click('#btnCloseViewProduct'); await closed(); await open(4);
    await h.until(`document.querySelector('.product-detail-media-state').textContent.includes('could not load')`);
    await click('#btnCloseViewProduct'); await closed();
    for (const [width,theme] of [[1440,'light'],[390,'light'],[390,'dark']]) {
      await viewport(width); await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await open(1);
      await h.until(`!document.querySelector('.product-detail-media img').hidden`); await h.shot(`product-${role}-${theme}-${width}`);
      await click('#btnCloseViewProduct'); await closed();
    }
    await viewport(1440); await open(1);
    await click('#btnOpenEditFromView');
    await h.until(`document.querySelector('#modalEditProduct.show') && !document.getElementById('btnUpdateProduct').disabled`);
    assert.equal(await h.run(`document.body.style.position`),'fixed');
    assert.equal(await h.run(`document.querySelectorAll('#editProductGallery .product-gallery-slot').length`),5);
    await h.run(`document.getElementById('editProductName').value='Unsaved coaster';document.getElementById('editProductName').dispatchEvent(new Event('input',{bubbles:true}))`);
    await click('#btnCancelEditProduct'); await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Discard changes?'`);
    await click('#adminSystemPopupCancel'); assert.equal(await h.run(`document.getElementById('editProductName').value`),'Unsaved coaster');
    await click('#btnUpdateProduct'); await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Update Failed'`);
    assert.equal(await h.run(`document.body.style.position`),'fixed'); assert.equal(await h.run(`document.getElementById('editProductName').value`),'Unsaved coaster');
    await click('#adminSystemPopupOk'); await click('#btnCancelEditProduct'); await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Discard changes?'`);
    await click('#adminSystemPopupOk'); await closed();
    assert.equal(await h.run(`document.activeElement.getAttribute('data-view-id')`),'1');
    assert.equal(await h.run(`getComputedStyle(document.querySelector('#modalAddProduct .modal-card')).borderRadius`),otherRadius);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  assert.equal(writes,2,'Only the intentional failed edit save writes in each portal');
  console.log('Product detail screenshots:',h.artifacts);
});
