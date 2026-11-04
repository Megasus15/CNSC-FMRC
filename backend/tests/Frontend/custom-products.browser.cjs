const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('Operators archive closed requests, restore them and use the main Refresh only', {skip:!chrome,timeout:90000}, async t=>{
  let archived = false, reads = 0;
  const row={id:12,reference:'CUS-000012',title:'Closed request',service:{title:'3D Printing'},customer_name:'Customer',status:'cancelled',status_label:'Cancelled',revision:2,can_archive:true,updated_at:'2026-11-04T04:00:00Z'};
  const h=await browserFixture(t, async ({req,route,json})=>{
    if(route==='/api/services'){json({data:[]});return true;}
    if(route==='/api/admin/custom-requests'){reads++;json({data:archived?[]:[row],current_page:1,last_page:1,total:archived?0:1,counts:{cancelled:archived?0:1}});return true;}
    if(route==='/api/admin/custom-requests/12'){json({data:{...row,specifications:{title:row.title,quantity:1},orders:[],quotes:[],attachments:[],messages:[],events:[],actions:{}}});return true;}
    if(route==='/api/admin/custom-requests/12/archive'){archived=true;json({data:{...row,is_archived:true},message:'Archived'});return true;}
    if(route==='/api/admin/archives'){json({custom_requests:archived?[{...row,source_id:12,service:'3D Printing',archived_at:row.updated_at}]:[]});return true;}
    if(route==='/api/admin/archives/restore-bulk'){archived=false;json({processed_ids:[12],processed_count:1,skipped_ids:[],message:'Request restored.'});return true;}
    return false;
  });
  for(const portal of ['admin-page','staff-page']){
    archived=false;
    await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await h.go('/'+portal+'/orders.html?custom_requests=1');
    await h.until("document.querySelector('[data-custom-archive]') && !document.querySelector('[data-custom-archive]').closest('[inert]')");
    assert.equal(await h.run("!!document.querySelector('#sectionCustomRequests [data-list-filters]')"),true);
    await h.run("document.querySelector('[data-open]').click()");
    await h.until("!!document.querySelector('.cp-order-dialog[open]')");
    assert.equal(await h.run("Array.from(document.querySelectorAll('.cp-order-dialog button')).some(button=>button.textContent.trim()==='Refresh')"),false);
    await h.run("document.querySelector('.cp-order-dialog [data-cp-modal-close]').click()");
    await h.until("!document.querySelector('.cp-order-dialog[open]')");
    await h.until("!document.querySelector('#sectionCustomRequests [data-custom-products]').hasAttribute('aria-busy')");
    const before=reads;
    await h.run("document.getElementById('ordersRefreshBtn').click()");
    for(let n=0;n<60&&reads===before;n++)await h.pause(50);
    assert(reads>before,portal+' main Refresh updates requests');
    await h.run("document.querySelector('[data-custom-archive]').click()");
    await h.until("document.querySelector('#adminSystemPopup.show')");
    await h.run("document.querySelector('#adminSystemPopupOk').click()");
    await h.until("!!document.querySelector('#customRequestsTable .table-empty-state')");
    await h.go('/'+portal+'/archives.html');
    await h.until("document.getElementById('tabCountCustomRequests')?.textContent==='1'");
    await h.run("document.querySelector('[data-tab=custom_request]').click()");
    await h.until("!document.getElementById('customRequestArchiveTable').closest('[inert]')");
    await h.shot(portal+'-archived-custom-requests');
    assert.equal(await h.run("!!document.querySelector('[data-archive-delete=custom_request]')"),false);
    await h.run("document.querySelector('[data-archive-restore=custom_request]').click()");
    await h.until("document.querySelector('#adminSystemPopup.show')");
    await h.run("document.querySelector('#adminSystemPopupOk').click()");
    await h.until("document.getElementById('tabCountCustomRequests')?.textContent==='0'");
    assert.equal(archived,false);
  }
  t.diagnostic('Custom archive screenshots: '+h.artifacts);
});

