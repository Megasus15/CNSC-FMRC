const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('Portal table filters, ranges and empty states share the same layout', {skip:!chrome,timeout:120000}, async t=>{
  const h = await browserFixture(t, async ({route,json}) => {
    if (route === '/api/admin/products') {
      json({data:Array.from({length:11},(_,i)=>({id:i+1,name:'Fixture '+String(i+1).padStart(2,'0'),category:'3D Print',code:'P-'+i,stock:5,price:100,stock_status:'in_stock'}))});return true;
    }
    if (route === '/api/services') { json({data:[]});return true; }
    if (route === '/api/admin/gateway-payments') { json({payments:{data:[],current_page:1,last_page:1,total:0},refunds:[],attempts:[],receipts:[]});return true; }
    return false;
  });
  for (const portal of ['admin-page','staff-page']) {
    await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await h.go('/'+portal+'/products.html');
    await h.until("document.getElementById('productTableMeta').textContent === 'Page 1 of 2 • Showing 1–10 of 11'");
    await h.until("!document.getElementById('productSearchInput').closest('[inert]')");
    assert.deepEqual(await h.run("[AdminTablePagination.label(2,11),AdminTablePagination.label(2,21,20),AdminTablePagination.label(1,0)]"),[
      'Page 2 of 2 • Showing 11–11 of 11','Page 2 of 2 • Showing 21–21 of 21','Page 1 of 1 • Showing 0–0 of 0',
    ]);
    assert.equal(await h.run(`(() => {
      const header=document.getElementById('productTable').closest('.panel').querySelector('.panel-header');
      const tools=header.querySelector('.filters-row');
      return Math.abs(header.getBoundingClientRect().right-tools.getBoundingClientRect().right)<2 && !header.querySelector('.portal-table-count');
    })()`),true,portal+' product filters align to the right');
    await h.run("document.querySelector('#productTableFooter .page-btn:last-child').click()");
    await h.until("document.getElementById('productTableMeta').textContent === 'Page 2 of 2 • Showing 11–11 of 11'");
    await h.run("const field=document.getElementById('productSearchInput');field.value='missing product';field.dispatchEvent(new Event('input',{bubbles:true}))");
    await h.until("document.getElementById('productTableMeta').textContent === 'Page 1 of 1 • Showing 0–0 of 0'");
    assert.notEqual(await h.run("getComputedStyle(document.getElementById('productTableFooter')).display"),'none');
    await h.run("document.getElementById('productTable').closest('.panel').scrollIntoView({block:'center',behavior:'instant'})");
    await h.shot(portal+'-product-list-filters');
    await h.go('/'+portal+'/orders.html');
    await h.until("!!document.querySelector('#ordersDirectoryTable .table-empty-state')");
    await h.until("!document.querySelector('#ordersDirectoryTable').closest('[inert]')");
    assert.equal(await h.run("document.querySelector('#ordersDirectoryFooter .table-footer-meta').textContent"),'Page 1 of 1 • Showing 0–0 of 0');
    assert.equal(await h.run("getComputedStyle(document.querySelector('#incomingOrdersTable .table-empty-state')).fontSize === getComputedStyle(document.querySelector('#ordersDirectoryTable .table-empty-state')).fontSize"),true);
    assert.equal(await h.run("document.querySelector('.incoming-urgent').parentElement.matches('h3')"),true);
    assert.equal(await h.run("document.querySelectorAll('.incoming-subtitle').length"),1);
    for (const theme of ['light','dark']) {
      await h.run(`document.documentElement.dataset.theme='${theme}'`);
      await h.shot(portal+'-orders-empty-'+theme);
    }
  }
  t.diagnostic('Table layout screenshots: '+h.artifacts);
});

test('Orders and Archives section tabs use balanced rows at portal widths', {skip:!chrome,timeout:120000}, async t=>{
  const h = await browserFixture(t, ({route,json})=>{if(route==='/api/admin/gateway-payments'){json({payments:{data:[],current_page:1,last_page:1,total:0},refunds:[],attempts:[],receipts:[]});return true;}return false;});
  const rowSizes = id => h.run(`(() => {
    const rows = new Map();
    for (const button of document.querySelectorAll('#${id} > button')) {
      const top = Math.round(button.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) || 0) + 1);
    }
    return [...rows.values()];
  })()`);
  for (const portal of ['admin-page', 'staff-page']) {
    const base = portal === 'staff-page' ? '/apps/team/staff-page/' : '/admin-page/';
    for (const [page, id, count, desktop, tablet] of [
      ['orders', 'ordersModuleTabs', 5, [5], [3, 2]],
      ['archives', 'archivesModuleTabs', 9, [5, 4], [3, 3, 3]],
    ]) {
      await h.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
      await h.go(base + page + '.html');
      await h.until(`document.querySelectorAll('#${id} > button').length === ${count}`);
      await h.until(`!document.getElementById('${id}').closest('[inert]')`);
      assert.deepEqual(await rowSizes(id), desktop, portal + ' ' + page + ' desktop');
      await h.shot(portal + '-' + page + '-desktop');
      await h.send('Emulation.setDeviceMetricsOverride',{width:960,height:900,deviceScaleFactor:1,mobile:false});
      await h.pause(350);
      assert.deepEqual(await rowSizes(id), tablet, portal + ' ' + page + ' tablet');
      await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await h.pause(350);
      assert.deepEqual(await rowSizes(id), count === 5 ? [2, 2, 1] : [2, 2, 2, 2, 1], portal + ' ' + page + ' phone');
    }
  }
  t.diagnostic('Section navigation screenshots: ' + h.artifacts);
});

