const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../products-page/gateway-payments.js'), 'utf8');

function harness(initial) {
  let response = initial;
  const fields = new Map();
  const events = {};
  const timers = new Map(); let nextTimer = 0;
  const dialog = {open:false, setAttribute(){}, addEventListener(type, fn){events[type]=fn;}, querySelector(selector){
    if (!fields.has(selector)) fields.set(selector, {hidden:false,textContent:'',disabled:false,dataset:{}});
    return fields.get(selector);
  }, showModal(){this.open=true;}, close(){this.open=false;events.close?.();}};
  const window = {APP_API_BASE_URL:'https://example.test/api', addEventListener(){}, dispatchEvent(){}};
  const context = vm.createContext({window, document:{hidden:false, createElement:()=>dialog, body:{append(){}}, addEventListener(){}},
    location:{hostname:'example.test',origin:'https://example.test',assign(){}}, URL,
    localStorage:{getItem:()=> 'fixture'}, AbortSignal, AbortController, CustomEvent:class {},
    setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);},fetch:async()=>({ok:true,json:async()=>response})});
  vm.runInContext(source, context);
  return {fields, dialog, context, timers, tick:()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);return fn();}, setResponse:next=>{response=next;}, open:async(id=1)=>{window.FMRCGatewayPayments.open(id);await new Promise(setImmediate);},
    update:async(next)=>{response=next;await fields.get('[data-gateway-refresh]').onclick();}};
}

test('QR checkout explains scanning and stops offering payment after provider confirmation', async () => {
  const h=harness({checkout_method:'qrph',method_label:'QR Ph',status:'pending',attempt_status:'pending',checkout_url:'https://checkout.paymongo.com/fixture',refunds:[]});
  await h.open();
  assert.equal(h.fields.get('[data-gateway-title]').textContent,'QR Ph payment');
  assert.equal(h.fields.get('[data-gateway-continue]').textContent,'Continue to payment QR');
  assert.equal(h.fields.get('[data-gateway-instructions]').hidden,false);
  assert.match(h.fields.get('[data-gateway-instructions]').textContent,/Scan.*GCash/);
  await h.update({checkout_method:'qrph',method_label:'QR Ph',status:'paid',checkout_url:null,retry_allowed:false,refunds:[]});
  assert.equal(h.fields.get('[data-gateway-continue]').hidden,true);
  assert.equal(h.fields.get('[data-gateway-instructions]').hidden,true);
  assert.match(h.fields.get('[data-gateway-message]').textContent,/Payment confirmed/);
});

test('background checks stay quiet and stop once payment is confirmed', async () => {
  const h=harness({status:'pending',checkout_method:'qrph',checkout_url:'https://checkout.paymongo.com/fixture'});
  await h.open();
  let finish;
  h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const check=h.tick();
  assert.equal(h.fields.get('[data-gateway-refresh]').textContent,'Check payment');
  assert.equal(h.fields.get('[data-gateway-refresh]').disabled,false);
  assert.equal(h.fields.get('[data-gateway-continue]').disabled,false);
  finish({ok:true,json:async()=>({status:'paid',checkout_method:'qrph'})});
  await check;
  assert.equal(h.timers.size,0);
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Payment confirmed');
});

test('initial timeout replaces loading with a recoverable state and bounds automatic retries', async () => {
  const h=harness({status:'pending'});
  h.context.fetch=async()=>{const e=new Error('Timed out');e.name='TimeoutError';throw e;};
  await h.open();
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Status unavailable');
  assert.equal(h.fields.get('[data-gateway-refresh]').disabled,false);
  await h.tick(); await h.tick();
  assert.equal(h.timers.size,0);
  h.context.fetch=async()=>({ok:true,json:async()=>({status:'paid'})});
  await h.fields.get('[data-gateway-refresh]').onclick();
  assert.equal(h.fields.get('[data-gateway-error]').hidden,true);
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Payment confirmed');
});

test('continue stays usable during a background check and ignores its stale result', async () => {
  const h=harness({status:'pending',checkout_method:'qrph',checkout_url:'https://checkout.paymongo.com/fixture'});
  await h.open();
  let finishBackground; let posts=0;
  h.context.fetch=()=>new Promise(resolve=>{finishBackground=resolve;});
  const background=h.tick();
  h.context.fetch=async(url,options)=>{if(options.method==='POST')posts++;return {ok:true,json:async()=>({status:'paid',checkout_method:'qrph'})};};
  await h.fields.get('[data-gateway-continue]').onclick();
  await new Promise(setImmediate);
  finishBackground({ok:true,json:async()=>({status:'pending',checkout_method:'qrph',retry_allowed:true})});
  await background;
  assert.equal(posts,1);
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Payment confirmed');
  assert.equal(h.fields.get('[data-gateway-continue]').hidden,true);
});

test('a historical direct GCash attempt retains its authorization instructions', async () => {
  const h=harness({checkout_method:'gcash',method_label:'GCash',status:'pending',attempt_status:'pending',checkout_url:'https://checkout.paymongo.com/fixture',refunds:[]});
  await h.open();
  assert.equal(h.fields.get('[data-gateway-title]').textContent,'GCash payment');
  assert.equal(h.fields.get('[data-gateway-continue]').textContent,'Continue to GCash');
  assert.equal(h.fields.get('[data-gateway-instructions]').hidden,true);
});