test('Portal table filters, ranges and empty states share the same layout', {skip:!chrome,timeout:120000}, async t=>{
  const h = await browserFixture(t, async ({route,json}) => {
    if (route === '/api/admin/products') {
      json({data:Array.from({length:11},(_,i)=>({id:i+1,name:'Fixture '+String(i+1).padStart(2,'0'),category:'3D Print',code:'P-'+i,stock:5,price:100,stock_status:'in_stock'}))});return true;
    }
    if (route === '/api/services') { json({data:[]});return true; }
    if (route === '/api/admin/custom-requests') { json({data:[],current_page:1,last_page:1,total:0,counts:{}});return true; }
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
    await h.go('/'+portal+'/orders.html?custom_requests=1');
    await h.until("!!document.querySelector('#customRequestsTable .table-empty-state')");
    await h.until("!document.querySelector('#customRequestsTable').closest('[inert]')");
    assert.equal(await h.run("document.querySelector('#sectionCustomRequests .table-footer-meta').textContent"),'Page 1 of 1 • Showing 0–0 of 0');
    assert.equal(await h.run("getComputedStyle(document.querySelector('#customRequestsTable .table-empty-state')).fontSize === getComputedStyle(document.querySelector('#ordersDirectoryTable .table-empty-state')).fontSize"),true);
    assert.equal(await h.run("document.querySelector('.incoming-urgent').parentElement.matches('h3')"),true);
    assert.equal(await h.run("document.querySelectorAll('.incoming-subtitle').length"),1);
    for (const theme of ['light','dark']) {
      await h.run(`document.documentElement.dataset.theme='${theme}'`);
      await h.shot(portal+'-custom-empty-'+theme);
    }
  }
  t.diagnostic('Table layout screenshots: '+h.artifacts);
});

test('Orders and Archives section tabs use balanced rows at portal widths', {skip:!chrome,timeout:120000}, async t=>{
  const h = await browserFixture(t);
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
      ['orders', 'ordersModuleTabs', 6, [6], [3, 3]],
      ['archives', 'archivesModuleTabs', 10, [5, 5], [2, 2, 2, 2, 2]],
    ]) {
      await h.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
      await h.go(base + page + '.html');
      await h.until(`document.querySelectorAll('#${id} > button').length === ${count}`);
      await h.until(`!document.getElementById('${id}').closest('[inert]')`);
      assert.deepEqual(await rowSizes(id), desktop, portal + ' ' + page + ' desktop');
      await h.shot(portal + '-' + page + '-desktop');
      await h.send('Emulation.setDeviceMetricsOverride',{width:960,height:900,deviceScaleFactor:1,mobile:false});
      assert.deepEqual(await rowSizes(id), tablet, portal + ' ' + page + ' tablet');
      await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      assert.deepEqual(await rowSizes(id), count === 6 ? [2, 2, 2] : [2, 2, 2, 2, 2], portal + ' ' + page + ' phone');
    }
  }
  t.diagnostic('Section navigation screenshots: ' + h.artifacts);
});

