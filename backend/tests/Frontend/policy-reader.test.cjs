const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../..');
const source=fs.readFileSync(path.join(root,'products-page/refund-policy.js'),'utf8');
const policy={version:'accepted-v1',title:'Approved order policies',published_at:'2026-11-01 17:30:00',terms_text:'Ordering\nReview your order before paying.\n\nDelivery\nUse a complete address.',refund_text:'Eligible concerns\nContact FMRC about your order.\n\nProcessing\nKeep your order number available.'};

function harness(type,{search='',hash=''}={}){
  const nodes=new Map(),requests=[];let init,redirect;
  class Element{
    constructor(){this.children=[];this.events={};this.attributes={};this.hidden=false;this.dataset={};this.text='';}
    set textContent(text){this.text=String(text);this.children=[];}
    get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
    append(...children){this.children.push(...children);}
    replaceChildren(){this.children=[];this.text='';}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(type,callback){this.events[type]=callback;}
    scrollIntoView(){this.scrolled=true;}
  }
  const html=fs.readFileSync(path.join(root,`products-page/${type}.html`),'utf8');
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,new Element());
  nodes.get('policyDocument').dataset.policyType=type;
  vm.runInNewContext(source,{
    document:{getElementById:id=>nodes.get(id),createElement:()=>new Element(),addEventListener:(_,callback)=>{init=callback;}},
    window:{APP_API_BASE_URL:'/api'},location:{search,hash,replace:url=>{redirect=url;}},URLSearchParams,Date,
    AbortSignal:{timeout:()=>new AbortController().signal},
    fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
  });
  const done=init();
  return {nodes,requests,done,get redirect(){return redirect;},
    reply(data,status=200){requests.at(-1).resolve({ok:status===200,status,json:async()=>({data})});}};
}

for(const type of ['transaction-terms','refund-policy']){
  test(`${type} displays only its document and keeps the same accepted version on related links`,async()=>{
    const h=harness(type,{search:'?version=accepted-v1',hash:'#'+type});
    h.reply(policy);await h.done;
    assert.equal(h.requests[0].url,'/api/commerce/policy/accepted-v1');
    assert.equal(h.requests[0].options.cache,'no-store');
    const target=h.nodes.get(type==='transaction-terms'?'policyTermsText':'policyRefundText');
    assert.match(target.textContent,type==='transaction-terms'?/Review your order/:/Eligible concerns/);
    assert.doesNotMatch(target.textContent,type==='transaction-terms'?/Eligible concerns/:/Review your order/);
    assert.equal(h.nodes.get('policyContentsLinks').children.length,2);
    assert.match(h.nodes.get('policyPageStatus').textContent,/November 2, 2026/);
    assert.equal(h.nodes.get('policyNotice').hidden,true);
    assert.equal(h.nodes.get(type).scrolled,true);
    assert.equal(h.nodes.get('policyDocument').attributes['aria-busy'],'false');
    assert.equal(h.nodes.get('policyTermsPageLink').href,'/products-page/transaction-terms.html?version=accepted-v1');
    assert.equal(h.nodes.get('policyRefundPageLink').href,'/products-page/refund-policy.html?version=accepted-v1');
  });
  test(`${type} gives an unpublished state with contact access and no draft text`,async()=>{
    const h=harness(type);h.reply(null);await h.done;
    assert.equal(h.nodes.get('policyNoticeTitle').textContent,'Policy awaiting publication');
    assert.equal(h.nodes.get('policySections').hidden,true);
    assert.equal(h.nodes.get('policyMetadata').hidden,true);
    assert.equal(h.nodes.get('policyNoticeContact').hidden,false);
    assert.equal(h.nodes.get('policyPageRetry').hidden,true);
  });
  test(`${type} handles load failures, coalesces retries, and recovers`,async()=>{
    const h=harness(type);h.requests[0].reject(Error('Connection failed'));await h.done;
    assert.equal(h.nodes.get('policyPageRetry').hidden,false);
    const retry=h.nodes.get('policyPageRetry').events.click();h.nodes.get('policyPageRetry').events.click();
    assert.equal(h.requests.length,2);
    h.reply(policy);await retry;
    assert.equal(h.nodes.get('policyNotice').hidden,true);
    assert.equal(h.nodes.get('policySections').hidden,false);
  });
  test(`${type} never replaces an unavailable historical version with current wording`,async()=>{
    const h=harness(type,{search:'?version=missing'});h.reply(null,404);await h.done;
    assert.equal(h.requests.length,1);
    assert.equal(h.nodes.get('policySections').hidden,true);
    assert.equal(h.nodes.get('policyNoticeTitle').textContent,'This policy version is unavailable');
    assert.equal(h.nodes.get('policyCurrentLink').hidden,false);
  });
}
test('legacy accepted-terms links redirect to the separate terms page with their version intact',async()=>{
  const h=harness('refund-policy',{search:'?version=accepted-v1',hash:'#transaction-terms'});await h.done;
  assert.equal(h.redirect,'/products-page/transaction-terms.html?version=accepted-v1#transaction-terms');
  assert.equal(h.requests.length,0);
});
test('published wording is rendered as text rather than injected markup',async()=>{
  const h=harness('refund-policy');h.reply({...policy,refund_text:'<img src=x onerror=alert(1)>\n<script>danger()</script>'});await h.done;
  const section=h.nodes.get('policyRefundText').children[0];
  assert.equal(section.children[0].textContent,'<img src=x onerror=alert(1)>');
  assert.equal(section.children[1].textContent,'<script>danger()</script>');
});