test('paid or review states cannot offer another checkout even with an old URL', async () => {
  for (const data of [{status:'paid'}, {status:'pending',exception:'amount_mismatch'}, {status:'refunded'}]) {
    const h=harness({...data,checkout_method:'qrph',checkout_url:'https://checkout.paymongo.com/stale',retry_allowed:true});
    await h.open();
    assert.equal(h.fields.get('[data-gateway-continue]').hidden,true);
    h.fields.get('[data-gateway-done]').onclick();
    assert.equal(h.dialog.open,false);
  }
});

test('a slow result from a closed order cannot replace the newly opened payment', async () => {
  const h=harness({status:'paid',checkout_method:'qrph'});
  let finishFirst;
  h.context.fetch=()=>new Promise(resolve=>{finishFirst=resolve;});
  await h.open(1);
  h.fields.get('[data-gateway-close]').onclick();
  h.context.fetch=async()=>({ok:true,json:async()=>({status:'refunded',checkout_method:'gcash'})});
  await h.open(2);
  finishFirst({ok:true,json:async()=>({status:'paid',checkout_method:'qrph'})});
  await new Promise(setImmediate);
  assert.equal(h.fields.get('[data-gateway-title]').textContent,'GCash payment');
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Refunded');
});

test('failed checks keep confirmed information and restore the retry button', async () => {
  const h=harness({status:'paid',checkout_method:'qrph'});
  await h.open();
  h.context.fetch=async()=>{throw new Error('Connection unavailable');};
  await h.fields.get('[data-gateway-refresh]').onclick();
  assert.match(h.fields.get('[data-gateway-message]').textContent,/Payment confirmed/);
  assert.equal(h.fields.get('[data-gateway-error]').hidden,false);
  assert.equal(h.fields.get('[data-gateway-refresh]').disabled,false);
});

test('a stuck connection or response body reaches the deadline and releases Check payment', async () => {
  for (const stuckBody of [false,true]) {
    const h=harness({status:'pending'});
    h.context.fetch=async()=>stuckBody ? {ok:true,json:()=>new Promise(()=>{})} : new Promise(()=>{});
    await h.open();
    assert.equal(h.fields.get('[data-gateway-refresh]').disabled,true);
    h.tick();
    await new Promise(setImmediate);
    assert.equal(h.fields.get('[data-gateway-refresh]').disabled,false);
    assert.equal(h.fields.get('[data-gateway-refresh]').textContent,'Check payment');
    assert.match(h.fields.get('[data-gateway-error]').textContent,/too long/);
    assert.equal(h.fields.get('[data-gateway-status]').textContent,'Status unavailable');
  }
});

test('manual check joins a background request and shows its completed result', async () => {
  const h=harness({status:'pending'}); await h.open();
  let finish; let requests=0;
  h.context.fetch=()=>{requests++;return new Promise(resolve=>{finish=resolve;});};
  const background=h.tick();
  await h.fields.get('[data-gateway-refresh]').onclick();
  assert.equal(h.fields.get('[data-gateway-refresh]').disabled,true);
  assert.equal(requests,1);
  finish({ok:true,json:async()=>({status:'pending'})}); await background;
  assert.equal(h.fields.get('[data-gateway-refresh]').disabled,false);
  assert.match(h.fields.get('[data-gateway-checked]').textContent,/Last checked at.*Awaiting payment/);
});

test('closed paid order displays refund progress, polls even after late payment, and never offers another checkout', async () => {
  const h=harness({status:'paid',order_status:'rejected',exception:'late_payment_refund_review',refunds:[{id:1,amount_centavos:180,status:'requested'}]});
  await h.open();
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Refund requested');
  assert.match(h.fields.get('[data-gateway-message]').textContent,/No money has been returned yet/);
  assert.equal(h.fields.get('[data-gateway-continue]').hidden,true);
  assert.equal(h.timers.size,1);
  await h.update({status:'paid',order_status:'rejected',refunds:[{id:1,amount_centavos:180,status:'pending'}]});
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Refund processing');
  await h.update({status:'refunded',order_status:'rejected',refunds:[{id:1,amount_centavos:180,status:'succeeded'}]});
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Refunded');
  assert.match(h.fields.get('[data-gateway-refunds]').textContent,/1.80: Confirmed/);
  assert.equal(h.timers.size,0);
});

test('failed refund on rejected order requests assistance instead of promising preparation or completion', async () => {
  const h=harness({status:'paid',order_status:'rejected',refunds:[{amount_centavos:180,status:'failed'}]});
  await h.open();
  assert.equal(h.fields.get('[data-gateway-status]').textContent,'Refund needs review');
  assert.match(h.fields.get('[data-gateway-message]').textContent,/Contact FMRC/);
  assert.doesNotMatch(h.fields.get('[data-gateway-message]').textContent,/awaiting team approval|has been refunded/);
});
