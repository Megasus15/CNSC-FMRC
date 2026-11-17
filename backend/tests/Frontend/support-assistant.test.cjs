const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const matcher=require('../../../home-page/support-assistant.js');
const {config,faqs}=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../resources/support-assistant.json'),'utf8'));
test('approved bilingual answers match common questions, Taglish and typos without inventing content',()=>{
 for(const [question,key] of [
  ['How do I order a product?','order-products'],['paano mag order','order-products'],['how to oder a prodcut','order-products'],
  ['gusto ko umorder ng product','order-products'],['paano mag book ng appointment','book-consultation'],
  ['When can I pay?','payment-approval'],['how can I refund an order','return-refund'],['can I return a defective item','return-refund'],
  ['paano magbayad online','online-payment'],['presyo ng custom','quotation'],['can i cancel my order','cancel-order'],
  ['hi how do I order a product','order-products'],['online consultation link','online-meeting']]){
   assert.equal(matcher.find(question,faqs).answer?.key,key,question);
 }
 for(const question of ['What is the weather today?','Tell me a joke','payment','product','appointment','cancel'])assert.equal(matcher.find(question,faqs).answer,null,question+' must not guess');
 assert.equal(matcher.find('What is the weather today?',faqs).suggestions.length,0);
 assert.equal(matcher.find('x'.repeat(501),faqs).answer,null);
 assert.equal(matcher.find('how do I order a product?',faqs.map(f=>({...f,enabled:false}))).answer,null);
});
test('greetings welcome the customer without returning ordering, appointment or contact instructions',()=>{
 for(const greeting of ['hi','Hi!','hello','hey','Hi po','hello FMRC','Good morning','kumusta','kamusta po','magandang hapon']){
  const response=matcher.find(greeting,faqs);
  assert.equal(response.kind,'greeting',greeting);assert.equal(response.answer,null);assert.deepEqual(response.suggestions,[]);
 }
 const duplicate=structuredClone(faqs);duplicate[0].aliases.push('hi');
 assert.equal(matcher.find('hi',duplicate).kind,'greeting','saved aliases cannot override greeting intent');
});
test('knowledge pack has usable languages, safe destinations and consistent workflow instructions',()=>{
 assert.equal(config.icon,'brand');assert(faqs.length>=16);assert.equal(new Set(faqs.map(f=>f.key)).size,faqs.length);
 const actions=new Set(['products','appointments','orders','contact','terms','refunds','signin','account']);
 for(const faq of faqs){for(const lang of ['en','fil']){assert(faq[lang].question&&faq[lang].answer);assert(faq[lang].steps.length<=12);}assert(faq.actions.every(a=>actions.has(a)));}
 assert.match(faqs.find(f=>f.key==='order-products').en.answer,/reviews.*before payment/i);
 assert.match(faqs.find(f=>f.key==='appointment-types').en.answer,/meeting methods/i);
 assert.match(faqs.find(f=>f.key==='custom-product').en.answer,/attended consultation/i);
 assert.match(faqs.find(f=>f.key==='online-payment').en.steps.join(' '),/provider|confirmed/i);
});
