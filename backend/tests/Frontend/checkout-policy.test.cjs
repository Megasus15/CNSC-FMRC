const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../../products-page/checkout-policy.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const policy=version=>({version,title:'FMRC policy',terms_text:'Approved terms',refund_text:'Approved refund wording'});
function harness(){
  const fields=new Map(),requests=[];let ready=false,observer,open=true;
  for(const id of ['orderTerms','checkoutPolicyStatus','checkoutPolicyRetry','checkoutTermsLink','checkoutRefundLink','checkoutModal'])fields.set(id,{checked:false,disabled:false,hidden:false,textContent:'',events:{},addEventListener(type,listener){this.events[type]=listener;},classList:{contains:()=>open}});
  const document={getElementById:id=>fields.get(id)||null,addEventListener(type,listener){if(type==='DOMContentLoaded')this.init=listener;}};
  const context=vm.createContext({document,window:{APP_API_BASE_URL:'/api',FMRC_PAYMENT_METHODS:{setPolicyReady:value=>{ready=value;}}},location:{origin:'https://example.test'},AbortController,
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,
    MutationObserver:class{constructor(callback){observer=callback;}observe(){}},
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
  vm.runInContext(source,context);document.init();
  return {api:context.window.FMRC_CHECKOUT_POLICY,fields,requests,get ready(){return ready;},
    resolve(value,ok=true){requests.at(-1).resolve({ok,json:async()=>({data:value})});},
    agree(){const box=fields.get('orderTerms');box.checked=true;box.events.change();},close(){open=false;observer();}};
}
test('checkout is locked until a published policy is loaded and explicitly accepted',async()=>{
  const h=harness();assert.equal(h.ready,false);assert(h.fields.get('orderTerms').disabled);
  h.resolve(policy('v1'));await tick();assert.equal(h.fields.get('orderTerms').disabled,false);assert.equal(h.ready,false);
  h.agree();assert.equal(h.ready,true);assert.equal(h.api.version(),'v1');
  assert.match(h.fields.get('checkoutRefundLink').href,/version=v1#refund-policy/);
  assert.match(h.fields.get('checkoutRefundLink').href,/\/refund-policy\.html\?/);
  assert.match(h.fields.get('checkoutTermsLink').href,/\/transaction-terms\.html\?version=v1#transaction-terms/);
});
test('a publication change before submission clears acceptance and updates both policy links',async()=>{
  const h=harness();h.resolve(policy('v1'));await tick();h.agree();const pending=h.api.refresh();assert.equal(h.ready,false);
  assert.equal(h.api.refresh(),pending,'concurrent preflight requests coalesce');
  h.resolve(policy('v2'));assert.equal(await pending,false);assert.equal(h.fields.get('orderTerms').checked,false);assert.equal(h.api.version(),null);
  assert.match(h.fields.get('checkoutTermsLink').href,/version=v2#transaction-terms/);h.agree();assert.equal(h.api.version(),'v2');
});
test('an unchanged policy preserves explicit consent while a failed preflight locks checkout until retry',async()=>{
  const h=harness();h.resolve(policy('v1'));await tick();h.agree();let pending=h.api.refresh();h.resolve(policy('v1'));assert.equal(await pending,true);
  pending=h.api.refresh();h.resolve(null,false);assert.equal(await pending,false);assert.equal(h.ready,false);assert.equal(h.fields.get('checkoutPolicyRetry').hidden,false);
  pending=h.api.refresh();h.resolve(policy('v1'));assert.equal(await pending,true);
});
test('an unpublished or server-rejected policy cannot be accepted, and closing checkout resets consent',async()=>{
  const h=harness();h.resolve(null);await tick();assert.equal(h.ready,false);assert.equal(h.fields.get('orderTerms').disabled,true);
  h.api.reject(policy('v2'));assert.equal(h.ready,false);h.agree();assert.equal(h.ready,true);h.close();assert.equal(h.ready,false);assert.equal(h.fields.get('orderTerms').checked,false);
});
