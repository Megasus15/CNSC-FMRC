/* Admin-only editor. Public and generic content APIs cannot write this data. */
(() => {
  'use strict';
  function init() {
    if (!document.getElementById('inquiryDetailModal') || window.FMRCSupportSettings) return;
    const info = window.AdminSession?.getUserInfo(), role = (info?.data || info)?.role || window.AdminSession?.role;
    if (role !== 'admin') return;
    const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const clone = value => JSON.parse(JSON.stringify(value));
    const api = String(window.APP_API_BASE_URL || location.origin+'/api').replace(/\/+$/,'');
    const root = document.createElement('div'); root.className = 'modal-overlay portal-detail-dialog support-settings';
    root.id = 'supportSettingsModal'; root.dataset.portalDetailDialog = ''; root.dataset.portalDetailGuarded = ''; root.dataset.backdropClose = 'false';
    root.innerHTML = `<section class="modal-card portal-detail-dialog__card" role="dialog" aria-modal="true" aria-labelledby="supportSettingsTitle"><header class="portal-detail-dialog__header"><span class="portal-detail-dialog__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 11H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Zm0 7a4 4 0 0 1-4 4h-4"/></svg></span><div class="portal-detail-dialog__heading"><p class="portal-detail-dialog__eyebrow">Customer support</p><h2 class="modal-title portal-detail-dialog__title" id="supportSettingsTitle" tabindex="-1" data-portal-detail-heading>Support Settings</h2></div><button type="button" class="portal-detail-dialog__close" data-portal-detail-close aria-label="Close Support Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="portal-detail-dialog__body modal-body-scroll" tabindex="0" role="region" aria-label="Support settings"><p id="supportSettingsLoad" role="status">Loading support settings…</p><div id="supportSettingsEditor" hidden><div class="support-settings-tabs" role="tablist" aria-label="Support settings sections">${[['appearance','Appearance'],['answers','Answers'],['messages','Messages'],['preview','Preview']].map(([id,label]) => `<button class="btn-admin btn-secondary" type="button" role="tab" id="supportTab-${id}" aria-controls="supportSettingsFields" data-settings-tab="${id}" aria-selected="${id === 'appearance'}">${label}</button>`).join('')}</div><form id="supportSettingsFields" role="tabpanel" aria-labelledby="supportTab-appearance"></form></div><p id="supportSettingsError" class="support-inbox-error" role="alert" hidden></p></div><footer class="portal-detail-dialog__footer"><button class="btn-admin btn-secondary" type="button" id="supportSettingsDefaults">Use defaults</button><button class="btn-admin btn-secondary" type="button" id="supportSettingsCancel">Cancel</button><button class="btn-admin" type="button" id="supportSettingsSave" disabled>Save Changes</button></footer></section>`;
    document.body.append(root);
    const trigger = document.createElement('button'); trigger.className = 'btn-admin btn-secondary'; trigger.type = 'button'; trigger.id = 'supportSettingsOpen'; trigger.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i> Support Settings';
    document.querySelector('.toolbar-actions')?.prepend(trigger);
    const fields = root.querySelector('form'), save = root.querySelector('#supportSettingsSave'), error = root.querySelector('[role=alert]'), editor = root.querySelector('#supportSettingsEditor'), loading = root.querySelector('#supportSettingsLoad');
    let draft, baseline = '', defaults, revision, tab = 'appearance', faqKey, filter = '', pending = false, decision = false, installed = false;
    function dirty() { return !!draft && JSON.stringify(draft) !== baseline; }
    function note(text = '') { error.textContent = text; error.hidden = !text; }
    function sync() { save.disabled = pending || !installed || !dirty(); root.setAttribute('aria-busy',String(pending)); root.querySelectorAll('#supportSettingsDefaults,#supportSettingsCancel,.portal-detail-dialog__close').forEach(b => b.disabled = pending); }
    function confirm(message,title = 'Discard Changes',confirmText = 'Discard') {
      return new Promise(resolve => window.showAdminConfirmPopup(message,{title,confirmText,cancelText:'Cancel',onConfirm:() => resolve(true),onCancel:() => resolve(false)}));
    }
    async function request(method = 'GET', data) {
      const token = window.AdminSession.getToken();
      const response = await fetch(api+'/admin/support/assistant',{method,cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},body:data ? JSON.stringify(data) : undefined,signal:AbortSignal.timeout(20000)});
      if (token !== window.AdminSession.getToken()) throw Error('Your session changed. Reopen Support Settings.');
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(Object.values(result.errors || {}).flat()[0] || result.message || 'Support settings could not be saved. Your draft is kept.');
      return result;
    }
    function field(label,path,value,{type='text',max,help='',required=true,options,rows=4,multiple=false}={}) {
      const id = 'supportField-'+path.replace(/[^a-z0-9]/gi,'-');
      if (multiple) {
        const limit = path === 'config.suggestions' ? 6 : 3;
        return `<fieldset class="support-choice-group" id="${id}" data-choice-path="${esc(path)}" data-choice-limit="${limit}" aria-describedby="${id}-hint"><legend>${esc(label)}</legend><div class="support-choice-meta"><span data-choice-count role="status" aria-live="polite">${value.length} of ${limit} selected</span></div><p class="support-settings-hint" data-choice-limit-note hidden>Uncheck a selected option to choose another.</p>${options.length > 8 ? `<label class="support-choice-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" data-choice-search placeholder="Search" aria-label="Search ${esc(label)}"></label>` : ''}<div class="support-choice-list">${options.map(([v,text]) => `<label class="support-choice-option"><input type="checkbox" value="${esc(v)}" ${value.includes(v) ? 'checked' : ''}><span>${esc(text)}</span></label>`).join('')}</div><p class="support-settings-hint" id="${id}-hint">${esc(help || 'Choose up to '+limit+' destinations customers can open.')}</p></fieldset>`;
      }
      const attrs = `id="${id}" data-path="${esc(path)}" ${required ? 'required' : ''} ${max ? `maxlength="${max}"` : ''}`;
      let control = type === 'textarea' ? `<textarea ${attrs} rows="${rows}">${esc(value)}</textarea>` : type === 'select' ? `<select ${attrs} ${multiple ? 'multiple size="5"' : ''}>${options.map(([v,text]) => `<option value="${esc(v)}" ${(multiple ? value.includes(v) : value === v) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>` : `<input ${attrs} type="${type}" value="${esc(value)}">`;
      return `<label class="support-settings-field" for="${id}"><span>${esc(label)}</span>${control}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
    }
    function faq() { return draft?.faqs.find(row => row.key === faqKey); }
    function renderAppearance() {
      const c = draft.config;
      fields.innerHTML = `<p class="support-settings-hint">A welcoming help panel that belongs to FMRC. Changes go live after you save. Human messaging remains available when automated help is off.</p><label class="support-settings-check"><input type="checkbox" data-path="config.enabled" ${c.enabled ? 'checked' : ''}>Enable Quick help (built-in answers)</label><p class="support-settings-hint" style="margin-bottom:18px">This switch controls the automated guide only. Customer messages remain open when it is off.</p><div class="support-settings-grid">${field('Assistant name','config.name',c.name,{max:60})}${field('Launcher icon','config.icon',c.icon,{type:'select',options:[['brand','FMRC logo (default)'],['headset','Support headset'],['chat','Message bubble'],['help','Help circle']]})}${field('Launcher position','config.placement',c.placement,{type:'select',options:[['right','Bottom right'],['left','Bottom left']]})}${field('Action color','config.accent',c.accent,{type:'color',help:'A dark accent keeps white button labels readable.'})}${field('Header color','config.header_color',c.header_color,{type:'color'})}${field('Panel surface','config.surface',c.surface,{type:'color',help:'Use a light surface with readable text.'})}<div class="support-settings-field support-settings-full"><span>Assistant profile image</span><input type="file" id="supportAvatar" accept="image/png,image/jpeg,image/webp"><small>FMRC’s official logo is used by default. Uploaded PNG, JPEG or WebP images are resized privately in your browser to 512 px and 128 KB maximum.</small><button class="btn-admin btn-secondary" type="button" data-avatar-default>Use FMRC logo</button></div>${field('Suggested topics (up to 6)','config.suggestions',c.suggestions,{type:'select',multiple:true,required:false,options:draft.faqs.filter(f => f.enabled).map(f => [f.key,f.en.question]),help:'These topics welcome customers when Quick help opens.'})}</div>`;
    }
    function renderAnswers() {
      if (!faq() && draft.faqs.length) faqKey = draft.faqs[0].key;
      const f = faq();
      fields.innerHTML = `<p class="support-settings-hint">Write approved English and Filipino answers. The assistant matches questions and aliases; unclear questions offer related topics or the FMRC team.</p><div class="support-settings-answer-tools"><label class="support-settings-field"><span>Find an answer</span><input type="search" id="supportAnswerSearch" placeholder="Search" aria-label="Search approved answers" value="${esc(filter)}"></label><button type="button" class="btn-admin btn-secondary" data-faq-add ${draft.faqs.length >= 100 ? 'disabled' : ''}>Add Answer</button></div><label class="support-settings-field"><span>Answer to edit</span><select id="supportAnswerSelect">${draft.faqs.filter(row => !filter || (row.en.question+' '+row.fil.question+' '+row.aliases.join(' ')).toLowerCase().includes(filter.toLowerCase())).map(row => `<option value="${esc(row.key)}" ${row.key === faqKey ? 'selected' : ''}>${esc(row.en.question || 'New answer')}${row.enabled ? '' : ' (hidden)'}</option>`).join('')}</select></label>${!f ? '<p class="support-settings-hint">Add an answer to begin.</p>' : `<label class="support-settings-check"><input type="checkbox" data-faq-field="enabled" ${f.enabled ? 'checked' : ''}>Show this answer to customers</label>${['en','fil'].map(lang => `<fieldset class="support-settings-section"><legend>${lang === 'en' ? 'English' : 'Filipino'}</legend><div class="support-settings-grid">${field('Customer question','faq.'+lang+'.question',f[lang].question,{max:150})}${field('Answer','faq.'+lang+'.answer',f[lang].answer,{type:'textarea',max:2500})}<div class="support-settings-full">${field('Step-by-step instructions','faq.'+lang+'.steps',f[lang].steps.join('\n'),{type:'textarea',max:6100,required:false,help:'One step per line. Up to 12 steps, 500 characters each.'})}</div></div></fieldset>`).join('')}<div class="support-settings-grid" style="margin-top:18px">${field('Alternative questions and keywords','faq.aliases',f.aliases.join('\n'),{type:'textarea',max:3700,required:false,help:'One phrase per line. Include common English, Filipino and Taglish wording; up to 30 phrases.'})}${field('Helpful destinations (up to 3)','faq.actions',f.actions,{type:'select',multiple:true,required:false,options:[['products','Products'],['appointments','Set an Appointment'],['orders','My Orders'],['contact','Contact'],['terms','Transaction Terms'],['refunds','Refund Policy'],['signin','Customer Sign In'],['account','Customer Account']]})}</div><div style="margin-top:18px"><button type="button" class="btn-admin btn-secondary" data-faq-remove>Remove Answer</button></div>`}`;
    }
    function renderMessages() {
      fields.innerHTML = `<p class="support-settings-hint">Keep messages helpful and clear. Live availability is based on connected team members; these words do not promise a response time.</p>${[['welcome','Welcome message'],['offline','Team unavailable'],['fallback','No clear answer']].map(([key,title]) => `<fieldset class="support-settings-section"><legend>${title}</legend><div class="support-settings-grid">${field('English','config.'+key+'.en',draft.config[key].en,{type:'textarea',max:300})}${field('Filipino','config.'+key+'.fil',draft.config[key].fil,{type:'textarea',max:300})}</div></fieldset>`).join('')}`;
    }
    function renderPreview() {
      const c = draft.config, f = faq() || draft.faqs.find(f => f.enabled), brand = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.avatar || '') ? c.avatar : '../images/FMRC Logo.png';
      fields.innerHTML = `<p class="support-settings-hint" style="margin-bottom:18px">Customer preview · English. Switch to a narrow window to review the mobile layout. This preview sends no messages.</p><div class="support-settings-preview"><header><span><img src="${esc(brand)}" alt=""></span><div><strong>${esc(c.name)}</strong><small>FMRC guide · approved answers</small></div></header><div><p>${esc(c.welcome.en)}</p>${f ? `<h3>${esc(f.en.question)}</h3><p>${esc(f.en.answer)}</p><ol>${f.en.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}<div class="preview-topic">Message the FMRC team</div></div></div>`;
      const p = fields.querySelector('.support-settings-preview');
      for (const [key,value] of [['accent',c.accent],['header',c.header_color],['surface',c.surface]]) if (/^#[a-f\d]{6}$/i.test(value)) p.style.setProperty('--preview-'+key,value);
    }
    function render() {
      if (!draft) return;
      root.querySelectorAll('[data-settings-tab]').forEach(button => { const active = button.dataset.settingsTab === tab; button.setAttribute('aria-selected',String(active)); button.tabIndex = active ? 0 : -1; });
      fields.setAttribute('aria-labelledby','supportTab-'+tab);
      ({appearance:renderAppearance,answers:renderAnswers,messages:renderMessages,preview:renderPreview})[tab](); updateChoices(); sync();
    }
    function updateChoices() {
      fields.querySelectorAll('[data-choice-path]').forEach(group => {
        const boxes = [...group.querySelectorAll('.support-choice-option input')], count = boxes.filter(box => box.checked).length, limit = Number(group.dataset.choiceLimit);
        group.querySelector('[data-choice-count]').textContent = count+' of '+limit+' selected';
        group.querySelector('[data-choice-limit-note]').hidden = count < limit;
        boxes.forEach(box => { box.disabled = !box.checked && count >= limit; });
      });
    }
    function capture() {
      if (!draft) return;
      for (const node of fields.querySelectorAll('[data-path]')) {
        const path = node.dataset.path.split('.'); let value = node.type === 'checkbox' ? node.checked : node.multiple ? [...node.selectedOptions].map(o => o.value) : node.value;
        if (path[0] === 'faq' && !faq()) continue;
        const target = path.shift() === 'faq' ? faq() : draft.config;
        if (['steps','aliases'].includes(path.at(-1))) value = String(value).split('\n').map(s => s.trim()).filter(Boolean);
        let object = target; while (path.length > 1) object = object[path.shift()]; object[path[0]] = value;
      }
      for (const group of fields.querySelectorAll('[data-choice-path]')) {
        const path = group.dataset.choicePath.split('.');
        if (path[0] === 'faq' && !faq()) continue;
        const target = path.shift() === 'faq' ? faq() : draft.config;
        target[path[0]] = [...group.querySelectorAll('.support-choice-option input:checked')].map(node => node.value);
      }
      const enabled = fields.querySelector('[data-faq-field="enabled"]'); if (enabled && faq()) faq().enabled = enabled.checked;
      updateChoices(); sync();
    }
    async function close() {
      if (pending || decision) return;
      if (dirty()) { decision = true; const discard = await confirm('Discard your unsaved support settings? Published answers will stay unchanged.'); decision = false; if (!discard) return; }
      root.classList.remove('show'); draft = undefined; baseline = '';
    }
    window.PortalDetailDialog?.registerClose(root,close);
    root.querySelector('#supportSettingsCancel').onclick = close;
    trigger.onclick = async () => {
      if (pending) return; draft = undefined; baseline = ''; note(); editor.hidden = true; loading.hidden = false; loading.textContent = 'Loading support settings…'; sync();
      window.PortalDetailDialog?.open(root);
      try { const result = await request(); if (!root.classList.contains('show')) return; defaults = result.defaults; revision = result.data.revision; installed = result.data.installed; draft = clone({config:result.data.config,faqs:result.data.faqs}); baseline = JSON.stringify(draft); faqKey = draft.faqs[0]?.key; tab = 'appearance'; filter = ''; editor.hidden = false; loading.hidden = true; render(); if (!installed) note('Support setup is required before settings can be saved. Quick help and the existing Contact form remain available.'); }
      catch (e) { loading.hidden = true; note(e.message); }
    };
    fields.addEventListener('submit',event => event.preventDefault());
    fields.addEventListener('input',event => {
      if (event.target.matches('[data-choice-search]')) {
        const query = event.target.value.toLowerCase().trim();
        event.target.closest('[data-choice-path]').querySelectorAll('.support-choice-option').forEach(label => { label.hidden = !label.textContent.toLowerCase().includes(query); });
        return;
      }
      if (event.target.id === 'supportAnswerSearch') { filter = event.target.value; const select = fields.querySelector('#supportAnswerSelect'); select.innerHTML = draft.faqs.filter(f => (f.en.question+' '+f.fil.question+' '+f.aliases.join(' ')).toLowerCase().includes(filter.toLowerCase())).map(f => `<option value="${esc(f.key)}" ${f.key === faqKey ? 'selected' : ''}>${esc(f.en.question || 'New answer')}</option>`).join(''); return; }
      capture();
    });
    fields.addEventListener('change',async event => {
      if (event.target.id === 'supportAnswerSelect') { capture(); faqKey = event.target.value; render(); return; }
      if (event.target.id === 'supportAvatar') {
        const file = event.target.files?.[0]; if (!file) return;
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5*1024*1024) { note('Choose a PNG, JPEG or WebP image under 5 MB.'); return; }
        const source = URL.createObjectURL(file), activeDraft = draft;
        try {
          const image = new Image(); image.src = source; await image.decode();
          const ratio = Math.min(1,512/image.width,512/image.height), canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(image.width*ratio)); canvas.height = Math.max(1,Math.round(image.height*ratio)); canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
          const data = canvas.toDataURL('image/webp',.82); if (data.length > 174780) throw Error('This image is too detailed. Choose a smaller image under 128 KB.');
          if (draft !== activeDraft || !root.classList.contains('show')) return;
          draft.config.avatar = data; note(); sync();
        } catch (e) { note(e.message || 'This image could not be opened.'); } finally { URL.revokeObjectURL(source); }
        return;
      }
      capture();
    });
    root.addEventListener('click',async event => {
      const button = event.target.closest('button'); if (!button || pending || decision || !draft) return;
      if (button.dataset.settingsTab) { capture(); tab = button.dataset.settingsTab; note(); render(); return; }
      if (button.hasAttribute('data-avatar-default')) { draft.config.avatar = ''; sync(); return; }
      if (button.hasAttribute('data-faq-add')) {
        capture(); const key = 'faq-'+crypto.randomUUID(); draft.faqs.push({key,enabled:true,en:{question:'',answer:'',steps:[]},fil:{question:'',answer:'',steps:[]},aliases:[],actions:[]}); faqKey = key; filter = ''; render(); return;
      }
      if (button.hasAttribute('data-faq-remove')) { decision = true; const remove = await confirm('Remove this answer from your draft? Customers will see the change only after you save.','Remove Answer','Remove'); decision = false; if (remove) { draft.faqs = draft.faqs.filter(f => f.key !== faqKey); draft.config.suggestions = draft.config.suggestions.filter(key => key !== faqKey); faqKey = draft.faqs[0]?.key; render(); } }
    });
    root.querySelector('#supportSettingsDefaults').onclick = async () => { if (pending || decision || !defaults) return; decision = true; const restore = await confirm('Use the original FMRC appearance and approved answers in this draft? Save Changes will publish them.','Use Support Defaults','Use defaults'); decision = false; if (restore) { draft = clone(defaults); faqKey = draft.faqs[0]?.key; note(); render(); } };
    save.onclick = async () => {
      if (pending || !dirty() || !installed) return; capture(); if (!fields.reportValidity()) return;
      pending = true; sync(); note(); fields.inert = true;
      try { const result = await request('PUT',{...draft,revision}); draft = clone({config:result.data.config,faqs:result.data.faqs}); revision = result.data.revision; baseline = JSON.stringify(draft); render(); window.showAdminPopup?.('Support settings saved. Customers will receive the updated help panel when it next opens.',{title:'Support Settings Saved'}); }
      catch (e) { note(e.message); }
      finally { pending = false; fields.inert = false; sync(); }
    };
    root.addEventListener('keydown',event => { const button = event.target.closest('[role=tab]'); if (button && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); const buttons = [...root.querySelectorAll('[role=tab]')], index = buttons.indexOf(button), target = buttons[(index+(event.key === 'ArrowRight' ? 1 : buttons.length-1))%buttons.length]; target.click(); target.focus(); } });
    window.FMRCSupportSettings = {open:() => trigger.click()};
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
