const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
for(const role of ['admin','staff'])test(role+' Walk-in Add aligns right and refund filters retain search without Clear filters',{skip:!chrome,timeout:90000},async t=>{
 const reads=[];const h=await browserFixture(t,async({req,route,json})=>{
  if(route==='/api/admin/orders'){json({review:[],incoming:[],directory:[],payments:[],returns:[]});return true;}
  if(route==='/api/admin/gateway-payments'){reads.push(Object.fromEntries(new URL(req.url,'http://fixture').searchParams));json({payments:{data:[],current_page:1,last_page:1,total:0},refunds:[],receipts:[],attempts:[]});return true;}return false;
 });await h.send('Network.setBlockedURLs',{urls:['https://*']});await h.go('/'+role+'-page/orders.html');await h.until(`document.querySelector('[data-tab=refunds]')`);await h.run(`document.querySelector('[data-tab=walkin]').click()`);
 for(const width of [320,390,768,1024,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  const g=await h.run(`(()=>{const h=document.querySelector('#walkInOrdersPanel .panel-header').getBoundingClientRect(),a=document.getElementById('openWalkInOrderModalBtn').getBoundingClientRect(),s=document.querySelector('#walkInOrdersPanel .orders-search').getBoundingClientRect();return{right:h.right-a.right,gap:a.left-s.right,same:Math.abs(a.top-s.top)<2,fit:s.left>=h.left&&a.right<=h.right+1&&document.documentElement.scrollWidth<=innerWidth+1}})()`);
  assert(g.right<=1&&g.right>=-1&&g.gap>=8&&g.same&&g.fit,JSON.stringify({width,g}));if([390,1440].includes(width))await h.shot(role+'-walkin-toolbar-'+width);
 }
 assert.equal(await h.run(`document.querySelector('[data-gateway-all]')`),null);
 await h.run(`document.querySelector('[data-tab=refunds]').click();const input=document.querySelector('[data-gateway-search]');input.value='Sample';input.dispatchEvent(new Event('input'));`);await h.until(`document.querySelector('#gatewayPaymentsTable .table-empty-state')`);await h.pause(400);
 assert(reads.some(p=>p.search==='Sample'));
 await h.run(`const select=document.querySelector('[data-gateway-status-filter]');select.value='failed';select.dispatchEvent(new Event('change'));`);await h.pause(200);assert(reads.some(p=>p.refund_status==='failed'&&p.search==='Sample'));
 assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
