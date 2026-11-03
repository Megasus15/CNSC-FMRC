const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname,'../../../products-page/shipping-quotes.js'),'utf8');
const tick = () => new Promise(resolve=>setTimeout(resolve,5));
const quote = (total=185,token='quote-one') => ({available:true,item_subtotal:100,shipping_fee:total-100,payable_total:total,quote_token:token,expires_at:new Date(Date.now()+900000).toISOString()});
function harness() {
  let input={items:[{product_id:1,quantity:1}],fulfillment_type:'delivery',delivery_province:'Camarines Norte',delivery_city:'Daet',delivery_postal_code:'4600'};
  let state,ready,expiry;
  const requests=[];
  const context=vm.createContext({window:{},AbortController,Date,JSON,clearTimeout,setTimeout:(fn,ms)=>ms>1000?(expiry=fn,0):setTimeout(fn,ms)});
  vm.runInContext(source,context);
  const controller=context.window.FMRCShippingQuotes.create({read:()=>input,delay:0,setReady:value=>{ready=value;},render:value=>{state=value;},
    request:(payload,signal)=>new Promise((resolve,reject)=>requests.push({payload,signal,resolve,reject}))});
  return {controller,requests,get state(){return state;},get ready(){return ready;},set input(value){input=value;},get input(){return input;},expire:()=>expiry()};
}
test('changed quantities lock checkout during calculation and automatically update the payable total',async()=>{
  const h=harness();h.controller.refresh();assert.equal(h.ready,false);await tick();h.requests[0].resolve(quote());await tick();
  assert.equal(h.ready,true);assert.equal(h.controller.token(),'quote-one');assert.equal(h.controller.total(),185);
  h.input={...h.input,items:[{product_id:1,quantity:2}]};h.controller.refresh();assert.equal(h.ready,false);await tick();
  assert.equal(h.controller.total(),null);
  h.requests[1].resolve(quote(285,'quote-two'));await tick();
  assert.equal(h.ready,true);assert.equal(h.controller.token(),'quote-two');assert.equal(h.controller.total(),285);
});
test('a delayed old destination response cannot replace the latest quote',async()=>{
  const h=harness();h.controller.refresh();await tick();h.input={...h.input,delivery_city:'Labo'};h.controller.refresh();await tick();
  assert.equal(h.requests[0].signal.aborted,true);h.requests[1].resolve(quote(200,'latest'));await tick();h.requests[0].resolve(quote(100,'old'));await tick();
  assert.equal(h.controller.token(),'latest');assert.equal(h.controller.total(),200);
});
test('unavailable delivery and failed requests never expose a payable total or allow checkout',async()=>{
  const h=harness();h.controller.refresh();await tick();h.requests[0].resolve({available:false,shipping_fee:null,payable_total:null,message:'Choose pickup.'});await tick();
  assert.equal(h.ready,false);assert.equal(h.controller.total(),null);assert.equal(h.state.message,'Choose pickup.');
  h.controller.refresh(true);await tick();h.requests[1].reject(new Error('Please retry.'));await tick();assert.equal(h.ready,false);assert.equal(h.state.failed,true);
});
test('expiry renews automatically and a stale submission refreshes the visible summary',async()=>{
  const h=harness();h.controller.refresh();await tick();h.requests[0].resolve(quote());await tick();h.expire();assert.equal(h.ready,false);await tick();
  h.requests[1].resolve(quote(185,'renewed'));await tick();assert.equal(h.ready,true);
  h.controller.reject(quote(195,'published-new'),'renewed');assert.equal(h.ready,true);assert.equal(h.controller.total(),195);
  assert.equal(h.controller.token(),'published-new');assert.match(h.state.message,/Order summary updated/);
});

test('a stale submission response cannot overwrite a newer fulfillment choice',async()=>{
  const h=harness();h.controller.refresh();await tick();h.requests[0].resolve(quote());await tick();
  h.input={...h.input,fulfillment_type:'pickup'};h.controller.refresh();await tick();
  h.controller.reject(quote(195,'old-submission'),'quote-one');assert.equal(h.ready,false);
  h.requests[1].resolve({...quote(100,'pickup'),fulfillment_type:'pickup'});await tick();
  assert.equal(h.ready,true);assert.equal(h.controller.total(),100);assert.equal(h.controller.token(),'pickup');
  h.controller.reject(quote(195,'old-submission'),'quote-one');assert.equal(h.controller.token(),'pickup');
});
test('an incomplete address or closed checkout aborts the quote without leaving checkout enabled',async()=>{
  const h=harness();h.controller.refresh();await tick();h.input={error:'Complete your address.'};h.controller.refresh();assert.equal(h.ready,false);assert.equal(h.requests[0].signal.aborted,true);
  h.requests[0].resolve(quote());await tick();assert.equal(h.ready,false);h.input=null;h.controller.refresh();assert.equal(h.ready,false);
});
