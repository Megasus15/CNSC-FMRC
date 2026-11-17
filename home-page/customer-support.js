/* One native Customer help panel and private support inbox. */
(() => {
  'use strict';
  if (window.FMRCSupport || /\/(?:admin-page|staff-page|admin-auth)\//.test(location.pathname)) return;
  const VERSION = '2026.1117.2';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const icons = {
    chat:svg('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 9h8M7 13h5"/>'),
    headset:svg('<path d="M4 13v-2a8 8 0 0 1 16 0v2M4 11H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Zm0 7a4 4 0 0 1-4 4h-4"/>'),
    help:svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.8-1.5 1.3-1.5 2.5M12 17h.01"/>'),
    close:svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    send:svg('<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>'),
    back:svg('<path d="m14 6-6 6 6 6"/>'),
    next:svg('<path d="m10 6 6 6-6 6"/>'),
    delete:svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'),
  };
  const words = {
    en:{help:'Quick help',team:'Message FMRC',auto:'FMRC guide · built-in answers',language:'Answer language',question:'Ask about FMRC',message:'Your message',send:'Send message',placeholder:'Type your question…',messagePlaceholder:'Write a message…',privacy:'Text messages only. Never share passwords, one-time codes or bank credentials.',available:'Team available',away:'Team away · messages are open',history:'Your conversations',new:'New inquiry',back:'History',end:'End chat',ended:'This chat has ended.',reopen:'Reopen chat',remove:'Delete from history',selected:'Delete selected',selectAll:'Select ended chats on this page',endFirst:'End this chat before deleting its history.',empty:'No conversations yet. Start an inquiry and the FMRC team can reply here.',signin:'Sign in to message FMRC',signNote:'Quick help is available without an account. Sign in for private messages and saved conversation history.',start:'Start a conversation',loading:'Loading conversation…',more:'Earlier messages',reset:'Start over',previous:'Previous',next:'Next',cancel:'Cancel',keep:'Keep history',endTitle:'End this chat?',endNote:'This closes the conversation without deleting it. You can reopen it or start a new inquiry.',deleteTitle:'Delete from your history?',deleteNote:'Only ended chats can be removed. They will disappear from your history. FMRC keeps its inquiry records.',unavailable:'This conversation is no longer available.',confirmDelete:'Delete history',endedEvent:'Chat ended by the customer.',reopenedEvent:'Chat reopened.',newMessages:'New messages — go to latest',failed:'Your message was not sent. Your draft is kept. Please try again.',helpUnavailable:'Quick help could not be loaded. Try again or use the Contact page.',contact:'Open Contact',refresh:'Try again',sent:'Message sent.',wait:'Please wait…',page:'Page',closed:'Ended',open:'Open',consent:'I agree to the use of my account and message to handle this support inquiry.',consentRequired:'Please confirm the support privacy notice before sending a new inquiry.',continue:'Send this question to FMRC',setup:'Chat setup is still in progress. Please use Send Us a Message on the Contact page.',helpPaused:'Quick help is paused',helpPausedNote:'You can still send a message to the FMRC team. Your conversation and replies will appear here.',teamWelcome:'Let’s talk about your question',teamWelcomeNote:'Send a message about your question or project. We’ll keep the conversation here so you can return to it.',teamAwayNote:'Our team is away right now. You can send a message now and check back for a reply.',greetingTitle:'Hello! Welcome to FMRC.',knowledgeLoading:'Getting FMRC Help ready…',knowledgeFailed:'Help could not be loaded'},
    fil:{help:'Mabilis na tulong',team:'Message FMRC',auto:'Gabay ng FMRC · nakahandang sagot',language:'Wika ng sagot',question:'Magtanong tungkol sa FMRC',message:'Iyong mensahe',send:'Ipadala ang mensahe',placeholder:'Ilagay ang iyong tanong…',messagePlaceholder:'Sumulat ng mensahe…',privacy:'Text lamang. Huwag magbahagi ng password, one-time code o bank credentials.',available:'Available ang team',away:'Wala ang team · puwedeng mag-message',history:'Mga pag-uusap mo',new:'Bagong inquiry',back:'History',end:'Tapusin ang chat',ended:'Tapos na ang chat na ito.',reopen:'Buksan muli ang chat',remove:'Tanggalin sa history',selected:'Tanggalin ang napili',selectAll:'Piliin ang mga tapos na chat sa pahinang ito',endFirst:'Tapusin muna ang chat bago tanggalin sa history.',empty:'Wala pang pag-uusap. Magsimula ng inquiry upang makasagot dito ang FMRC team.',signin:'Mag-sign in para sa Message FMRC',signNote:'Puwedeng gumamit ng mabilis na tulong kahit walang account. Mag-sign in para sa pribadong mensahe at conversation history.',start:'Magsimula ng pag-uusap',loading:'Kinukuha ang pag-uusap…',more:'Naunang mga mensahe',reset:'Magsimula muli',previous:'Nakaraan',next:'Susunod',cancel:'Kanselahin',keep:'Panatilihin',endTitle:'Tapusin ang chat na ito?',endNote:'Isasara nito ang pag-uusap nang hindi binubura. Maaari mo itong buksan muli o gumawa ng bagong inquiry.',deleteTitle:'Tanggalin sa iyong history?',deleteNote:'Tapos na chat lamang ang matatanggal. Mawawala ito sa iyong history. Mananatili ang inquiry records ng FMRC.',unavailable:'Hindi na available ang pag-uusap na ito.',confirmDelete:'Tanggalin sa history',endedEvent:'Tinapos ng customer ang chat.',reopenedEvent:'Muling binuksan ang chat.',newMessages:'Bagong mensahe — tingnan ang pinakabago',failed:'Hindi naipadala ang mensahe. Napanatili ang iyong draft. Subukan muli.',helpUnavailable:'Hindi makuha ang mabilis na tulong. Subukan muli o buksan ang Contact.',contact:'Buksan ang Contact',refresh:'Subukan muli',sent:'Naipadala ang mensahe.',wait:'Sandali lamang…',page:'Pahina',closed:'Tapos na',open:'Bukas',consent:'Pumapayag ako sa paggamit ng aking account at mensahe para tugunan ang support inquiry na ito.',consentRequired:'Kumpirmahin muna ang support privacy notice bago magpadala ng bagong inquiry.',continue:'Ipadala ang tanong sa FMRC',setup:'Inihahanda pa ang chat. Gamitin muna ang Send Us a Message sa Contact page.',helpPaused:'Naka-pause ang mabilis na tulong',helpPausedNote:'Maaari ka pa ring mag-message sa FMRC team. Makikita rito ang pag-uusap at mga sagot.',teamWelcome:'Pag-usapan natin ang iyong tanong',teamWelcomeNote:'Magpadala ng tanong tungkol sa iyong proyekto o pangangailangan. Maaari mong balikan dito ang pag-uusap.',teamAwayNote:'Wala pang available na team member. Maaari kang mag-iwan ng mensahe ngayon at balikan ang sagot.',greetingTitle:'Kumusta! Maligayang pagdating sa FMRC.',knowledgeLoading:'Inihahanda ang FMRC Help…',knowledgeFailed:'Hindi makuha ang tulong'},
  };
  const defaults = {enabled:true,name:'FMRC Help',icon:'brand',placement:'right',accent:'#6b202b',header_color:'#561b26',surface:'#fdfaf6',avatar:'',welcome:{en:'How can we help?',fil:'Paano kami makatutulong?'},offline:{en:'The team is away. Leave a message and check back for a reply.',fil:'Wala pang available na team member. Mag-iwan ng mensahe at balikan ang sagot.'},fallback:{en:'Choose a related topic or message FMRC.',fil:'Pumili ng kaugnay na paksa o i-message ang FMRC.'},suggestions:[]};
  const root = document.createElement('aside'); root.className = 'fmrc-support'; root.dataset.version = VERSION;
  root.innerHTML = `<button class="fmrc-support__launcher" type="button" aria-controls="fmrcSupportPanel" aria-expanded="false">${icons.headset}<span>FMRC Help</span><span class="fmrc-support__count" hidden></span></button><section id="fmrcSupportPanel" class="fmrc-support__panel" role="dialog" aria-modal="false" aria-labelledby="fmrcSupportTitle" hidden><header class="fmrc-support__header"><span class="fmrc-support__avatar">${icons.headset}</span><div class="fmrc-support__heading"><h2 id="fmrcSupportTitle">FMRC Help</h2><p id="fmrcSupportSubtitle"></p></div><button type="button" data-support-close aria-label="Minimize FMRC Help">${icons.close}</button></header><div class="fmrc-support__tabs" role="tablist" aria-label="Support options"><button type="button" role="tab" id="supportHelpTab" aria-controls="supportBody" data-support-tab="help" aria-selected="true"></button><button type="button" role="tab" id="supportTeamTab" aria-controls="supportBody" data-support-tab="team" aria-selected="false"></button></div><div class="fmrc-support__body" id="supportBody" role="tabpanel" aria-labelledby="supportHelpTab" tabindex="0"></div><form class="fmrc-support__composer" id="supportComposer"><label for="supportInput"></label><div class="fmrc-support__compose-row"><textarea id="supportInput" rows="1" maxlength="500"></textarea><button type="submit" aria-label="Send message">${icons.send}</button></div><p class="fmrc-support__note" id="supportInputHint"></p></form><p class="fmrc-support__error" id="supportError" role="alert" hidden></p></section>`;
  document.body.append(root);
  const panel = root.querySelector('.fmrc-support__panel'), body = root.querySelector('.fmrc-support__body'), launcher = root.querySelector('.fmrc-support__launcher'), composer = root.querySelector('form'), input = root.querySelector('textarea'), error = root.querySelector('#supportError');
  let language = localStorage.getItem('fmrc_support_language') === 'fil' ? 'fil' : 'en';
  let pack = {config:defaults,faqs:[],installed:false}, etag = '', loaded = false, knowledgePending = false, knowledgeTask = null, available = false;
  let mode = 'help', view = 'history', conversation = null, entries = [], hasEarlier = false;
  let list = [], page = 1, pages = 1, selected = new Set(), log = [], latestQuestion = '';
  let identity = owner(), accountKey = String(user().id || 'guest'), generation = 0, busy = false, loading = false, pollBusy = false, failures = 0, opener = null, timer, availabilityAt = 0, confirmation = null;
  const drafts = new Map(), requests = new Map();
  let savedView;
  try { savedView = JSON.parse(sessionStorage.getItem('fmrc_support_view:'+accountKey) || 'null'); } catch {}
  if (savedView && Date.now()-savedView.at < 30*60*1000) { mode = savedView.mode === 'team' ? 'team' : 'help'; }
  function rememberView() {
    if (!token()) return;
    try { sessionStorage.setItem('fmrc_support_view:'+accountKey,JSON.stringify({mode,id:conversation?.id || null,open:!panel.hidden,at:Date.now()})); } catch {}
  }
  const t = key => words[language][key];
  function token() { try { return (localStorage.getItem('customer_token') || '').replace(/^Bearer\s+/i, '').trim(); } catch { return ''; } }
  function user() { try { return JSON.parse(localStorage.getItem('customer_info') || '{}') || {}; } catch { return {}; } }
  function owner() { return String(user().id || '') + ':' + token(); }
  function url(path) { return window.FMRCApp?.url(path) || path; }
  function api() { return String(window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !['8000','80',''].includes(location.port) ? location.protocol + '//' + location.hostname + ':8000/api' : location.origin + '/api')).replace(/\/+$/, ''); }
  function textError(message = '') { error.textContent = message; error.hidden = !message; }
  function currentDraft() { return mode === 'help' ? 'help' : String(conversation?.id || 'new'); }
  function date(value) { const d = new Date(value); return Number.isNaN(+d) ? '' : d.toLocaleString(language === 'fil' ? 'fil-PH' : 'en-PH', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}); }
  async function request(path, options = {}, privateRequest = true) {
    const started = owner();
    const response = await fetch(api() + path, {...options,cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',...(privateRequest ? {Authorization:'Bearer '+token()} : {}),...(options.headers || {})},signal:AbortSignal.timeout(15000)});
    if (privateRequest && started !== owner()) throw Object.assign(Error('Session changed.'),{stale:true});
    if (response.status === 304) return {unchanged:true};
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { const first = Object.values(result.errors || {}).flat()[0]; throw Object.assign(Error(first || result.message || (response.status === 401 ? t('signin') : t('failed'))),{status:response.status}); }
    return {...result,etag:response.headers.get('ETag')};
  }
  function resetPrivate() {
    try { sessionStorage.removeItem('fmrc_support_view:'+accountKey); } catch {}
    identity = owner(); accountKey = String(user().id || 'guest'); generation++; conversation = null; entries = []; list = []; selected.clear(); drafts.clear(); requests.clear(); log = []; latestQuestion = ''; page = 1; pages = 1; view = 'history'; busy = false; loading = false;
    input.value = ''; savedView = null; root.querySelector('.fmrc-support__count').hidden = true; textError(); closeConfirmation();
    if (!panel.hidden) render();
  }
  function sessionCheck() { if (identity !== owner()) resetPrivate(); }
  async function knowledge() {
    if (knowledgeTask) return knowledgeTask;
    knowledgePending = true;
    knowledgeTask = loadKnowledge();
    try { return await knowledgeTask; } finally { knowledgeTask = null; knowledgePending = false; }
  }
  async function loadKnowledge() {
    try {
      const result = await request('/support/assistant', {headers:etag ? {'If-None-Match':etag} : {}}, false);
      if (!result.unchanged && result.data?.config) { pack = {...result.data,config:{...defaults,...result.data.config}}; etag = result.etag || ''; }
      loaded = true; applyBrand();
    } catch { loaded = false; }
  }
  function applyBrand() {
    const c = pack.config;
    for (const [key,value] of [['accent',c.accent],['header',c.header_color],['surface',c.surface]]) if (/^#[a-f\d]{6}$/i.test(value)) root.style.setProperty('--help-'+key,value);
    root.style.right = c.placement === 'left' ? 'auto' : 'var(--help-gap)'; root.style.left = c.placement === 'left' ? 'var(--help-gap)' : 'auto';
    panel.style.right = c.placement === 'left' ? 'auto' : '0'; panel.style.left = c.placement === 'left' ? '0' : 'auto';
    root.querySelector('#fmrcSupportTitle').textContent = c.name;
    launcher.querySelector('span').textContent = c.name;
    const brand = `<img class="fmrc-support__brand" src="${esc(url('/images/FMRC%20Logo.png'))}" alt="" width="32" height="32">`;
    launcher.firstElementChild.outerHTML = c.icon === 'brand' ? brand : (icons[c.icon] || brand);
    const avatar = root.querySelector('.fmrc-support__avatar');
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.avatar || '')) { avatar.replaceChildren(Object.assign(new Image(), {src:c.avatar,alt:''})); }
    else avatar.innerHTML = brand;
  }
  function actionUrl(action) { return url(({products:'/products-page/product.html',appointments:'/home-page/?appointment=1',orders:'/home-page/?orders=1',contact:'/contact-page/contact.html',terms:'/products-page/transaction-terms.html',refunds:'/products-page/refund-policy.html',signin:'/customer-auth/auth.html#login',account:'/home-page/?account=1'})[action] || '/contact-page/contact.html'); }
  function actionLabel(action) { return ({products:'Products',appointments:'Set an Appointment',orders:'My Orders',contact:'Contact',terms:'Transaction Terms',refunds:'Refund Policy',signin:'Sign In',account:'My Account'})[action] || 'Contact'; }
  function topicButtons(faqs) { return `<div class="fmrc-support__suggestions">${faqs.map(f => `<button type="button" data-support-topic="${esc(f.key)}"><span>${esc(f[language]?.question || f.en.question)}</span>${icons.next}</button>`).join('')}</div>`; }
  function brandHtml(size = 40) { return `<img src="${esc(url('/images/FMRC%20Logo.png'))}" alt="" width="${size}" height="${size}">`; }
  function stateCard(title,description,action,label) {
    return `<div class="fmrc-support__state-card"><span class="fmrc-support__state-logo">${brandHtml(48)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<button type="button" class="fmrc-support__primary" ${action}>${esc(label)}</button>` : ''}</div>`;
  }
  function helpLogRow(row) {
    if (row.question !== undefined) return `<p class="fmrc-support__bubble fmrc-support__bubble--own">${esc(row.question)}</p>`;
    if (row.greeting) return `<article class="fmrc-support__bubble"><div class="fmrc-support__sender">${brandHtml(27)}<span>FMRC guide</span></div><strong>${esc(t('greetingTitle'))}</strong><p>${esc(pack.config.welcome[language])}</p></article>`;
    if (row.faq) return answerHtml(row.faq);
    return `<article class="fmrc-support__bubble"><p>${esc(pack.config.fallback[language])}</p>${topicButtons(row.suggestions || [])}</article>`;
  }
  function answerHtml(faq) {
    const a = faq[language] || faq.en;
    return `<article class="fmrc-support__bubble"><div class="fmrc-support__sender"><img src="${esc(url('/images/FMRC%20Logo.png'))}" alt="" width="27" height="27"><span>FMRC guide</span></div><strong>${esc(a.question)}</strong><p class="fmrc-support__plain">${esc(a.answer)}</p>${a.steps?.length ? '<ol>'+a.steps.map(step => `<li>${esc(step)}</li>`).join('')+'</ol>' : ''}<div class="fmrc-support__links">${(faq.actions || []).filter(a => ['products','appointments','orders','contact','terms','refunds','signin','account'].includes(a)).map(a => `<a href="${esc(actionUrl(a))}">${esc(actionLabel(a))}</a>`).join('')}</div></article>`;
  }
  function renderHelp() {
    const suggested = pack.config.suggestions.map(key => pack.faqs.find(f => f.key === key)).filter(Boolean);
    panel.dataset.supportView = !loaded ? 'help-loading' : !pack.config.enabled ? 'help-paused' : 'help';
    const languageControl = `<div class="fmrc-support__language"><label for="supportLanguage">${esc(t('language'))}</label><select id="supportLanguage"><option value="en" ${language === 'en' ? 'selected' : ''}>English</option><option value="fil" ${language === 'fil' ? 'selected' : ''}>Filipino</option></select></div>`;
    if (!loaded) {
      body.innerHTML = languageControl + stateCard(t(knowledgePending ? 'knowledgeLoading' : 'knowledgeFailed'),knowledgePending ? '' : t('helpUnavailable'),knowledgePending ? '' : 'data-support-retry',t('refresh'));
    } else if (!pack.config.enabled) {
      body.innerHTML = languageControl + stateCard(t('helpPaused'),t('helpPausedNote'),'data-support-handoff',t('team'));
    } else {
      body.innerHTML = `${languageControl}<p class="fmrc-support__welcome">${esc(pack.config.welcome[language])}</p>${suggested.length ? `<p class="fmrc-support__eyebrow">${language === 'fil' ? 'Mga mungkahing paksa' : 'Suggested topics'}</p>`+topicButtons(suggested) : ''}<div role="log" aria-live="polite" aria-relevant="additions" id="supportHelpLog">${log.map(helpLogRow).join('')}</div><div class="fmrc-support__toolbar">${log.length ? `<button data-support-reset type="button">${esc(t('reset'))}</button>` : '<span></span>'}<button data-support-handoff type="button">${esc(t('team'))}</button></div>`;
    }
    composer.hidden = !loaded || !pack.config.enabled; setupComposer();
  }
  function statusHtml() { return `<div class="fmrc-support__status" data-available="${available}"><span class="fmrc-support__dot"></span><span>${esc(available ? t('available') : t('away'))}</span></div>`; }
  function renderHistory() {
    composer.hidden = true;
    panel.dataset.supportView = list.length ? 'team-history' : 'team-empty';
    body.innerHTML = `${statusHtml()}<div class="fmrc-support__toolbar"><strong>${esc(t('history'))}</strong>${list.length ? `<button type="button" class="fmrc-support__primary" data-support-new>${esc(t('new'))}</button>` : ''}</div><p class="fmrc-support__note">${esc(language === 'fil' ? 'Makikita rito ang mga sagot ng FMRC at ang iyong mga dating pag-uusap.' : 'Your conversations and replies from the FMRC team appear here.')}</p>${loading ? `<p role="status">${esc(t('loading'))}</p>` : !list.length ? stateCard(t('teamWelcome'),available ? t('teamWelcomeNote') : t('teamAwayNote'),'data-support-new',t('start')) : `<label class="fmrc-support__select-all"><input type="checkbox" data-support-select-all ${list.filter(c => c.status === 'resolved').length && list.filter(c => c.status === 'resolved').every(c => selected.has(c.id)) ? 'checked' : ''}>${esc(t('selectAll'))}</label><div class="fmrc-support__history-list">${list.map(c => `<div class="fmrc-support__history-row"><label class="fmrc-support__history-check" title="${esc(c.status === 'resolved' ? t('selectAll') : t('endFirst'))}"><input type="checkbox" data-support-select="${c.id}" aria-label="Select conversation ${c.id}" ${selected.has(c.id) ? 'checked' : ''} ${c.status !== 'resolved' ? 'disabled' : ''}></label><button class="fmrc-support__conversation" type="button" data-support-conversation="${c.id}">${esc(c.message.slice(0,100))}${c.message.length > 100 ? '…' : ''}<span>#${c.id} · ${esc(c.status === 'resolved' ? t('closed') : t('open'))} · ${esc(date(c.last_entry_at || c.created_at))}${c.customer_unread ? ' · '+(language === 'fil' ? 'Bagong sagot' : 'New reply') : ''}</span></button>${c.status === 'resolved' ? `<button type="button" class="fmrc-support__history-delete" data-support-delete="${c.id}" aria-label="${esc(t('remove'))}">${icons.delete}</button>` : ''}</div>`).join('')}</div><div class="fmrc-support__toolbar"><button type="button" data-support-bulk ${selected.size ? '' : 'disabled'}>${esc(t('selected'))} (${selected.size})</button><span class="fmrc-support__note">${esc(t('page'))} ${page}/${pages}</span></div><div class="fmrc-support__toolbar"><button type="button" data-support-page="-1" ${page <= 1 ? 'disabled' : ''}>${esc(t('previous'))}</button><button type="button" data-support-page="1" ${page >= pages ? 'disabled' : ''}>${esc(t('next'))}</button></div>`}`;
  }
  function entryHtml(e) {
    if (e.event) return `<p class="fmrc-support__system" data-support-entry="${e.id}">${esc(e.event === 'ended' ? t('endedEvent') : t('reopenedEvent'))} <time>${esc(date(e.created_at))}</time></p>`;
    const own = e.sender_role === 'customer';
    return `<article class="fmrc-support__bubble${own ? ' fmrc-support__bubble--own' : ''}" data-support-entry="${e.id}"><div class="fmrc-support__sender">${own ? '' : `<img src="${esc(url('/images/FMRC%20Logo.png'))}" alt="" width="27" height="27">`}<strong>${esc(own ? user().name || e.sender_name : 'FMRC Team')}</strong></div><p class="fmrc-support__plain">${esc(e.body)}</p><time>${esc(date(e.created_at))}</time></article>`;
  }
  function renderConversation() {
    panel.dataset.supportView = 'team-conversation';
    body.innerHTML = `${statusHtml()}<div class="fmrc-support__toolbar"><button type="button" data-support-history>${icons.back} ${esc(t('back'))}</button><strong>#${conversation?.id || ''}</strong>${conversation?.status !== 'resolved' ? `<button type="button" data-support-end>${esc(t('end'))}</button>` : `<button type="button" data-support-new>${esc(t('new'))}</button>`}</div><button type="button" data-support-earlier ${hasEarlier ? '' : 'hidden'}>${esc(t('more'))}</button><div role="log" aria-live="polite" aria-relevant="additions" id="supportMessages">${entries.map(entryHtml).join('')}</div><button type="button" class="fmrc-support__new-messages" data-support-latest hidden>${esc(t('newMessages'))}</button><div id="supportEnded" ${conversation?.status === 'resolved' ? '' : 'hidden'}><p>${esc(t('ended'))}</p><p class="fmrc-support__note">${esc(t('endNote'))}</p><div class="fmrc-support__ended-actions"><button type="button" data-support-reopen>${esc(t('reopen'))}</button><button type="button" data-support-delete="${conversation?.id}">${esc(t('remove'))}</button></div></div>`;
    composer.hidden = loading || !conversation || conversation.status === 'resolved'; setupComposer();
    if (loading) body.insertAdjacentHTML('beforeend', `<p role="status" data-support-loading>${esc(t('loading'))}</p>`);
  }
  function renderTeam() {
    if (!loaded && knowledgePending) { panel.dataset.supportView = 'team-loading'; composer.hidden = true; body.innerHTML = stateCard(t('knowledgeLoading'),'','',''); return; }
    if (!token()) { panel.dataset.supportView = 'team-guest'; composer.hidden = true; body.innerHTML = stateCard(t('signin'),t('signNote'),'','')+`<div class="fmrc-support__links"><a href="${esc(actionUrl('signin'))}" data-support-signin>${esc(t('signin'))}</a></div>`; return; }
    if (!pack.installed) { panel.dataset.supportView = 'team-setup'; composer.hidden = true; body.innerHTML = stateCard(t('start'),t('setup'),'','')+`<div class="fmrc-support__links"><a href="${esc(actionUrl('contact'))}">${esc(t('contact'))}</a></div>`; return; }
    if (view === 'history') { renderHistory(); return; }
    if (view === 'new') {
      panel.dataset.supportView = 'team-new';
      const consented = body.querySelector('#supportConsent')?.checked || false;
      body.innerHTML = `${statusHtml()}<div class="fmrc-support__toolbar"><strong>${esc(t('new'))}</strong><button type="button" data-support-history>${icons.back} ${esc(t('back'))}</button></div><p class="fmrc-support__welcome">${esc(available ? pack.config.welcome[language] : pack.config.offline[language])}</p><p class="fmrc-support__note">${esc(t('privacy'))}</p><label class="fmrc-support__consent"><input id="supportConsent" type="checkbox" ${consented ? 'checked' : ''}><span>${esc(t('consent'))}</span></label>`;
      composer.hidden = false; setupComposer(); return;
    }
    renderConversation();
  }
  function setupComposer() {
    composer.querySelector('label').textContent = t(mode === 'help' ? 'question' : 'message');
    input.placeholder = t(mode === 'help' ? 'placeholder' : 'messagePlaceholder'); input.maxLength = mode === 'help' ? 500 : 3000;
    input.value = drafts.get(currentDraft()) || ''; input.disabled = busy || loading;
    composer.querySelector('button').disabled = busy || loading || !input.value.trim(); composer.querySelector('button').setAttribute('aria-label', t('send'));
    root.querySelector('#supportInputHint').textContent = mode === 'help' ? t('auto') : t('privacy');
  }
  function render() {
    panel.querySelectorAll('[data-support-tab]').forEach(tab => { const active = tab.dataset.supportTab === mode; tab.textContent = t(active && mode === 'help' ? 'help' : tab.dataset.supportTab === 'help' ? 'help' : 'team'); tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1; });
    body.setAttribute('aria-labelledby',mode === 'help' ? 'supportHelpTab' : 'supportTeamTab');
    root.querySelector('#fmrcSupportSubtitle').textContent = mode === 'help' ? t('auto') : (available ? t('available') : t('away'));
    if (mode === 'help') renderHelp(); else renderTeam();
  }
  async function updateAvailability() {
    if (Date.now() - availabilityAt < 18000) return;
    availabilityAt = Date.now();
    const previousInstalled = pack.installed, previousAvailable = available;
    try { const r = await request('/support/availability',{},false); available = !!r.available; if (typeof r.installed === 'boolean') pack.installed = r.installed; } catch { available = false; }
    if (!panel.hidden && mode === 'team' && !confirmation && !busy
      && (previousInstalled !== pack.installed || (previousAvailable !== available && view === 'history' && !list.length))) renderTeam();
    panel.querySelectorAll('.fmrc-support__status').forEach(s => { s.dataset.available = String(available); s.lastElementChild.textContent = available ? t('available') : t('away'); });
    root.querySelector('#fmrcSupportSubtitle').textContent = mode === 'help' ? t('auto') : (available ? t('available') : t('away'));
  }
  async function history() {
    if (!token() || !pack.installed) return;
    const ticket = generation, result = await request('/customer/messages?page=' + page);
    if (ticket !== generation) return;
    const changed = JSON.stringify(list) !== JSON.stringify(result.data || []);
    list = result.data || []; pages = result.meta?.last_page || 1;
    if (page > pages) { page = pages; return history(); }
    const counter = root.querySelector('.fmrc-support__count'); counter.textContent = String(result.unread_count || ''); counter.hidden = !result.unread_count;
    if (changed && mode === 'team' && view === 'history' && !confirmation) renderHistory();
  }
  async function readVisible() {
    if (panel.hidden || document.hidden || view !== 'conversation' || !conversation || body.scrollHeight - body.clientHeight - body.scrollTop > 70 || confirmation) return;
    const through = entries.at(-1)?.id || 0;
    if (through <= conversation.customer_last_read_entry_id) return;
    const id = conversation.id; await request('/customer/messages/'+id+'/read',{method:'PATCH',body:JSON.stringify({through})});
    if (conversation?.id === id) conversation.customer_last_read_entry_id = through;
  }
  async function refreshConversation(initial = false, before) {
    if (!conversation) return;
    const id = conversation.id, ticket = generation, bottom = body.scrollHeight - body.clientHeight - body.scrollTop < 80;
    const cursor = before ? '?before='+before : initial ? '' : '?after='+(entries.at(-1)?.id || 0);
    const result = await request('/customer/messages/'+id+'/entries'+cursor);
    if (ticket !== generation || conversation?.id !== id) return;
    const previousStatus = conversation.status; conversation = result.conversation;
    if (initial) { entries = result.data || []; hasEarlier = !!result.has_more; loading = false; renderConversation(); body.scrollTop = body.scrollHeight; }
    else if (before) { const height = body.scrollHeight; entries = [...result.data,...entries]; hasEarlier = !!result.has_more; renderConversation(); body.scrollTop = body.scrollHeight - height; }
    else {
      const added = (result.data || []).filter(e => !entries.some(old => old.id === e.id)); entries.push(...added);
      const logEl = body.querySelector('#supportMessages'); if (logEl) for (const e of added) logEl.insertAdjacentHTML('beforeend',entryHtml(e));
      if (previousStatus !== conversation.status) { const position = body.scrollTop; renderConversation(); body.scrollTop = position; }
      if (bottom && !confirmation) body.scrollTop = body.scrollHeight;
      else if (added.length) { body.querySelector('[data-support-latest]')?.removeAttribute('hidden'); }
      if (result.has_more) { setTimeout(() => { if (view === 'conversation' && conversation?.id === id && !panel.hidden) void refreshConversation().catch(() => {}); },100); }
    }
    await readVisible();
  }
  async function selectConversation(id) {
    if (busy) return; generation++; conversation = {id:Number(id),status:'new'}; entries = []; hasEarlier = false; view = 'conversation'; loading = true; mode = 'team'; textError(); render();
    try { await refreshConversation(true); } catch (e) { loading = false; if (!e.stale) { if (e.status === 404) { conversation = null; view = 'history'; render(); } textError(e.status === 404 ? t('unavailable') : e.message); } }
  }
  function appendHelp(question, faq) {
    if (question) { latestQuestion = question; log.push({question}); }
    if (faq) log.push({faq});
    else { const match = window.FMRCSupportAnswers?.find(question,pack.faqs) || {answer:null,suggestions:[]}; log.push(match.kind === 'greeting' ? {greeting:true} : match.answer ? {faq:match.answer} : {suggestions:match.suggestions}); }
    if (log.length > 40) log.splice(0,log.length-40);
    renderHelp();
    const answer = body.querySelector('#supportHelpLog > article:last-child');
    if (answer) body.scrollTop += answer.getBoundingClientRect().top-body.getBoundingClientRect().top-12;
  }
  function busyState(value) {
    busy = value; panel.setAttribute('aria-busy',String(value)); input.disabled = value;
    composer.querySelector('button').disabled = value || !input.value.trim();
    panel.querySelectorAll('[data-support-close],[data-support-tab]').forEach(b => b.disabled = value);
  }
  function closeConfirmation() {
    if (!confirmation) return;
    const {node,children,background,previous} = confirmation; node.remove(); children.forEach(([el,inert]) => el.inert = inert); background.forEach(([el,inert]) => el.inert = inert); confirmation = null;
    if (previous?.isConnected) previous.focus({preventScroll:true});
  }
  function confirmAction(title, note, label, action) {
    if (confirmation || busy) return;
    const node = document.createElement('div'); node.className = 'fmrc-support__confirm';
    node.innerHTML = `<section role="alertdialog" aria-modal="true" aria-labelledby="supportConfirmTitle" aria-describedby="supportConfirmNote"><h3 id="supportConfirmTitle">${esc(title)}</h3><p id="supportConfirmNote">${esc(note)}</p><div><button type="button" data-support-cancel>${esc(t('cancel'))}</button><button type="button" data-support-confirm>${esc(label)}</button></div></section>`;
    const children = [...panel.children].map(el => [el,el.inert]); children.forEach(([el]) => el.inert = true);
    const background = [...document.body.children].filter(el => el !== root && !el.matches('script,style,link')).map(el => [el,el.inert]); background.forEach(([el]) => el.inert = true);
    confirmation = {node,children,background,previous:document.activeElement}; panel.append(node); node.querySelector('button').focus();
    node.querySelector('[data-support-cancel]').onclick = () => { if (!busy) closeConfirmation(); };
    node.querySelector('[data-support-confirm]').onclick = async () => {
      if (busy) return; busyState(true); node.querySelectorAll('button').forEach(b => b.disabled = true);
      const ticket = generation;
      try { await action(); closeConfirmation(); } catch (e) { if (!e.stale) { textError(e.message); closeConfirmation(); } }
      finally { if (ticket === generation) busyState(false); }
    };
  }
  async function removeHistory(ids) {
    const result = await request('/customer/messages/history',{method:'DELETE',body:JSON.stringify({ids})});
    const removed = result.processed_ids || []; removed.forEach(id => { selected.delete(id); drafts.delete(String(id)); requests.delete(String(id)); });
    if (conversation && removed.includes(conversation.id)) { conversation = null; entries = []; view = 'history'; }
    if (result.skipped_ids?.length) textError(t('endFirst')); else textError();
    await history(); render(); window.dispatchEvent(new CustomEvent('fmrc:support-updated'));
  }
  async function poll() {
    clearTimeout(timer); sessionCheck();
    if (!panel.hidden && !document.hidden && navigator.onLine && !pollBusy && !busy) {
      pollBusy = true;
      try { await updateAvailability(); if (mode === 'team' && token() && pack.installed) { if (view === 'conversation') await refreshConversation(); else if (view === 'history') await history(); } failures = 0; }
      catch (e) {
        if (!e.stale) {
          failures++; textError(e.status === 404 ? t('unavailable') : e.message);
          if (e.status === 404 && conversation) {
            drafts.delete(String(conversation.id)); requests.delete(String(conversation.id));
            conversation = null; entries = []; input.value = ''; view = 'history'; render();
            try { await history(); } catch {}
          }
        }
      }
      finally { pollBusy = false; }
    }
    if (!panel.hidden && !document.hidden) timer = setTimeout(poll,Math.min(30000,3000*2**Math.min(failures,3)));
  }
  async function open(id) {
    if (busy || confirmation) return;
    sessionCheck(); opener = document.activeElement; panel.hidden = false; launcher.hidden = true; launcher.setAttribute('aria-expanded','true');
    render(); root.querySelector('[data-support-close]').focus({preventScroll:true});
    await knowledge(); if (panel.hidden) return; render();
    if (!id && savedView?.id && token()) id = savedView.id;
    savedView = null;
    if (id && token() && pack.installed) await selectConversation(id);
    else if (mode === 'team' && token() && pack.installed) { try { await history(); } catch (e) { textError(e.message); } }
    void poll();
  }
  function minimize() { if (busy || confirmation) return; panel.hidden = true; launcher.hidden = false; launcher.setAttribute('aria-expanded','false'); clearTimeout(timer); (opener?.isConnected ? opener : launcher).focus({preventScroll:true}); }
  input.addEventListener('input',() => { drafts.set(currentDraft(),input.value); composer.querySelector('button').disabled = !input.value.trim() || busy; });
  composer.addEventListener('submit',async event => {
    event.preventDefault(); sessionCheck(); const text = input.value.trim(); if (!text || busy || loading) return;
    textError();
    if (mode === 'help') { drafts.delete('help'); appendHelp(text); input.value = ''; input.focus(); return; }
    if (!token()) { render(); return; }
    if (view === 'new' && !body.querySelector('#supportConsent')?.checked) { textError(t('consentRequired')); body.querySelector('#supportConsent')?.focus(); return; }
    const key = currentDraft(), ticket = generation; if (!requests.has(key) || requests.get(key).body !== text) requests.set(key,{key:crypto.randomUUID(),body:text});
    busyState(true);
    try {
      if (!conversation) {
        const u = user(), result = await request('/customer/messages',{method:'POST',body:JSON.stringify({name:u.name || u.username || 'Customer',email:u.email,message:text,source:'widget',request_key:requests.get(key).key})});
        if (ticket !== generation) return;
        drafts.delete(key); requests.delete(key); await selectAfterSend(result.data.id);
      } else {
        await request('/customer/messages/'+conversation.id+'/entries',{method:'POST',body:JSON.stringify({body:text,request_key:requests.get(key).key})});
        if (ticket !== generation) return;
        drafts.delete(key); requests.delete(key); input.value = ''; await refreshConversation(); body.scrollTop = body.scrollHeight;
      }
      window.dispatchEvent(new CustomEvent('fmrc:support-updated'));
    } catch (e) { if (!e.stale) textError(e.message || t('failed')); }
    finally { if (ticket === generation) { busyState(false); setupComposer(); } }
  });
  async function selectAfterSend(id) { conversation = {id:Number(id),status:'new'}; entries = []; view = 'conversation'; loading = true; render(); await refreshConversation(true); }
  root.addEventListener('change',event => {
    if (event.target.id === 'supportLanguage') { language = event.target.value === 'fil' ? 'fil' : 'en'; localStorage.setItem('fmrc_support_language',language); render(); }
    if (event.target.matches('[data-support-select]')) { const id = Number(event.target.dataset.supportSelect); event.target.checked ? selected.add(id) : selected.delete(id); const check = event.target.dataset.supportSelect; renderHistory(); body.querySelector('[data-support-select="'+check+'"]')?.focus(); }
    if (event.target.matches('[data-support-select-all]')) { list.filter(c => c.status === 'resolved').forEach(c => event.target.checked ? selected.add(c.id) : selected.delete(c.id)); renderHistory(); body.querySelector('[data-support-select-all]')?.focus(); }
  });
  root.addEventListener('click',async event => {
    const button = event.target.closest('button,a'); if (!button || busy) return;
    try {
      if (button === launcher) { await open(); return; }
      if (button.hasAttribute('data-support-close')) { minimize(); return; }
      if (button.hasAttribute('data-support-tab')) { mode = button.dataset.supportTab; textError(); render(); void poll(); return; }
      if (button.dataset.supportTopic) { appendHelp(button.textContent.trim(),pack.faqs.find(f => f.key === button.dataset.supportTopic)); return; }
      if (button.hasAttribute('data-support-reset')) { log = []; latestQuestion = ''; renderHelp(); return; }
      if (button.hasAttribute('data-support-handoff')) { mode = 'team'; view = 'new'; conversation = null; if (latestQuestion) drafts.set('new',latestQuestion); render(); input.focus(); return; }
      if (button.hasAttribute('data-support-retry')) { await knowledge(); render(); return; }
      if (button.hasAttribute('data-support-new')) { conversation = null; entries = []; view = 'new'; textError(); render(); input.focus(); return; }
      if (button.hasAttribute('data-support-history')) { generation++; view = 'history'; conversation = null; textError(); render(); await history(); render(); return; }
      if (button.dataset.supportConversation) { await selectConversation(button.dataset.supportConversation); return; }
      if (button.dataset.supportPage) { page += Number(button.dataset.supportPage); await history(); render(); return; }
      if (button.hasAttribute('data-support-earlier') && entries.length) { await refreshConversation(false,entries[0].id); return; }
      if (button.hasAttribute('data-support-latest')) { body.scrollTop = body.scrollHeight; button.hidden = true; await readVisible(); return; }
      if (button.hasAttribute('data-support-end')) {
        confirmAction(t('endTitle'),t('endNote'),t('end'),async () => { const result = await request('/customer/messages/'+conversation.id+'/end',{method:'POST',body:JSON.stringify({through:entries.at(-1)?.id || 0})}); conversation = result.data; await refreshConversation(); renderConversation(); window.dispatchEvent(new CustomEvent('fmrc:support-updated')); }); return;
      }
      if (button.hasAttribute('data-support-reopen')) { busyState(true); try { const result = await request('/customer/messages/'+conversation.id+'/reopen',{method:'POST',body:'{}'}); conversation = result.data; await refreshConversation(); renderConversation(); input.focus(); } finally { busyState(false); } return; }
      if (button.hasAttribute('data-support-delete') || button.hasAttribute('data-support-bulk')) { const ids = button.dataset.supportDelete ? [Number(button.dataset.supportDelete)] : [...selected]; if (ids.length) confirmAction(t('deleteTitle'),t('deleteNote'),t('confirmDelete'),() => removeHistory(ids)); return; }
      if (button.hasAttribute('data-support-signin')) { sessionStorage.setItem('fmrc_support_resume',JSON.stringify({id:conversation?.id || null,at:Date.now()})); }
      else if (button.tagName === 'A') { minimize(); rememberView(); }
    } catch (e) { if (!e.stale) textError(e.message); }
  });
  root.addEventListener('keydown',event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (confirmation && !busy) closeConfirmation(); else minimize(); }
    if (confirmation && event.key === 'Tab') { const buttons = [...confirmation.node.querySelectorAll('button:not(:disabled)')]; if (!buttons.length) { event.preventDefault(); return; } if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); } }
    const tab = event.target.closest('[role=tab]'); if (tab && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); const other = panel.querySelector('[data-support-tab="'+(mode === 'help' ? 'team' : 'help')+'"]'); other.click(); other.focus(); }
    if (event.target === input && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
  });
  // Keep Escape inside this panel from dismissing a booking/password dialog
  // underneath it. Other Customer handlers remain untouched.
  window.addEventListener('keydown',event => {
    if (panel.hidden || !root.contains(event.target) || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (confirmation && !busy) closeConfirmation(); else minimize();
  },true);
  document.addEventListener('focusin',event => { if (confirmation && !confirmation.node.contains(event.target)) confirmation.node.querySelector('button:not(:disabled)')?.focus({preventScroll:true}); });
  document.addEventListener('wheel',event => { if (confirmation && !confirmation.node.contains(event.target)) event.preventDefault(); },{capture:true,passive:false});
  let readTimer; body.addEventListener('scroll',() => { clearTimeout(readTimer); readTimer = setTimeout(() => { void readVisible().catch(() => {}); },200); },{passive:true});
  window.addEventListener('storage',sessionCheck); window.addEventListener('fmrc:customer-session-changed',sessionCheck);
  window.addEventListener('pagehide',rememberView);
  document.addEventListener('visibilitychange',() => { clearTimeout(timer); if (!document.hidden) void poll(); }); window.addEventListener('online',() => { failures = 0; void poll(); });
  setInterval(sessionCheck,1500);
  function fitViewport() {
    const viewport = window.visualViewport, height = viewport?.height || innerHeight;
    const keyboard = Math.max(0,innerHeight-height-(viewport?.offsetTop || 0));
    root.style.setProperty('--help-viewport',height+'px');
    root.style.setProperty('--help-bottom',(keyboard > 80 ? keyboard+12 : 84)+'px');
  }
  window.visualViewport?.addEventListener('resize',fitViewport); window.addEventListener('resize',fitViewport); fitViewport();
  window.FMRCSupport = {open,close:minimize,openConversation:open,version:VERSION};
  const params = new URLSearchParams(location.search);
  let resume; try { resume = JSON.parse(sessionStorage.getItem('fmrc_support_resume') || 'null'); } catch {}
  if (params.get('support') === '1' || (token() && resume && Date.now()-resume.at < 30*60*1000)) { mode = 'team'; sessionStorage.removeItem('fmrc_support_resume'); void open(params.get('conversation') || resume?.id); }
  else void knowledge();
})();
