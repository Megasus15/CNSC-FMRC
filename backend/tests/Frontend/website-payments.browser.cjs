// Canonical settings page with a persistent, isolated API fixture. No live payment calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Payment Methods matches checkout and preserves saved preferences across responsive layouts', {skip:!chrome, timeout:90000}, async t => {
  const settings = {payment_cash_on_pickup_enabled:'1', payment_cash_on_delivery_enabled:'1', payment_gcash_enabled:'1', payment_checkout_method:'qrph', payment_gcash_ready:'1'};
  const writes = [];
  let failSave = false, holdSave = false, releaseSave;
  const font=process.env.FMRC_BROWSER_POPPINS,solid=process.env.FMRC_BROWSER_FA,regular=process.env.FMRC_BROWSER_FA_REGULAR,faCss=process.env.FMRC_BROWSER_FA_CSS;
  const css=(faCss?fs.readFileSync(faCss,'utf8'):'')+(font?`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`:'')+[solid,regular].map((file,i)=>file?`@font-face{font-family:"Font Awesome 6 Free";font-weight:${i?400:900};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})}`:'').join('');
  const setup=css?`{let s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);}`:'';
  const h = await browserFixture(t, async ({req, route, json}) => {
    if (route === '/api/site-settings') { json({data:settings}); return true; }
    if (route === '/api/admin/site-settings' && req.method === 'PUT') {
      let body = ''; for await (const chunk of req) body += chunk;
      writes.push(JSON.parse(body));
      if (holdSave) await new Promise(resolve=>releaseSave=resolve);
      if (failSave) { json({message:'Settings could not be saved. Try again.'},503); return true; }
      Object.assign(settings, writes.at(-1)); json({message:'Saved', data:settings}); return true;
    }
    return false;
  },{setup});
  await h.send('Network.setBlockedURLs', {urls:['https://*']});
  const settled = () => h.until(`!document.getElementById('paymentSettingsFields').disabled && !document.querySelector('.website-section-loading')`);
  const viewport = async (width, height=1000) => {
    await h.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false});
    await h.pause(180);
  };
  const shot=async name=>{await h.run('document.fonts.ready');await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(name);};
  await h.go('/admin-page/website-payments.html'); await settled();
  assert.deepEqual(await h.run(`Array.from(document.querySelectorAll('.payment-method-name'), e=>e.textContent)`), ['Cash on pickup','QR Ph']);
  assert.equal(await h.run(`document.querySelector('[for="payment_cash_on_delivery_enabled"]') === null`), true);
  assert.equal(await h.run(`document.querySelector('.payment-method-icon--qrph img').naturalWidth > 0`), true);
  assert.equal(await h.run(`document.getElementById('qrphPaymentAvailability').textContent`), 'Ready');
  assert.equal(await h.run(`document.getElementById('savePaymentSettings').form.id`), 'paymentSettingsForm');
  for (const theme of ['light','dark']) for (const width of [320,390,768,1024,1440]) {
    await viewport(width);
    await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    const layout = await h.run(`(()=>{
      const rows=[...document.querySelectorAll('.payment-method-row')];
      return {overflow:document.documentElement.scrollWidth>innerWidth,
        contained:rows.every(row=>[...row.children].every(child=>{const a=row.getBoundingClientRect(),b=child.getBoundingClientRect();return b.left>=a.left && b.right<=a.right;})),
        buttons:[...document.querySelectorAll('.payment-save-actions button,.payment-bulk-actions button,.payment-switch')].every(b=>b.scrollWidth<=b.clientWidth+1&&b.getBoundingClientRect().height>=44),
        switches:[...document.querySelectorAll('.payment-switch')].every(n=>getComputedStyle(n).backgroundClip==='padding-box'&&n.getBoundingClientRect().height-2*parseFloat(getComputedStyle(n).borderTopWidth)===26&&parseFloat(getComputedStyle(n,'::before').left)===(n.checked?24:4)),
        text:getComputedStyle(document.querySelector('.payment-method-name')).color,
        surface:getComputedStyle(document.querySelector('.payment-method-row')).backgroundColor};
    })()`);
    assert.equal(layout.overflow, false, `${theme} ${width}px page fits`);
    assert.equal(layout.contained, true, `${theme} ${width}px controls fit their cards`);
    assert.equal(layout.buttons, true, `${theme} ${width}px button text fits`);
    assert.equal(layout.switches,true,`${theme} ${width}px switches retain their compact track and state position`);
    assert.notEqual(layout.text, layout.surface, `${theme} text remains visible`);
    assert(await h.run(`getComputedStyle(document.querySelector('.payment-settings-heading h3')).color===getComputedStyle(document.querySelector('.payment-section-icon')).color`),`${theme} heading and icon share the maroon accent`);
    if (width===390 || width===1440) await shot(`payments-${theme}-${width}`);
  }
  await viewport(1440);
  await h.run(`document.documentElement.dataset.theme='light'; document.getElementById('payment_gcash_enabled').focus()`);
  await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  assert.equal(await h.run(`document.getElementById('payment_gcash_enabled').checked`), false, 'keyboard toggles QR Ph');
  assert.equal(writes.length, 0, 'editing does not publish');
  await h.run(`document.getElementById('discardPaymentSettings').focus();document.getElementById('discardPaymentSettings').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show') !== null`);
  assert.equal(await h.run(`document.getElementById('adminSystemPopupTitle').textContent`), 'Discard changes?');
  assert(await h.run(`!document.querySelector('#adminSystemPopup [data-portal-detail-close],#adminSystemPopup hr')&&getComputedStyle(document.querySelector('#adminSystemPopup .portal-detail-dialog__card')).borderRadius==='12px'&&document.body.style.position==='fixed'`),'Discard uses the compact no-X Inventory presentation');
  await viewport(390,850);await shot('payments-discard-mobile');
  await h.run(`document.getElementById('adminSystemPopupCancel').click()`);await h.until(`document.body.style.position!=='fixed'`);assert.equal(await h.run(`document.activeElement.id`),'discardPaymentSettings');assert.equal(await h.run(`document.getElementById('payment_gcash_enabled').checked`),false);
  await h.run(`document.getElementById('discardPaymentSettings').click()`);await h.until(`document.querySelector('#adminSystemPopup.show')`);
  await h.run(`document.getElementById('adminSystemPopupOk').click()`); await settled();
  assert.equal(await h.run(`document.getElementById('payment_gcash_enabled').checked`), true, 'global discard restores the saved preference');
  assert.equal(writes.length, 0, 'discard does not publish');
  await h.run(`document.getElementById('payment_gcash_enabled').click()`);
  failSave = true;
  await h.run(`document.getElementById('savePaymentSettings').click()`);
  await h.until(`!document.getElementById('paymentSettingsError').hidden && !document.getElementById('savePaymentSettings').disabled`);
  assert.equal(await h.run(`document.getElementById('payment_gcash_enabled').checked`), false, 'failed save retains edits');
  assert.equal(settings.payment_gcash_enabled, '1');
  failSave = false;
  holdSave = true;
  await h.run(`document.getElementById('savePaymentSettings').click()`);
  await h.until(`document.getElementById('paymentSettingsFields').disabled`);for(let i=0;!releaseSave&&i<100;i++)await h.pause(20);assert(releaseSave);const count=writes.length;await h.run(`document.getElementById('paymentSettingsForm').requestSubmit();document.getElementById('savePaymentSettings').click()`);assert.equal(writes.length,count);releaseSave();holdSave=false;
  await h.until(`document.getElementById('paymentSaveStatus').textContent==='Payment methods saved.'`);
  await h.until(`document.querySelector('.admin-success-notification__close svg')`);await h.run(`document.querySelector('.admin-success-notification__close').click()`);
  assert.deepEqual(writes.at(-1), {payment_cash_on_pickup_enabled:'1',payment_gcash_enabled:'0',payment_cash_on_delivery_enabled:'0'});
  await h.go('/admin-page/website-payments.html'); await settled();
  assert.equal(await h.run(`document.getElementById('payment_gcash_enabled').checked`), false, 'persisted setting reads back');
  assert.equal(await h.run(`document.getElementById('savePaymentSettings').disabled`), true);
  settings.payment_gcash_ready = '0';
  settings.payment_gcash_enabled = '1';
  settings.payment_cash_on_pickup_enabled = '0';
  await h.run(`document.getElementById('refreshPaymentSettings').click()`); await settled();
  await h.until(`document.getElementById('qrphPaymentAvailability').textContent==='Temporarily unavailable'`);
  assert.equal(await h.run(`document.getElementById('qrphPaymentNotice').hidden`), false);
  assert.match(await h.run(`document.getElementById('paymentSettingsNoteTitle').textContent`), /No methods available/);
  await viewport(390); await shot('payments-unavailable-390');
  const before=writes.length;await h.run(`document.getElementById('disableAllPayments').click()`);assert.equal(await h.run(`document.getElementById('paymentSettingsNoteTitle').textContent`),'Saving will pause new product orders');assert.equal(writes.length,before,'Bulk changes remain drafts');await h.run(`document.getElementById('enableAllPayments').click()`);assert.equal(await h.run(`document.getElementById('paymentSettingsSummary').textContent`),'2 of 2 methods selected');
  await h.run(`document.getElementById('discardPaymentSettings').click()`);await h.until(`document.querySelector('#adminSystemPopup.show')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);await settled();
  await viewport(740,360);assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`),'Short landscape fits');await viewport(720,450);await h.run(`{let s=document.createElement('style');s.textContent='.payment-settings-page :is(p,strong,h3,.payment-method-description){line-height:1.5!important;letter-spacing:.12em;word-spacing:.16em}';document.head.append(s);}`);assert(await h.run(`document.documentElement.scrollWidth<=innerWidth+1`),'Zoom-equivalent viewport and adjusted text spacing fit');
  assert.deepEqual(await h.run('fixtureErrors'), []);
  console.log('Payment Methods browser screenshots:', h.artifacts);
});
