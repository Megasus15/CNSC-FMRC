/* Shared reader for the separate Transaction Terms and Refund Policy pages. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    const get = id => document.getElementById(id);
    const root = get('policyDocument');
    if (!root) return;
    const type = root.dataset.policyType === 'transaction-terms' ? 'transaction-terms' : 'refund-policy';
    const terms = type === 'transaction-terms';
    const title = terms ? 'Transaction Terms' : 'Refund Policy';
    const version = new URLSearchParams(location.search).get('version');
    // Preserve links issued before the documents had separate pages.
    if (!terms && location.hash === '#transaction-terms') {
      location.replace('/products-page/transaction-terms.html' + location.search + '#transaction-terms');
      return;
    }
    const api = (window.APP_API_BASE_URL || (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '8000'
      ? location.protocol + '//' + location.hostname + ':8000/api' : location.origin + '/api')).replace(/\/$/, '');
    let busy = false;
    const linkPages = policyVersion => {
      const query = policyVersion ? '?version=' + encodeURIComponent(policyVersion) : '';
      get('policyTermsPageLink').href = '/products-page/transaction-terms.html' + query;
      get('policyRefundPageLink').href = '/products-page/refund-policy.html' + query;
    };
    const notice = (heading, message, { retry = false, current = false, contact = true } = {}) => {
      get('policyNotice').hidden = false;
      get('policyNoticeTitle').textContent = heading;
      get('policyNoticeMessage').textContent = message;
      get('policyPageRetry').hidden = !retry;
      get('policyCurrentLink').hidden = !current;
      get('policyNoticeContact').hidden = !contact;
    };
    const render = text => {
      const target = get(terms ? 'policyTermsText' : 'policyRefundText');
      const contents = get('policyContentsLinks');
      target.replaceChildren();
      contents.replaceChildren();
      for (const [index, paragraph] of text.split(/\n\s*\n/).entries()) {
        const parts = paragraph.trim().split('\n');
        if (!parts[0]) continue;
        const section = document.createElement('section');
        section.className = 'policy-document-section';
        section.id = type + '-section-' + (index + 1);
        const heading = parts.length > 1 ? parts.shift() : 'Policy details';
        const h2 = document.createElement('h2');
        h2.textContent = heading;
        const body = document.createElement('p');
        body.textContent = parts.join('\n');
        section.append(h2, body);
        target.append(section);
        const link = document.createElement('a');
        link.href = '#' + section.id;
        link.textContent = heading;
        contents.append(link);
      }
    };
    const load = async () => {
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      get('policySections').hidden = true;
      get('policyMetadata').hidden = true;
      notice('Loading ' + title.toLowerCase() + '…', 'Please wait while we retrieve the published policy.', { contact: false });
      try {
        const response = await fetch(api + '/commerce/policy' + (version ? '/' + encodeURIComponent(version) : ''), {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000), cache: 'no-store',
        });
        if (response.status === 404 && version) {
          notice('This policy version is unavailable', 'You can review the current policy or contact FMRC for help with the version accepted for your order.', { current: true });
          return;
        }
        const json = await response.json();
        if (!response.ok || !json || !Object.hasOwn(json, 'data')) throw Error('Invalid policy response');
        if (!json.data) {
          notice('Policy awaiting publication', 'The approved ' + title.toLowerCase() + ' will appear here when available. Ordering is temporarily unavailable. Please contact FMRC for assistance.');
          return;
        }
        const policy = json.data;
        if (!['version', 'title', 'terms_text', 'refund_text'].every(key => typeof policy[key] === 'string' && policy[key].trim())) throw Error('Incomplete policy');
        render(terms ? policy.terms_text : policy.refund_text);
        linkPages(policy.version);
        const timestamp = String(policy.published_at || '').replace(' ', 'T');
        const date = new Date(timestamp + (/(Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? '' : 'Z'));
        get('policyPageStatus').textContent = Number.isNaN(date.getTime()) ? 'Published policy' : 'Published ' + date.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });
        get('policyPageVersion').textContent = policy.version;
        get('policyCollectionTitle').textContent = policy.title;
        get('policyMetadata').hidden = false;
        get('policySections').hidden = false;
        get('policyNotice').hidden = true;
        if (location.hash === '#' + type) get(type).scrollIntoView({ block: 'start' });
      } catch {
        notice('Policy temporarily unavailable', 'We could not load the policy. Please try again or contact FMRC for assistance.', { retry: true });
      } finally {
        busy = false;
        root.setAttribute('aria-busy', 'false');
      }
    };
    linkPages(version);
    get('policyPageRetry').addEventListener('click', load);
    await load();
  });
})();
