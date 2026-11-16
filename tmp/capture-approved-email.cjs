const {test}=require('node:test');
const {browserFixture}=require('../backend/tests/Frontend/helpers/website-browser.cjs');
test('render the common email footer without sending mail',async t=>{
 const h=await browserFixture(t);
 for(const width of [390,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
  await h.go('/tmp/email-contact-preview.html');
  if(!await h.run(`document.body.innerText.includes('Contact the FMRC')&&document.querySelector('a[href="tel:09090990000"]')&&document.documentElement.scrollWidth<=innerWidth+1`))throw Error('Email footer does not fit');
  await h.shot('email-footer-'+width);
 }
 t.diagnostic(h.artifacts);
});
