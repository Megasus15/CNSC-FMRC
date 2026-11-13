/* UCN intake belongs to the booking, not to quotation design proofs. */
(() => {
  const departments = {
    CCMS: 'College of Computing and Multimedia Studies', COENG: 'College of Engineering',
    CAS: 'College of Arts and Sciences', CBPA: 'College of Business and Public Administration',
    COED: 'College of Education', CANR: 'College of Agriculture and Natural Resources',
    CFAST: 'College of Fisheries, Aquatic Sciences, and Technology (formerly IFMS)', COTT: 'College of Trades and Technology',
  };
  let file = null, saved = null, removed = false, error = '', checking = false, generation = 0;
  const element = id => document.getElementById(id);
  const isUcn = () => element('aptRole')?.value === 'UCN College / Department';
  const current = () => isUcn() ? file || (!removed ? saved : null) : null;
  const label = () => isUcn() && departments[element('aptUniversityDepartment')?.value]
    ? `${element('aptUniversityDepartment').value} — ${departments[element('aptUniversityDepartment').value]}` : '';
  const size = value => `${(value / 1024 / 1024).toFixed(1)} MB`;
  function render() {
    if (!element('aptPurchaseRequest')) return;
    const ucn = isUcn(), selected = current();
    element('aptUniversityFields').hidden = !ucn;
    element('aptUniversityDepartment').disabled = !ucn;
    element('aptUniversityDepartment').required = ucn;
    element('aptPrField').hidden = !ucn;
    element('aptPurchaseRequest').disabled = !ucn || checking;
    element('aptPrName').textContent = selected ? `${selected.name} · ${size(selected.size)}` : 'No PR selected';
    element('aptPrChoose').textContent = selected ? 'Replace PR' : 'Choose PR';
    element('aptPrChoose').disabled = checking;
    element('aptPrRemove').hidden = !selected && !error;
    element('aptPrRemove').disabled = checking;
    element('aptPrStatus').textContent = checking ? 'Checking PR…' : error;
    element('aptPrStatus').hidden = !checking && !error;
    element('aptPrStatus').classList.toggle('is-error', !!error);
    element('aptPrSignIn').hidden = !!localStorage.getItem('customer_token');
    if (element('aptFileLabel')) element('aptFileLabel').textContent = ucn ? 'Supporting design files — Optional' : 'Attach Design Files (Optional)';
    if (element('aptFileLimits')) element('aptFileLimits').textContent = 'Up to 5 design files. 50 MB total' + (ucn ? ', including the PR' : '') + '. Images, PDF, Word, STL, OBJ, STEP/STP, IGES/IGS, DXF, DWG.';
  }
  function validation(designs = []) {
    if (isUcn() && checking) return 'Please wait while the PR is checked.';
    if (isUcn() && error) return error;
    const retained = window.FMRCAppointmentProducts?.selected() ? window.FMRCAppointmentProducts.savedDesignFiles() : [];
    const added = window.FMRCAppointmentProducts?.selected() ? window.FMRCAppointmentProducts.newFiles(designs) : designs;
    const total = [...retained, ...added, ...(current() ? [current()] : [])];
    if (retained.length + added.length > 5 || total.reduce((sum, f) => sum + Number(f.size), 0) > 50 * 1024 * 1024) return 'Keep up to five design files and one PR, totaling 50 MB or less.';
    if (total.length && !localStorage.getItem('customer_token')) return 'Sign in to attach private files. Use “Sign in & keep details” to return to this form.';
    return '';
  }
  window.FMRCAppointmentIntake = {
    isUcn, label, current, validate: validation,
    append(fd) {
      if (!isUcn()) return;
      fd.append('university_department', element('aptUniversityDepartment')?.value || '');
      if (file) fd.append('purchase_request', file);
      if (removed) fd.append('purchase_request_removed', '1');
    },
    saved(value, preserveEdits = false) {
      saved = value || null;
      if (!preserveEdits && file && saved && file.name === saved.name && file.size === Number(saved.size)) file = null;
      if (!preserveEdits) removed = false; render();
    },
    snapshot: () => ({file: file ? [file.name, file.size, file.lastModified] : null, saved: saved?.id, removed}),
    resumeData: () => ({file, saved, removed}),
    restore(value) { file = value?.file || null; saved = value?.saved || null; removed = !!value?.removed; error = ''; render(); },
    reset() { generation++; file = saved = null; removed = checking = false; error = ''; if (element('aptPurchaseRequest')) element('aptPurchaseRequest').value = ''; render(); },
    dirty: () => !!file || !!saved || removed || !!element('aptUniversityDepartment')?.value,
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (!element('aptRole')) return;
    if (![...element('aptRole').options].some(o => o.value === 'UCN College / Department')) element('aptRole').add(new Option('UCN College / Department', 'UCN College / Department'), 1);
    const anchor = element('aptFile')?.closest('.apt-input-group');
    if (!anchor) return;
    const fields = document.createElement('div'); fields.id = 'aptUniversityFields'; fields.className = 'apt-input-group apt-university-fields'; fields.hidden = true;
    fields.innerHTML = '<label for="aptUniversityDepartment">College / Department <span class="apt-required" aria-hidden="true">*</span></label><select id="aptUniversityDepartment" class="c-input" disabled><option value="">Select a UCN college or department</option></select><small>For requests made on behalf of a UCN college or department.</small>';
    anchor.before(fields);
    for (const [code, name] of Object.entries(departments)) element('aptUniversityDepartment').add(new Option(`${code} — ${name}`, code));
    const pr = document.createElement('div'); pr.id = 'aptPrField'; pr.className = 'apt-input-group apt-pr-field'; pr.hidden = true;
    pr.innerHTML = `<div class="file-upload-wrapper apt-pr-upload"><svg class="apt-pr-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/></svg><span class="file-upload-text" id="aptPrLabel">Purchase Request (PR) — Optional</span><small id="aptPrHelp">Upload your college or department’s PR, if available.</small><small id="aptPrLimits">One PDF, JPG, PNG, or WebP · up to 10 MB.</small><strong class="file-upload-name" id="aptPrName">No PR selected</strong><input id="aptPurchaseRequest" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden aria-labelledby="aptPrLabel" aria-describedby="aptPrHelp aptPrLimits aptPrName"><div class="apt-pr-actions"><button type="button" class="apt-btn apt-btn-back" id="aptPrChoose">Choose PR</button><button type="button" class="apt-btn apt-btn-back" id="aptPrRemove" hidden aria-label="Remove Purchase Request">Remove</button></div><small id="aptPrStatus" role="status" hidden></small><button type="button" class="apt-pr-sign-in" id="aptPrSignIn">Sign in &amp; keep details</button></div>`;
    anchor.before(pr);
    element('aptPrChoose').onclick = () => element('aptPurchaseRequest').click();
    element('aptPrRemove').onclick = () => { file = null; removed = true; error = ''; element('aptPurchaseRequest').value = ''; render(); element('aptPrChoose').focus(); };
    element('aptPrSignIn').onclick = () => window.FMRCAppointmentProducts?.signIn?.();
    element('aptPurchaseRequest').onchange = async event => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return;
      const attempt = ++generation; checking = true; error = ''; render();
      try {
        if (!/\.(pdf|jpe?g|png|webp)$/i.test(selected.name) || !['application/pdf','image/jpeg','image/png','image/webp'].includes(selected.type)) throw Error('Choose a PDF, JPG, PNG, or WebP PR.');
        if (selected.size > 10 * 1024 * 1024) throw Error('The PR must be 10 MB or smaller.');
        if (selected.type === 'application/pdf') {
          const content = await selected.text();
          if (!content.startsWith('%PDF-') || !content.includes('%%EOF')) throw Error('This PDF could not be read. Choose another file.');
        } else { const bitmap = await createImageBitmap(selected); bitmap.close(); }
        if (attempt === generation) { file = selected; removed = false; }
      } catch (failure) { if (attempt === generation) error = failure.message || 'This PR could not be read.'; }
      finally { if (attempt === generation) { checking = false; render(); } }
    };
    element('aptRole').addEventListener('change', render);
    render();
  });
})();
