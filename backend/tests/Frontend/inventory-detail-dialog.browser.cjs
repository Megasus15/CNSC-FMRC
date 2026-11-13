const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Inventory detail pilot preserves data, modal-only scrolling, focus and edit safeguards in both portals', {skip: !chrome, timeout: 180000}, async t => {
  const variants = Array.from({length: 13}, (_, i) => ({id: 101 + i, name: `Variant ${i + 1}`, unit: i % 2 ? 'box' : 'pcs', on_hand: i === 1 ? null : i,
    initial_on_hand: 25, description: i === 0 ? 'Long variant detail. '.repeat(25) : 'A variant description.', remarks: i === 0 ? 'Restock soon' : ''}));
  const items = [
    {id: 1, item_name: 'Pencil', category: 'Consumable Materials', unit: 'pcs', on_hand: 5, status: 'Low Stock', remarks: '', description: '', variants: []},
    {id: 2, item_name: 'A long <b>literal</b> inventory name '.repeat(6), category: 'Office Supplies', unit: 'pcs', on_hand: 0, status: 'Out of Stock', remarks: 'Restock after review', description: 'First paragraph <script>literal text</script>.\n\n' + 'Detailed inventory description.\n'.repeat(80), variants: []},
    {id: 3, item_name: 'Mixed-unit supplies', category: 'Consumable Materials', unit: null, on_hand: null, status: null, remarks: 'Parent remarks remain visible.', description: 'Parent description remains visible.', has_variants: true, variants},
    {id: 4, item_name: 'Missing details', category: 'Inventory Tools', unit: null, on_hand: null, status: null, variants: []},
    ...Array.from({length: 24}, (_, i) => ({id: i + 10, item_name: `Stock item ${i}`, category: i % 2 ? 'Inventory Tools' : 'Office Supplies', unit: 'pcs', on_hand: 12, status: 'Good', variants: []})),
  ];
  let failSave = false, saves = 0;
  const font = process.env.FMRC_BROWSER_POPPINS;
  const setup = `{
    const oldFetch=window.fetch;window.fetch=(input,init)=>oldFetch(typeof input==='string'?input.replace(/^http:\\/\\/(?:localhost|127\\.0\\.0\\.1):8000\\/api/,window.APP_API_BASE_URL):input,init);
    ${font ? `const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);` : ''}
  }`;
  const h = await browserFixture(t, async ({req, route, json}) => {
    if (route === '/api/admin/inventory') { json({data: items, summary: {total_items: items.length, good: 24, low_stock: 3}}); return true; }
    if (route === '/api/admin/inventory/stock-rules') { json({data: {global: {mode: 'fixed', threshold: 5}, categories: {}, items: {}, variants: {}}}); return true; }
    if (/^\/api\/admin\/inventory\/\d+$/.test(route) && req.method === 'PUT') {
      saves++; json(failSave ? {message: 'Temporary inventory save failure.'} : {message: 'Saved', data: items[0]}, failSave ? 503 : 200); return true;
    }
    return false;
  }, {setup});
  await h.send('Network.setBlockedURLs', {urls: ['https://*']});
  const key = async value => {await h.send('Input.dispatchKeyEvent', {type: 'keyDown', key: value, windowsVirtualKeyCode: {Escape: 27, Tab: 9, PageDown: 34}[value]}); await h.send('Input.dispatchKeyEvent', {type: 'keyUp', key: value});};
  const open = async id => {
    await h.run(`document.querySelector('[data-inv-view="${id}"]').scrollIntoView({block:'center',behavior:'instant'});document.querySelector('[data-inv-view="${id}"]').click()`);
    await h.until(`document.querySelector('#modalViewInventoryItem.show') && document.body.style.position==='fixed'`);
    await h.run(`Promise.all(document.getElementById('modalViewInventoryItem').getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
  };
  const close = async () => {await h.run(`document.getElementById('btnCloseViewInv').click()`); await h.until(`!document.querySelector('#modalViewInventoryItem.show') && document.body.style.position!== 'fixed'`);};
  const viewport = async (width, height = 900, scale = 1) => {await h.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: scale, mobile: false}); await h.pause(180);};
  const geometry = () => h.run(`(()=>{const r=document.getElementById('modalViewInventoryItem'),c=r.querySelector('.portal-detail-dialog__card'),b=document.getElementById('invViewBody'),head=r.querySelector('header'),foot=r.querySelector('footer'),rect=n=>{const q=n.getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right};};return {card:rect(c),head:rect(head),body:rect(b),foot:rect(foot),bodyOverflow:b.scrollWidth>b.clientWidth+1,frameOverflow:c.scrollHeight>c.clientHeight+1,overlayOverflow:r.scrollHeight>r.clientHeight+1,root:getComputedStyle(document.documentElement).overflowY,backgroundInert:document.querySelector('.dashboard-container').inert,radius:getComputedStyle(c).borderRadius,title:getComputedStyle(document.getElementById('invViewHeading')).fontSize,table:getComputedStyle(r.querySelector('.inv-detail-table-frame')||b).display,cards:getComputedStyle(r.querySelector('.inv-detail-variant-cards')||b).display};})()`);
  for (const role of ['admin', 'staff']) {
    await viewport(1440);
    await h.go(`/${role}-page/inventory.html`);
    await h.until(`document.querySelector('[data-inv-view="1"]') && !document.querySelector('.admin-global-page-skeleton')`);
    if (font) await h.run('document.fonts.ready');
    const normalModalRadius = await h.run(`getComputedStyle(document.querySelector('#modalDeductInventoryItem .modal-card')).borderRadius`);
    await open(1);
    assert.equal(await h.run(`document.getElementById('invViewHeading').textContent`), 'Item details');
    assert.equal(await h.run(`document.getElementById('invViewTitle').textContent`), 'Pencil');
    assert.equal(await h.run(`document.querySelector('.inv-detail-quantity').textContent`), '5');
    assert.match(await h.run(`document.getElementById('invViewContent').textContent`), /No description added\.[\s\S]*No remarks added\.[\s\S]*This item has no variants\./);
    assert.equal(await h.run(`document.activeElement.id`), 'invViewHeading');
    await h.run(`window.showAdminPopup('A nested inventory message.',{title:'Inventory message',type:'error'})`);
    await h.until(`document.getElementById('adminSystemPopup').classList.contains('show') && document.getElementById('modalViewInventoryItem').inert`);
    assert.equal(await h.run(`document.body.style.position`), 'fixed');
    await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    await h.until(`!document.getElementById('modalViewInventoryItem').inert`);
    await h.run(`document.getElementById('modalViewInventoryItem').click()`);
    assert.equal(await h.run(`document.getElementById('modalViewInventoryItem').classList.contains('show')`), true, 'Backdrop keeps explicit closing');
    await close();
    assert.equal(await h.run(`document.activeElement.getAttribute('data-inv-view')`), '1');

    for (const theme of ['light', 'dark']) for (const width of [320, 390, 768, 1024, 1440]) {
      await viewport(width);
      await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await h.run(`document.querySelector('[data-inv-view="2"]').scrollIntoView({block:'center',behavior:'instant'});window.fixturePageY=scrollY;window.fixtureHeaderRight=document.querySelector('.top-header').getBoundingClientRect().right`);
      await open(2);
      const g = await geometry();
      assert(g.card.left>=0 && g.card.right<=width && g.card.top>=0 && g.card.bottom<=900, `${role} ${theme} ${width}: frame fits`);
      assert(g.head.bottom<=g.body.top+1 && g.foot.top>=g.body.bottom-1 && g.foot.bottom<=900, 'Header and footer remain outside the scroll body');
      assert(!g.bodyOverflow && !g.frameOverflow && !g.overlayOverflow && g.backgroundInert && g.root==='hidden', JSON.stringify(g));
      assert.equal(g.radius, '12px');
      assert.equal(await h.run(`document.querySelector('.inv-detail-quantity').textContent`), '0', 'Zero is a real stock quantity');
      assert.equal(await h.run(`document.querySelector('#invViewContent script,#invViewTitle b')`), null, 'Inventory text stays literal');
      const before = {head: g.head.top, foot: g.foot.top};
      await h.run(`document.getElementById('invViewBody').scrollTop=1000`);
      const after = await geometry();
      assert.equal(after.head.top, before.head); assert.equal(after.foot.top, before.foot);
      assert((await h.run(`document.getElementById('invViewBody').scrollTop`))>0);
      assert.equal(await h.run(`Math.abs(document.querySelector('.top-header').getBoundingClientRect().right-fixtureHeaderRight)<2`), true, 'Scrollbar removal does not move the page header');
      await h.run(`document.getElementById('btnEditFromViewInv').focus()`); await key('Tab');
      assert.equal(await h.run(`document.activeElement.matches('[data-portal-detail-close]')`), true, 'Tab stays inside View Item');
      if ([390,1440].includes(width)) { await h.run(`document.getElementById('invViewBody').scrollTop=0`); await h.shot(`inventory-${role}-${theme}-${width}-long`); }
      await key('Escape'); await h.until(`document.body.style.position!== 'fixed'`);
      assert.equal(await h.run(`Math.abs(scrollY-fixturePageY)<2`), true, 'Closing restores exact page position');
      assert.equal(await h.run(`document.querySelector('.dashboard-container').inert`), false);
      assert.equal(await h.run(`document.activeElement.getAttribute('data-inv-view')`), '2');
    }
    await viewport(1440);
    await open(3);
    assert.equal(await h.run(`document.querySelector('.inv-detail-quantity')`), null, 'Mixed units never produce a combined stock figure');
    assert.match(await h.run(`document.getElementById('invViewContent').textContent`), /Stock is tracked separately for each variant\./);
    for (const width of [320, 390, 639, 640, 768, 1440]) {
      await viewport(width);
      const g = await geometry();
      assert.equal(g.table==='none', width<640); assert.equal(g.cards==='none', width>=640);
      assert(!g.bodyOverflow && !g.frameOverflow && !g.overlayOverflow, `${width}: variants have no nested scrollbars`);
    }
    assert.equal(await h.run(`document.querySelector('.inv-detail-table tbody tr:first-child td:nth-child(4)').textContent`), '0');
    assert.equal(await h.run(`document.querySelector('.inv-detail-table tbody tr:nth-child(2) td:nth-child(4)').textContent`), 'Not provided');
    assert.equal(await h.run(`document.querySelector('.inv-detail-table tbody tr:nth-child(2) td:nth-child(5)').textContent`), 'Not provided');
    await h.run(`document.querySelector('[data-inv-view-variant-next]').click()`);
    assert.match(await h.run(`document.querySelector('.inv-detail-table tbody tr:first-child').textContent`), /Variant 11/);
    assert.equal(await h.run(`document.querySelector('[data-inv-view-variant-page]').value`), '2');
    await h.run(`document.querySelector('[data-inv-view-variant-prev]').click()`);
    await viewport(852,393);
    let g = await geometry(); assert(g.card.bottom<=393 && g.body.bottom>g.body.top+30 && g.foot.bottom<=393);
    await viewport(720,450,2); g=await geometry(); assert(!g.bodyOverflow && g.card.right<=720 && g.card.bottom<=450, '200% zoom-sized viewport remains usable');
    await close();
    await viewport(1440);
    await open(4);
    assert.equal(await h.run(`document.querySelector('.inv-detail-quantity').textContent`), 'Not provided', 'Missing stock is not zero');
    await close();

    await open(1);
    await h.send('Emulation.setEmulatedMedia', {features: [{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await h.run(`getComputedStyle(document.querySelector('.portal-detail-dialog__card')).animationName`), 'none');
    await h.send('Emulation.setEmulatedMedia', {features: []});
    await h.run(`document.getElementById('btnEditFromViewInv').click()`);
    await h.until(`document.querySelector('#modalAddInventoryItem.show') && !document.querySelector('#modalViewInventoryItem.show')`);
    assert.equal(await h.run(`document.body.style.position`), 'fixed', 'View-to-Edit keeps the lock');
    assert.equal(await h.run(`document.getElementById('invFormItemName').value`), 'Pencil');
    await h.run(`document.getElementById('invFormItemName').value='Unsaved pencil';document.getElementById('invFormItemName').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('btnCancelInvForm').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Discard changes?'`);
    assert.equal(await h.run(`document.body.style.position`), 'fixed');
    await h.run(`document.getElementById('adminSystemPopupCancel').click()`);
    assert.equal(await h.run(`document.getElementById('invFormItemName').value`), 'Unsaved pencil');
    failSave=true;
    await h.run(`document.getElementById('btnSaveInvForm').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Save Failed'`);
    assert.equal(await h.run(`document.body.style.position`), 'fixed');
    assert.equal(await h.run(`document.getElementById('invFormItemName').value`), 'Unsaved pencil');
    failSave=false;
    await h.run(`document.getElementById('adminSystemPopupOk').click();document.getElementById('btnCancelInvForm').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Discard changes?'`);
    await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    await h.until(`document.body.style.position!== 'fixed'`);
    assert.equal(await h.run(`document.activeElement.getAttribute('data-inv-view')`), '1');
    assert.equal(await h.run(`getComputedStyle(document.querySelector('#modalDeductInventoryItem .modal-card')).borderRadius`),normalModalRadius,'Other modal styles are unchanged');
    await viewport(1440); await h.run(`document.documentElement.dataset.theme='light'`); await open(1); await h.shot(`inventory-${role}-light-1440-simple`); await close();
    await viewport(390); await h.run(`document.documentElement.dataset.theme='dark'`); await open(3); await h.shot(`inventory-${role}-dark-390-variants`); await close();
    assert.deepEqual(await h.run('fixtureErrors'), []);
  }
  assert.equal(saves,2,'One failed save per portal, with no accidental write from View Item');
  console.log('Inventory pilot screenshots:', h.artifacts);
});
