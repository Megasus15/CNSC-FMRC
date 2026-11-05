const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Customer and Team pages have no retired workflow and retain Services, Orders and appointments', {skip: !chrome, timeout: 150000}, async t => {
  const calls = [];
  const service = {id: 7, title: '3D Printing', category: 'Prototyping', description: 'Fabrication services', image_data: '', modal_description: 'Service details', modal_features: ['Precision'], modal_materials: ['PLA'], modal_best_for: ['Prototypes'], accepts_custom_requests: true};
  const h = await browserFixture(t, ({route, json}) => {
    calls.push(route);
    if (route === '/api/services' || route === '/api/admin/services') { json({data: [service]}); return true; }
    if (route === '/api/products') { json({data: [{id: 7, name: 'Printed enclosure', category: '3D Print', description: 'Product', stock: 5, price: 100, unit_price: 100, images: []}]}); return true; }
    if (route === '/api/customer/profile') { json({data: {id: 8, name: 'Customer', username: 'fixture', email: 'customer@example.test', role: 'customer'}}); return true; }
    if (route === '/api/admin/orders') { json({incoming: [], directory: [], payments: [], returns: []}); return true; }
    if (route === '/api/admin/gateway-payments') { json({payments: {data: [], current_page: 1, last_page: 1, total: 0}, refunds: [], attempts: [], receipts: []}); return true; }
    return false;
  });
  await h.send('Page.addScriptToEvaluateOnNewDocument', {source: `
    localStorage.setItem('customer_token','fixture-customer');
    localStorage.setItem('customer_info',JSON.stringify({id:8,name:'Customer',email:'customer@example.test'}));
    // The existing catalog uses port 8000 locally. Keep this test's requests
    // inside its isolated server without changing production API resolution.
    const fixtureFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.hostname === location.hostname && url.port === '8000' && url.pathname.startsWith('/api/')) {
        const target = location.origin + url.pathname + url.search;
        input = input instanceof Request ? new Request(target, input) : target;
      }
      return fixtureFetch(input, options);
    };
  `});
  const absent = async () => {
    assert.equal(await h.run("!!document.querySelector('[data-custom-manager], [data-custom-products], .cp-entry, #svcAcceptsCustom, #customSalesType, #sectionCustomRequests, #sectionCustom_request')"), false);
    assert.equal(await h.run("[...document.querySelectorAll('a,script[src],link[href]')].some(node => /custom-products|custom_requests|custom-product-metrics/.test(node.getAttribute('href') || node.getAttribute('src') || ''))"), false);
    assert.deepEqual(await h.run('fixtureErrors'), []);
  };
  for (const prefix of ['/', '/apps/customer/']) {
    for (const [page, ready] of [
      ['products-page/product.html', "!!document.querySelector('.shop-card')"],
      ['services-page/service.html', "!!document.querySelector('.service-card')"],
    ]) {
      await h.go(prefix + page);
      await h.until(ready);
      await h.until("!!document.getElementById('viewAppointmentsBtn')");
      await absent();
      for (const width of [1440, 960, 390]) {
        await h.send('Emulation.setDeviceMetricsOverride', {width, height: 950, deviceScaleFactor: 1, mobile: width === 390});
        await h.pause(350);
        assert(await h.run('document.documentElement.scrollWidth <= innerWidth + 1'), page + ' fits ' + width);
        await h.shot((prefix === '/' ? 'normal-' : 'pwa-') + page.split('/')[0] + '-' + width);
      }
    }
  }
  for (const portal of ['admin-page', 'staff-page']) {
    const prefix = portal === 'staff-page' ? '/apps/team/' : '/';
    await h.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 950, deviceScaleFactor: 1, mobile: false});
    await h.go(prefix + portal + '/orders.html');
    await h.until("document.querySelectorAll('#ordersModuleTabs > button').length === 5 && !document.querySelector('#ordersModuleTabs').closest('[inert]')");
    await absent();
    await h.go(prefix + portal + '/archives.html');
    await h.until("document.querySelectorAll('#archivesModuleTabs > button').length === 9 && !document.querySelector('#archivesModuleTabs').closest('[inert]')");
    await absent();
    for (const theme of ['light', 'dark']) {
      await h.run(`document.documentElement.dataset.theme = '${theme}'`);
      await h.pause(350);
      await h.shot(portal + '-archives-' + theme);
    }
    await h.go(prefix + portal + '/website-services.html');
    await h.until('servicesLoaded && copyLoaded && categoriesLoaded');
    await absent();
    assert(await h.run("!!copyFields.get('editorial_services_title') && pageDraft && !pageDraft.isDirty()"));
    await h.run('openEdit(7)');
    await h.until("document.getElementById('serviceModal').classList.contains('show')");
    assert.equal(await h.run("document.getElementById('svcTitle').value"), '3D Printing');
    await absent();
    await h.shot(portal + '-service-editor');
  }
  assert.equal(calls.some(route => /custom-requests|custom-products/.test(route)), false);
  t.diagnostic('Removal screenshots: ' + h.artifacts);
});