test('Custom requests keep drafts, consent and responsive operator workflows consistent', {skip:!chrome,timeout:180000}, async t=>{
  const spec={title:'Personal enclosure',description:'One design for a custom enclosure',quantity:2,size:'10 x 10 cm',material:'PLA',colors:'Maroon',finish:'Matte',contact_name:'Test Customer',contact_phone:'09171234567',fulfillment_type:'pickup',advice_fields:[]};
  let record={id:1,reference:'CUS-000001',revision:1,status:'submitted',status_label:'Submitted',service_id:7,service:{id:7,title:'3D Printing'},specifications:spec,customer_name:'Test Customer',updated_at:'2026-11-04T04:00:00Z',quotes:[],attachments:[],messages:[],events:[],orders:[],actions:{edit:true,message:true,review:true,quote:true,cancel:true}};
  const writes=[];
  let failFirstSubmit = true;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/customer/profile'){json({data:{id:8,name:'Test Customer',username:'fixture',email:'customer@example.test',role:'customer'}});return true;}
    if(route==='/api/services'){json({data:[{id:7,title:'3D Printing',accepts_custom_requests:true},{id:9,title:'Training',accepts_custom_requests:false}]});return true;}
    if(route==='/api/commerce/policy'){json({data:{version:'POLICY-1',terms_text:'Terms fixture',refund_text:'Refund fixture'}});return true;}
    if(/\/custom-requests(?:\/|$)/.test(route)){
      if(req.method==='GET'){
        if(/\/custom-requests$/.test(route)){
          const search = new URL(req.url, 'http://fixture.test').searchParams.get('search');
          const matches = !search || record.specifications.title.toLowerCase().includes(search.toLowerCase());
          json({data:matches ? [{...record,title:record.specifications.title}] : [],current_page:1,last_page:1,total:Number(matches),counts:{submitted:1}});
        }
        else json({data:record});
      }else{
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body});
        if(route.endsWith('/custom-requests')){
          record={...record,revision:0,status:'draft'};
          json({data:record},201);return true;
        }
        if(route.endsWith('/submit') && failFirstSubmit){
          failFirstSubmit = false;
          json({errors:{expected_revision:['The expected revision field is required.']}},422);return true;
        }
        if(route.endsWith('/cancel')){json({message:'The request could not be updated. Please try again.'},503);return true;}
        if(route.endsWith('/save')||route.endsWith('/submit'))record={...record,revision:record.revision+1,specifications:body.specifications,status:route.endsWith('/submit')?'submitted':'draft'};
        if(route.endsWith('/send_quote')){
          record={...record,revision:record.revision+1,status:'quoted',status_label:'Quotation Ready',actions:{message:true,revision:true},quotes:[{id:11,version:1,status:'sent',snapshot:{specifications:body.specifications,production_days:3,proof_ids:[]},unit_price:500,subtotal:1000,shipping_fee:0,total:1000,expires_at:'2026-11-11T04:00:00Z',can_accept:false}]};
        }
        json({message:'Saved',data:record});
      }return true;
    }
    return false;
  });
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',JSON.stringify({id:8,name:'Test Customer',email:'customer@example.test'}));`});
  const fill=async(name,value)=>h.run(`(()=>{const e=document.querySelector('[data-custom-products] [name="${name}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const click=selector=>h.run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const confirm=async(accept=true)=>{
    await h.until("!!document.querySelector('#customerSystemPopup.show, .cp-dialog[open]')");
    await click(accept
      ? '#customerSystemPopup.show #customerSystemPopupOk, .cp-dialog[open] button[value=yes]'
      : '#customerSystemPopup.show #customerSystemPopupCancel, .cp-dialog[open] button[value=cancel]');
  };
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await h.go('/products-page/custom-products.html?new=1');
  await h.until("!!document.querySelector('[data-editor]')");
  assert.equal(await h.run("getComputedStyle(document.querySelector('[data-step] h2')).outlineStyle"), 'none');
  assert.equal(await h.run("document.body.classList.contains('custom-request-page') && !document.body.classList.contains('services-page-body')"),true);
  assert.deepEqual(await h.run("[...document.querySelector('[name=service_id]').options].map(o=>o.value)"),['','7']);
  await fill('service_id','7');await fill('title',spec.title);await fill('description',spec.description);await fill('quantity','2');
  await click('[data-next]');await fill('size',spec.size);await fill('material',spec.material);await fill('colors',spec.colors);
  assert.equal(writes.length,0,'typing and navigating never autosaves a request');
  const focus=await h.run("(async()=>{const el=document.querySelector('[name=material]');el.focus();await new Promise(r=>setTimeout(r,200));const s=getComputedStyle(el);return {border:s.borderTopWidth,color:s.borderTopColor,shadow:s.boxShadow};})()");
  assert.equal(focus.border,'1px');assert.equal(focus.color,'rgb(128, 0, 0)');assert.match(focus.shadow,/3px/);
  await h.shot('custom-customer-desktop');
  await click('[data-next]');await fill('contact_name',spec.contact_name);await fill('contact_phone',spec.contact_phone);await click('[data-next]');
  await h.run("const submit = document.querySelector('[data-submit]');submit.click();submit.click();");await confirm();
  await h.until("document.querySelector('#customerSystemPopup.show [data-tone=error]')");
  assert.match(await h.run("document.getElementById('customerSystemPopupMessage').textContent"),/Your edits are still here/);
  assert.equal(await h.run("document.querySelector('[name=title]').value"),spec.title);
  await click('#customerSystemPopupOk');
  await click('[data-submit]');await confirm();
  await h.until("!!document.querySelector('[data-custom-manager][data-request-id]')");
  assert.equal(writes.filter(write => write.route.endsWith('/custom-requests')).length, 1);
  assert.equal(writes.at(-1).body.expected_revision, 0);
  await click('[data-custom-manager][data-request-id]');
  await h.until("!!document.querySelector('.cp-manager.show [data-edit]')");
  assert.equal(writes.at(-1).body.specifications.quantity,2);
  await fill('body','Keep this unsent conversation message');await click('[data-edit]');
  await confirm(false);
  assert.equal(await h.run("document.querySelector('[name=body]').value"),'Keep this unsent conversation message');
  await fill('body','');
  await click('[data-edit]');await fill('title','Keep my draft');
  await click('.cp-manager .ux-dlg__close');
  await confirm(false);
  assert.equal(await h.run("document.querySelector('.cp-manager.show [name=title]').value"),'Keep my draft');
  await click('[data-list]');await confirm(false);
  assert.equal(await h.run("document.querySelector('[name=title]').value"),'Keep my draft');
  record.revision++;record.messages.push({id:1,role:'staff',author:'FMRC',body:'Please confirm the dimensions.',created_at:record.updated_at});
  await h.run("dispatchEvent(new Event('focus'))");await h.until("document.querySelector('.cp-manager [data-notice]').textContent.includes('unsaved work')");
  assert.equal(await h.run("document.querySelector('[name=title]').value"),'Keep my draft');
  await click('[data-save-draft]');await h.until("!document.querySelector('[data-editor]')");
  await click('[data-status=cancel]');await h.until("!!document.querySelector('dialog[open] textarea')");
  await h.run("document.querySelector('dialog textarea').value='Please cancel this request.'");await click('dialog button[type=submit]');
  await h.until("document.querySelector('#customerSystemPopup.show [data-tone=error]')");
  await click('#customerSystemPopupOk');
  await h.until("!!document.querySelector('dialog[open] textarea')");
  assert.equal(await h.run("document.querySelector('dialog[open] textarea').value"),'Please cancel this request.');
  await click('dialog [data-dismiss]');
  for(const portal of ['admin-page','staff-page']){
    record={...record,status:'submitted',quotes:[],actions:{message:true,review:true,quote:true},specifications:spec};
    await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await h.go((portal === 'staff-page' ? '/apps/team/' : '/')+portal+'/orders.html?custom_requests=1');
    await h.until("!!document.querySelector('#sectionCustomRequests .admin-table')");
    await h.until("!!document.querySelector('#customRequestsTable.portal-data-table')");
    assert.equal(await h.run("!!document.querySelector('#sectionCustomRequests [data-list-filters] button[type=submit]')"),false);
    assert.equal(await h.run("document.querySelectorAll('#sectionCustomRequests [data-list-filters]').length"),1);
    await h.until("!!document.querySelector('#sectionCustomRequests [data-open]')");
    assert.equal(await h.run("document.querySelector('#sectionCustomRequests').textContent.includes('Made for your idea')"),false);
    await click('#sectionCustomRequests [data-open]');
    await h.until("!!document.querySelector('.cp-order-dialog[open] [data-quote]')");
    await click('[data-quote]');await fill('unit_price','500');await fill('production_days','3');
    await h.run("document.querySelector('[name=specifications_confirmed]').click()");
    await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await h.run("document.documentElement.dataset.theme='dark'");
    await h.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.ok(await h.run("document.documentElement.scrollWidth<=innerWidth+1"),'no phone page overflow');
    await h.shot('custom-'+portal+'-phone-dark');
    await click('[name=quote_action][value=send_quote]');await confirm();await h.until("!!document.querySelector('[data-status=withdraw]')");
    assert.equal(writes.at(-1).route,'/api/admin/custom-requests/1/send_quote');
    await click('.cp-order-dialog [data-cp-modal-close]');
    await h.until("!document.querySelector('.cp-order-dialog[open]')");
  }
  record.quotes[0].can_accept=true;
  await h.go('/apps/customer/products-page/custom-products.html?request=1');await h.until("!!document.querySelector('[data-accept]')");
  assert.match(await h.run("document.querySelector('[data-accept] a').href"),/transaction-terms.html\?version=POLICY-1/);
  assert.equal(await h.run("document.querySelector('[data-accept] button').disabled"),false);
  await h.run("document.querySelector('[name=design_accepted]').click();document.querySelector('[name=policy_accepted]').click()");
  await click('[data-accept] button');await confirm();await h.until("!document.querySelector('#customerSystemPopup.show')");await h.pause(150);
  assert.equal(writes.at(-1).body.policy_version,'POLICY-1');
  assert.equal(writes.at(-1).body.app_context,'customer');
  assert.deepEqual(await h.run('fixtureErrors'),[]);
  t.diagnostic('Screenshots: '+h.artifacts);
});

test('Sales filters and custom service copy work in both portals and customer entry pages', {skip:!chrome,timeout:120000}, async t=>{
  const calls=[];
  const h=await browserFixture(t,async({req,route,json})=>{
    calls.push(req.url);
    if(route==='/api/site-settings'){json({data:{editorial_services_custom_title:'Products made for your idea',editorial_services_custom_copy:'Choose an eligible fabrication service and request a quotation.'}});return true;}
    if(route==='/api/services'){json({data:[{id:7,title:'3D Printing',category:'Prototyping',accepts_custom_requests:true,description:'Fabrication',modal_features:[],modal_materials:[],modal_best_for:[]},{id:9,title:'Training',category:'Education',description:'Workshops',accepts_custom_requests:false}]});return true;}
    if(route==='/api/admin/custom-requests-summary'){json({data:{revision:'1',requests_to_review:2,needs_information:1,quotations_awaiting_payment:3,awaiting_production:1,in_production:4}});return true;}
    return false;
  });
  const verifySalesField = async name => {
    await h.until("document.querySelector('#customSalesType')?.parentElement.querySelector('.admin-select-chevron')");
    await h.until(`(() => {
      const field = document.getElementById('customSalesType');
      field.focus({preventScroll:true});
      return document.activeElement === field && getComputedStyle(field).borderTopColor === 'rgb(128, 0, 0)';
    })()`);
    const styles = await h.run(`(() => {
      const field = document.getElementById('customSalesType');
      const style = getComputedStyle(field);
      const before = { radius: style.borderRadius, height: field.getBoundingClientRect().height, color: style.backgroundColor };
      field.blur();
      document.documentElement.dataset.theme = 'dark';
      before.darkColor = getComputedStyle(field).backgroundColor;
      return before;
    })()`);
    assert.equal(styles.radius, '8px');
    assert.ok(styles.height >= 40);
    assert.notEqual(styles.darkColor, styles.color);
    await h.shot(name + '-sales-type-dark');
  };
  for(const portal of ['admin-page','staff-page']){
    await h.send('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});
    await h.go('/'+portal+'/products.html');await h.until("!!document.getElementById('customSalesType') && !!document.getElementById('productPerformanceBody')");
    await verifySalesField(portal + '-products');
    await h.run("const select=document.getElementById('customSalesType');select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));");
    for(let i=0;i<60&&!calls.some(u=>u.includes('product-performance')&&u.includes('sales_type=custom'));i++)await h.pause(50);
    assert.ok(calls.some(u=>u.includes('product-performance')&&u.includes('sales_type=custom')));
    await h.go('/'+portal+'/dashboard.html');await h.until("document.querySelector('[data-custom-counts]')?.textContent.includes('4')");
    await verifySalesField(portal + '-dashboard');
    assert.equal(await h.run("document.getElementById('customSalesType').value"),'custom');
    await h.go('/'+portal+'/reports.html');await h.until("!!document.getElementById('customSalesType')");
    await h.run("const select=document.getElementById('customSalesType');select.value='regular';select.dispatchEvent(new Event('change',{bubbles:true}));");
    await h.pause(150);
    assert.ok(calls.some(u=>u.includes('/api/admin/reports?')&&u.includes('sales_type=regular')));
  }
  for(const page of ['/products-page/product.html','/apps/customer/services-page/service.html']){
    await h.go(page);await h.until("document.querySelector('.cp-entry h2')?.textContent==='Products made for your idea'");
    assert.match(await h.run("document.querySelector('.cp-entry a').href"),/custom-products.html\?new=1/);
    assert.equal(await h.run("document.querySelector('.cp-entry a').target"),'_blank');
    const previousTabs = new Set((await h.listTabs()).map(tab => tab.id));
    await h.run("document.querySelector('.cp-entry a[target=_blank]').click()");
    let opened;
    for (let attempt = 0; attempt < 60 && !opened; attempt++) {
      opened = (await h.listTabs()).find(tab => tab.type === 'page' && !previousTabs.has(tab.id)
        && /\/products-page\/custom-products\.html\?new=1$/.test(tab.url));
      if (!opened) await h.pause(50);
    }
    assert.ok(opened, 'The request link opens its own browser tab');
    assert.equal(await h.run('location.pathname'),page,'The original catalog tab stays on its own page');
    await h.send('Target.closeTarget',{targetId:opened.id});
    await h.send('Page.bringToFront');
    assert.ok(await h.run(`(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const card = box('.cp-entry'), search = box('.toolbar-container .toolbar-search');
      const filters = [...document.querySelectorAll('.toolbar-container .category-dropdown-box')].map(node => node.getBoundingClientRect());
      return Math.abs(card.left - search.left) < 1 && Math.abs(card.right - Math.max(search.right, ...filters.map(filter => filter.right))) < 1;
    })()`), 'Custom Products shares the filter row edges');
    assert.ok(await h.run('document.documentElement.scrollWidth<=innerWidth+1'));
  }
  for (const width of [1440, 768, 390]) {
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    assert.ok(await h.run(`(() => {
      const quote = document.querySelector('.service-card-footer a[href*="custom-products.html?service=7"]');
      const actions = quote?.parentElement;
      const card = quote?.closest('.service-card');
      return quote?.target === '_blank' && quote.textContent === 'Request a Quote' &&
        actions.querySelector('.open-modal-btn') && quote.getBoundingClientRect().right < card.getBoundingClientRect().right &&
        !document.querySelector('a[href*="custom-products.html?service=9"]');
    })()`), 'Eligible service quote stays within the card action row at '+width);
    await h.run("document.querySelector('.services-grid .service-card').scrollIntoView({block:'center',behavior:'instant'})");
    await h.shot('service-quote-actions-' + width);
  }
  t.diagnostic('Custom entry and analytics screenshots: '+h.artifacts);
});

test('Customer buttons hover and the centered request modal recovers from an unavailable schema', {skip:!chrome,timeout:90000}, async t=>{
  let available = false;
  let requests = [];
  const h = await browserFixture(t, async ({req,route,json}) => {
    if (route === '/api/services') {
      json({data:[{id:7,title:'3D Printing',accepts_custom_requests:false}],custom_requests_available:available});
      return true;
    }
    if (route === '/api/customer/custom-requests') {
      if (!available) json({code:'custom_requests_unavailable',message:'Server Error'},503);
      else {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const search = (params.get('search') || '').toLowerCase();
        const filtered = requests.filter(row => row.title.toLowerCase().includes(search));
        const page = Number(params.get('page') || 1);
        json({data:filtered.slice((page-1)*10,page*10),current_page:page,last_page:Math.max(1,Math.ceil(filtered.length/10)),total:filtered.length});
      }
      return true;
    }
    return false;
  });
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('customer_token','fixture-customer');"});
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await h.go('/products-page/product.html');
  await h.until("document.querySelector('.cp-entry h2')?.textContent === 'Make it yours.'");
  await h.run("document.querySelector('.cp-entry').scrollIntoView({block:'center',behavior:'instant'})");
  await h.shot('products-custom-card-desktop');
  for (const selector of ['.cp-entry a[target="_blank"]','.cp-entry [data-custom-manager]']) {
    await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
    await h.pause(180);
    const point = await h.run(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      const rect = button.getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,color:getComputedStyle(button).backgroundColor};
    })()`);
    await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
    await h.pause(200);
    const hovered = await h.run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`);
    assert.notEqual(hovered,point.color);
  }
  await h.run("document.querySelector('.cp-entry [data-custom-manager]').click()");
  await h.until("document.querySelector('.cp-manager [data-retry]')");
  assert.equal(await h.run('location.pathname'),'/products-page/product.html');
  assert.match(await h.run("document.querySelector('.cp-manager [data-notice]').textContent"),/temporarily unavailable/);
  assert.doesNotMatch(await h.run("document.querySelector('.cp-manager').textContent"),/Server Error|Loading custom requests/);
  available = true;
  await h.run("document.querySelector('.cp-manager [data-retry]').click()");
  await h.until("document.querySelector('.cp-manager .cp-empty')?.textContent.includes('No requests found')");
  assert.equal(await h.run(`(() => {
    const modal = document.querySelector('.cp-manager');
    const footer = modal.querySelector('[data-list-pagination]');
    return !footer.hidden && footer.querySelectorAll('button').length === 2
      && [...footer.querySelectorAll('button')].every(button => !button.textContent.trim() && button.querySelector('svg'))
      && footer.querySelector('[data-current-page]').textContent === 'Page 1 of 1'
      && !modal.querySelector('[data-list-filters] button[type=submit]')
      && !!modal.querySelector('[data-list-filters] [data-cp-modal-refresh]');
  })()`),true);
  for (const [width,height] of [[1440,900],[768,1024],[390,844]]) {
    await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const layout = await h.run(`(() => {
      const frame = document.querySelector('.cp-manager .ux-dlg__card').getBoundingClientRect();
      const overlay = getComputedStyle(document.querySelector('.cp-manager'));
      const expectedWidth = Math.min(860, innerWidth - parseFloat(overlay.paddingLeft) - parseFloat(overlay.paddingRight));
      return {width:frame.width, expectedWidth,
        xOffset:frame.left + frame.width / 2 - innerWidth / 2,
        yOffset:frame.top + frame.height / 2 - innerHeight / 2};
    })()`);
    assert.ok(Math.abs(layout.width - layout.expectedWidth) < 2 && Math.abs(layout.xOffset) < 2 && Math.abs(layout.yOffset) < 2,
      'Dialog uses the appointments width and stays centered at '+width+'px '+JSON.stringify(layout));
    assert.ok(await h.run(`(() => {
      const header = document.querySelector('.cp-manager .ux-dlg__head');
      const badge = header.querySelector('.ux-dlg__badge').getBoundingClientRect();
      const title = header.querySelector('.ux-dlg__title').getBoundingClientRect();
      const close = header.querySelector('.ux-dlg__close').getBoundingClientRect();
      const band = header.getBoundingClientRect();
      const topHit = document.elementFromPoint(band.left + band.width / 2, band.top + 3);
      const search = document.querySelector('.cp-manager [data-search]').getBoundingClientRect();
      const status = document.querySelector('.cp-manager [data-status-filter]').getBoundingClientRect();
      return header.querySelector('.ux-dlg__eyebrow').textContent === 'Custom products'
        && badge.width > 0 && badge.right < title.left && title.right <= close.left
        && header.contains(topHit) && (search.top !== status.top || search.right < status.left);
    })()`), 'Shared header fits at '+width+'px');
    if (width !== 768) await h.shot('my-custom-requests-'+width);
  }
  requests = Array.from({length:11}, (_, index) => ({
    id:index+1, reference:'CUS-'+(index+1), title:index===10?'Custom Enclosure':'Nameplate '+(index+1),
    service:{id:7,title:'3D Printing'}, status:'submitted', status_label:'Submitted', updated_at:'2026-11-04T04:00:00Z',
  }));
  await h.run("document.querySelector('.cp-manager [data-cp-modal-refresh]').click()");
  await h.until("document.querySelector('.cp-manager [data-current-page]').textContent==='Page 1 of 2'");
  await h.run("document.querySelector('.cp-manager [aria-label=\"Next page\"]').click()");
  await h.until("document.querySelector('.cp-manager [data-current-page]').textContent==='Page 2 of 2'");
  assert.match(await h.run("document.querySelector('.cp-manager [data-list-results]').textContent"),/Custom Enclosure/);
  await h.run(`(() => {
    const search = document.querySelector('.cp-manager [data-search]');
    search.focus();
    search.value = 'Nameplate';
    search.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await h.until("document.querySelector('.cp-manager [data-current-page]').textContent==='Page 1 of 1'");
  assert.equal(await h.run("document.activeElement.matches('.cp-manager [data-search]')"),true);
  assert.doesNotMatch(await h.run("document.querySelector('.cp-manager [data-list-results]').textContent"),/Custom Enclosure/);
  await h.run("document.querySelector('.cp-manager [data-cp-modal-close]').click()");
  await h.until("document.activeElement.matches('.cp-entry [data-custom-manager]')");
  t.diagnostic('Request header screenshots: '+h.artifacts);
  await h.go('/products-page/custom-products.html?new=1');
  await h.until("document.querySelector('.cp-empty')?.textContent.includes('No services are accepting custom requests')");
  assert.equal(await h.run("!!document.querySelector('[data-editor]')"),false);
});
