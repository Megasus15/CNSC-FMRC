const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {browserFixture,chrome,root}=require('./helpers/website-browser.cjs');
const version='047e505d-ecc9-4e86-8205-213cc366cb7d';
test('both historical policy reader shells revalidate and use the same current shared assets',()=>{
 const assets=[];
 for(const type of ['transaction-terms','refund-policy']){
  const html=fs.readFileSync(path.join(root,'products-page',type+'.html'),'utf8');
  assert(/<h1[^>]*>\s*<i class="fa-solid [^"]+" aria-hidden="true"><\/i>/.test(html),'The '+type+' title has its decorative icon');
  assert.match(html,/id="policyContentsDisclosure"/);assert.match(html,/policy-contents-hint/);
  assets.push([...html.matchAll(/(?:href|src)="([^"]*(?:main\.css|refund-policy\.(?:css|js))\?v=[^"]+)"/g)].map(m=>m[1]));
 }
 assert.deepEqual(assets[0],assets[1]);assert(assets[0].every(url=>url.endsWith('?v=2026.1116.3')));
 const apache=fs.readFileSync(path.join(root,'.htaccess'),'utf8');
 assert.match(apache,/<FilesMatch "\^\(refund-policy\|transaction-terms\)\\\.html\$">\s*Header set Cache-Control "no-cache, must-revalidate"/);
});
test('Refund Policy and Transaction Terms match on clean, versioned Customer and PWA URLs',{skip:!chrome,timeout:120000},async t=>{
 const text=['Eligible concerns','Requesting a review','Custom products','Returning an item','Shipping fees','Refund processing','Your rights'].map((title,i)=>title+'\n'+('Published paragraph '+(i+1)+'. ').repeat(24)+'\nA preserved line break.').join('\n\n');
 const policy=process.env.FMRC_POLICY_FIXTURE?JSON.parse(fs.readFileSync(process.env.FMRC_POLICY_FIXTURE,'utf8')).data:{version,title:'Published order policies',published_at:'2026-11-01 08:00:00',terms_text:text,refund_text:text};
 let css=process.env.FMRC_BROWSER_FA_CSS?fs.readFileSync(process.env.FMRC_BROWSER_FA_CSS,'utf8'):'';
 for(const [file,family,weight]of [[process.env.FMRC_BROWSER_FA,'Font Awesome 6 Free','900'],[process.env.FMRC_BROWSER_FA_REGULAR,'Font Awesome 6 Free','400'],[process.env.FMRC_BROWSER_MONTSERRAT,'Montserrat','100 900']])if(file)css+=`@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})}`;
 const reads=[];const h=await browserFixture(t,async({route,json})=>{if(route.startsWith('/api/commerce/policy/')){reads.push(route);json({data:policy});return true;}return false;},{setup:`{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)}`});
 await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const size=async(width,height=950)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await h.pause(100);};
 const signatures=new Map();
 for(const prefix of ['', '/apps/customer'])for(const type of ['transaction-terms','refund-policy']){
  await size(1440);await h.go(prefix+'/products-page/'+type+'?version='+version);await h.until(`!document.getElementById('policySections').hidden`);await h.run('document.fonts.ready');
  assert.equal(await h.run(`document.querySelectorAll('.policy-page-heading h1>i').length`),1);
  assert(await h.run(`document.getElementById('policyTermsPageLink').href.endsWith('?version=${version}')&&document.getElementById('policyRefundPageLink').href.endsWith('?version=${version}')`));
  const wording=type==='refund-policy'?policy.refund_text:policy.terms_text;
  const expected=wording.split(/\n\s*\n/).filter(p=>p.trim()).length;
  assert.equal(await h.run(`document.querySelectorAll('.policy-document-section h2>i').length`),expected);
  for(const width of [320,390,768,1024,1440]){
   await size(width);await h.run(`scrollTo({top:0,behavior:'instant'})`);await h.until(`document.querySelector('#policyContentsLinks a:first-child').getAttribute('aria-current')==='location'`);
   const signature=await h.run(`(()=>{const c=document.querySelector('.policy-contents'),s=getComputedStyle(c);return {border:s.borderTopColor,width:s.borderTopWidth,padding:s.paddingTop,radius:s.borderRadius,font:s.fontFamily,open:document.getElementById('policyContentsDisclosure').open}})()`);
   assert.equal(signature.width,'1px');assert.equal(signature.radius,'12px');assert(signature.font.includes('Montserrat'));assert.equal(signature.open,width>800);
   const key=prefix+':'+width;if(signatures.has(key))assert.deepEqual(signature,signatures.get(key));else signatures.set(key,signature);
   assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`),'No overflow '+type+' '+width);
   if(!prefix&&[390,1440].includes(width))await h.shot(type+'-'+width);
   await h.run(`scrollTo({top:document.querySelector('.policy-reading-layout').getBoundingClientRect().top+scrollY-document.querySelector('.site-header').getBoundingClientRect().height-${width<=800?8:16}+12,behavior:'instant'})`);await h.pause(100);
   const sticky=await h.run(`(()=>{const c=document.querySelector('.policy-contents').getBoundingClientRect(),p=document.querySelector('.policy-reading-layout').getBoundingClientRect(),header=document.querySelector('.site-header').getBoundingClientRect();return {top:c.top,bottom:c.bottom,parentBottom:p.bottom,header:header.bottom,height:c.height,scrollY,max:document.documentElement.scrollHeight-innerHeight}})()`);
   assert(sticky.bottom<=sticky.parentBottom+1,'Contents remain inside the document');
   if(sticky.scrollY<sticky.max-1&&sticky.parentBottom-sticky.height>sticky.header+(width<=800?8:16))assert(Math.abs(sticky.top-sticky.header-(width<=800?8:16))<2,'Sticky contents '+type+' '+width+' '+JSON.stringify(sticky));
  }
  await size(720,450);await h.run(`{const s=document.createElement('style');s.textContent='.policy-page :is(h1,h2,p,a,summary){line-height:1.5!important;letter-spacing:.12em;word-spacing:.16em}';document.head.append(s)}`);assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`));
 }
 assert(reads.every(route=>route.endsWith('/'+version)));assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Previews: '+h.artifacts);
});
