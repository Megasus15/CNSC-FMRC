// Real shared portal scripts against isolated fixtures; no live customer mutations.
const test = require('node:test');
const assert = require('node:assert/strict');
const { browserFixture, chrome } = require('./helpers/website-browser.cjs');

for (const portal of ['admin', 'staff']) test(portal + ' manages consultations, quotation navigation and bounded modal scrolling', { skip: !chrome, timeout: 100000 }, async t => {
  const brief = { service_id: 2, name: 'Desk sign', description: 'A custom desk sign', quantity: 1, dimensions: '20 x 8 cm', material: 'PLA', colors: 'Maroon', instructions: 'Keep this exact note', customer_notes_version: 1 };
  const job = { id: 71, appointment_id: 51, service_id: 2, service_name: '3D Printing', state: 'ready_for_quote', stage: 'Preparing quotation', progress: 'ready_for_quote', revision: 1, discussed_at: '2026-11-09T02:00:00Z', requirements: brief, booking: {}, files: [], messages: [], quotations: [], orders: [], follow_ups: [], activity: [] };
  const base = { client_name: 'Fixture customer', purpose: '3D Printing', appointment_date: '2026-11-09', appointment_time: '9:00 - 10:00 AM', appointment_method: 'face_to_face', schedule_version: 2, attachments: [], can_archive: false, list_group: 'active', can_confirm_consultation: false };
  const records = [
    { ...base, id: 51, reference_no: 'AP-00051', status: 'Completed', created_at: '2026-11-10T02:00:00Z', archive_blocked_reason: 'Finish or close the custom work first.', custom_product: job },
    { ...base, id: 52, reference_no: 'AP-00052', status: 'Scheduled', created_at: '2026-11-11T02:00:00Z', can_confirm_consultation: true, archive_blocked_reason: 'Confirm the consultation first.' },
    { ...base, id: 53, reference_no: 'AP-00053', status: 'Completed', created_at: '2026-11-01T02:00:00Z', list_group: 'closed', work_closed_at: '2026-11-09T02:00:00Z', can_archive: true },
    { ...base, id: 54, reference_no: 'AP-00054', status: 'Completed', created_at: '2026-11-08T02:00:00Z', list_group: 'closed', work_closed_at: '2026-11-08T02:00:00Z', can_archive: true },
  ];
  let confirmations = 0, lastVersion, quoteWrites = 0, releaseConfirmation;
  const h = await browserFixture(t, async ({ req, route, json }) => {
    if (route === '/api/appointment-products/availability') { json({ data: { enabled: true, services: [{ id: 2, title: '3D Printing', modal_materials: ['PLA', 'Resin'], modal_best_for: ['Desk sign'] }] } }); return true; }
    if (route === '/api/appointments') { json({ data: records.filter(row => row.status !== 'Archived') }); return true; }
    if (route === '/api/admin/appointment-products/71') { json({ data: job }); return true; }
    if (route === '/api/admin/appointment-products/71/quotations') { quoteWrites++; json({ message: 'Navigation must not send a quotation.' }, 422); return true; }
    if (route === '/api/appointments/52/complete') {
      confirmations++; let body = ''; for await (const chunk of req) body += chunk;
      lastVersion = JSON.parse(body).expected_schedule_version;
      await new Promise(resolve => releaseConfirmation = resolve);
      Object.assign(records[1], { status: 'Completed', list_group: 'closed', work_closed_at: '2026-11-11T03:00:00Z', can_archive: true, archive_blocked_reason: null, can_confirm_consultation: false });
      json({ data: records[1] }); return true;
    }
    if (route === '/api/psgc/provinces') { json(Array.from({ length: 35 }, (_, i) => ({ code: String(i + 1).padStart(10, '0'), name: i ? 'Province ' + String(i).padStart(2, '0') : 'Camarines Norte' }))); return true; }
    if (/\/api\/psgc\/provinces\/\d+\/cities-municipalities/.test(route)) { json([{ code: '0000000011', name: 'Labo' }]); return true; }
    if (route === '/api/psgc/cities-municipalities/0000000011/barangays') { json(Array.from({ length: 35 }, (_, i) => ({ code: String(i).padStart(10, '0'), name: 'Barangay ' + String(i).padStart(2, '0') }))); return true; }
    return false;
  });
  await h.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await h.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await h.go('/' + portal + '-page/appointments.html');
  await h.until(`document.querySelectorAll('#appointmentsTableBody [data-view-id]').length===4`);
  assert.deepEqual(await h.run(`[...document.querySelectorAll('#appointmentsTableBody [data-view-id]')].map(n=>Number(n.dataset.viewId))`), [52, 51, 53, 54]);
  assert.equal(await h.run(`document.querySelectorAll('#appointmentsTableBody [data-complete-id],#appointmentsTableBody .appointment-complete-action').length`), 0);
  assert.equal(await h.run(`document.querySelector('[data-archive-id="51"]').disabled`), true);
  assert.match(await h.run(`document.querySelector('[data-archive-id="51"]').dataset.tooltip`), /custom work/);
  await h.run(`window.scrollTo(0,160);window.backgroundBefore=scrollY;document.querySelector('[data-view-id="52"]').click()`);
  await h.until(`document.querySelector('[data-confirm-consultation]')`);
  await h.run(`document.querySelector('[data-confirm-consultation]').click()`);
  await h.until(`document.getElementById('modalCompleteAppointment').classList.contains('show')`);
  assert.equal(await h.run(`document.getElementById('btnConfirmCompleteAppt').disabled`), true);
  await h.run(`document.getElementById('confirmConsultationAttendance').click();document.getElementById('btnConfirmCompleteAppt').click();document.getElementById('btnConfirmCompleteAppt').click()`);
  for (let i = 0; i < 100 && !releaseConfirmation; i++) await h.pause(20);
  assert.equal(confirmations, 1); assert.equal(lastVersion, 2);
  assert.equal(await h.run(`document.getElementById('btnCancelCompleteAppt').disabled`), true);
  releaseConfirmation();
  await h.until(`!document.getElementById('modalCompleteAppointment').classList.contains('show')&&!document.querySelector('[data-confirm-consultation]')`);
  assert.equal(await h.run(`document.getElementById('modalViewAppointment').classList.contains('show')&&document.documentElement.classList.contains('appointment-details-open')`), true);
  assert.deepEqual(await h.run(`[...document.querySelectorAll('#appointmentsTableBody [data-view-id]')].map(n=>Number(n.dataset.viewId))`), [51, 52, 53, 54]);
  await h.run(`document.getElementById('btnCloseApptView').click()`);
  await h.until(`!document.documentElement.classList.contains('appointment-details-open')`);
  assert.equal(await h.run(`scrollY===backgroundBefore`), true);

  await h.run(`document.querySelector('[data-view-id="51"]').click()`);
  await h.until(`document.querySelector('[data-ap-quotation-editor]')`);
  assert.equal(await h.run(`!!document.querySelector('[data-confirm-consultation]')`), false, 'Custom work uses its existing guided confirmation');
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    await h.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await h.run(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-ap-tab="0"]').click();document.querySelector('[data-ap-quotation-editor]').open=false;document.getElementById('apptViewBody').scrollTop=0;document.querySelector('[data-ap-go-quote="prepare"]').click()`);
    await h.until(`document.querySelector('[data-ap-quotation-editor]').open&&document.querySelector('[data-ap-tab="1"]').getAttribute('aria-selected')==='true'`);
    await h.pause(800);
    const fit = await h.run(`(()=>{const body=document.getElementById('apptViewBody').getBoundingClientRect(),target=document.querySelector('[data-ap-quotation-editor] summary').getBoundingClientRect();return {inside:target.top>=body.top&&target.bottom<=body.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,page:scrollY===backgroundBefore};})()`);
    assert.deepEqual(fit, { inside: true, overflow: false, page: true });
    await h.shot(portal + '-prepare-' + theme + '-' + width);
  }
  assert.equal(quoteWrites, 0);

  // Opening an already-expanded editor must keep its draft, not recreate it.
  await h.run(`(()=>{const input=document.querySelector('[data-ap-form=quotation] [name=spec_instructions]');input.value='Keep this unsent draft';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-ap-tab="0"]').click();document.querySelector('[data-ap-go-quote="prepare"]').click();})()`);
  assert.equal(await h.run(`document.querySelector('[data-ap-form=quotation] [name=spec_instructions]').value`), 'Keep this unsent draft');
  // Quotation address pickers use their own option scrollbar during keyboard navigation.
  await h.run(`(()=>{const form=document.querySelector('[data-ap-form=quotation]');form.elements.fulfillment_type.value='delivery';form.elements.fulfillment_type.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await h.until(`!document.querySelector('[data-ap-place-search=province]').disabled`);
  await h.run(`(()=>{const body=document.getElementById('apptViewBody'),input=document.querySelector('[data-ap-place-search=province]');body.scrollTop+=input.getBoundingClientRect().top-body.getBoundingClientRect().top-body.clientHeight/2;input.focus({preventScroll:true});window.modalBefore=body.scrollTop;})()`);
  await h.until(`document.querySelector('[data-ap-place=province] [role=listbox]').hidden===false`);
  await h.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', windowsVirtualKeyCode: 35 });
  await h.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End' });
  assert.equal(await h.run(`document.querySelector('[data-ap-place=province] [role=listbox]').scrollTop>0`), true);
  assert.equal(await h.run(`Math.abs(document.getElementById('apptViewBody').scrollTop-modalBefore)<2&&scrollY===backgroundBefore`), true);
  const menuFits = await h.run(`(()=>{const r=document.querySelector('[data-ap-place=province] [role=listbox]').getBoundingClientRect(),b=document.getElementById('apptViewBody').getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom;})()`);
  assert.equal(menuFits, true);
  await h.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
  await h.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
  assert.equal(await h.run(`document.querySelector('[data-ap-place=province] [role=listbox]').hidden&&document.getElementById('modalViewAppointment').classList.contains('show')`), true);
  await h.run(`document.querySelector('[data-ap-form=quotation]').dataset.dirty='false';document.getElementById('btnCloseApptView').click()`);
  await h.until(`!document.getElementById('modalViewAppointment').classList.contains('show')`);

  // View targets the current version, not a superseded record or revision form.
  const agreement = { specifications: brief, design_notes: 'Approved proof', proof_file_ids: [], unit_price: 100, product_subtotal: 100, shipping_fee: 0, total: 100, lead_time: 'Five working days', fulfillment_type: 'pickup', delivery: {} };
  Object.assign(job, { state: 'quoted', revision: 2, stage: 'Quotation ready', quotations: [
    { id: 80, version: 1, state: 'superseded', sent_at: '2026-11-10T02:00:00Z', expires_at: '2099-11-20T02:00:00Z', agreement },
    { id: 81, version: 2, state: 'sent', sent_at: '2026-11-11T02:00:00Z', expires_at: '2099-11-20T02:00:00Z', agreement },
  ] });
  await h.run(`window.dispatchEvent(new CustomEvent('fmrc:appointment-updated',{detail:{appointment:${JSON.stringify(records[0])}}}))`);
  await h.run(`document.querySelector('[data-view-id="51"]').click()`);
  await h.until(`document.querySelector('[data-ap-go-quote="view"]')`);
  await h.run(`document.querySelector('[data-ap-go-quote="view"]').click()`);
  await h.pause(800);
  assert.equal(await h.run(`document.activeElement.closest('[data-ap-quotation-record]')?.dataset.apQuotationRecord`), '81');
  assert.equal(await h.run(`document.querySelector('[data-ap-quotation-editor]').open`), false);
  assert.equal(quoteWrites, 0);
  assert.deepEqual(await h.run('fixtureErrors'), []);
  t.diagnostic('Screenshots: ' + h.artifacts);
});
