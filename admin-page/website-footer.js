'use strict';

const resolveApiBaseUrl = () => {
  const configured =
    window.APP_API_BASE_URL ||
    document.querySelector('meta[name="api-base-url"]')?.getAttribute('content') ||
    '';

  if (configured.trim()) {
    return configured.replace(/\/+$/, '');
  }

  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').toLowerCase();
  const origin = String(window.location.origin || '');
  const port = String(window.location.port || '');

  if (!/^https?:$/.test(protocol) || !hostname) {
    return 'http://127.0.0.1:8000/api';
  }

  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isPort8000 = port === '8000';
  const isStandardWebPort = port === '' || port === '80' || port === '443';

  if (isPort8000 || (!isLocalHost && isStandardWebPort)) {
    return `${origin.replace(/\/+$/, '')}/api`;
  }

  if (isLocalHost) {
    return `${protocol}//${hostname}:8000/api`;
  }

  return `${origin.replace(/\/+$/, '')}/api`;
};

const API = resolveApiBaseUrl();
const token = () => localStorage.getItem('auth_token');

let quickLinks = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  document.getElementById('btnSaveFooter').addEventListener('click', () => {
    window.showAdminConfirmPopup('Save all Footer changes? This updates the footer across all customer pages.', {
      title: 'Save Footer Changes',
      confirmText: 'Save',
      onConfirm: doSave,
    });
  });
  document.getElementById('btnAddLink').addEventListener('click', () => {
    addLinkRow({ label: '', url: '' });
  });
});

async function loadSettings() {
  try {
    const res = await fetch(`${API}/site-settings`);
    const json = await res.json();
    const s = json.data || {};
    setVal('footerBrandName',          s.footer_brand_name            || '');
    setVal('footerBrandDesc',          s.footer_brand_desc            || '');
    setVal('footerHoursDays',          s.footer_hours_days            || '');
    setVal('footerHoursTime',          s.footer_hours_time            || '');
    setVal('footerContactLocation',    s.footer_contact_location      || '');
    setVal('footerContactLocationUrl', s.footer_contact_location_url  || '');
    setVal('footerContactEmail',       s.footer_contact_email         || '');
    setVal('footerContactPhone',       s.footer_contact_phone         || '');
    setVal('footerContactFacebook',    s.footer_contact_facebook      || '');
    setVal('footerContactFacebookUrl', s.footer_contact_facebook_url  || '');
    setVal('footerCopyright',          s.footer_copyright             || '');

    try { quickLinks = JSON.parse(s.footer_quick_links || '[]'); } catch { quickLinks = []; }
    renderQuickLinks();
  } catch {
    window.showAdminPopup('Failed to load footer settings. Check backend connection.');
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function renderQuickLinks() {
  const container = document.getElementById('quickLinksContainer');
  container.innerHTML = '';
  if (!quickLinks.length) {
    addLinkRow({ label: 'Home', url: '/home-page/main.html' });
    return;
  }
  quickLinks.forEach((link, i) => addLinkRow(link, i));
}

function addLinkRow(link = { label: '', url: '' }, insertIdx = null) {
  const container = document.getElementById('quickLinksContainer');
  const row = document.createElement('div');
  row.className = 'ql-row';
  row.innerHTML = `
    <input type="text" class="ql-label wm-input" placeholder="Label (e.g. Home)" value="${escHtml(link.label)}" />
    <input type="text" class="ql-url wm-input" placeholder="URL (e.g. /home-page/main.html)" value="${escHtml(link.url)}" />
    <button class="ql-del" title="Remove link">×</button>
  `;
  row.querySelector('.ql-del').addEventListener('click', () => {
    window.showAdminConfirmPopup('Remove this quick link?', {
      title: 'Remove Link',
      confirmText: 'Remove',
      onConfirm: () => row.remove(),
    });
  });
  container.appendChild(row);
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function collectQuickLinks() {
  return Array.from(document.querySelectorAll('#quickLinksContainer .ql-row')).map(row => ({
    label: row.querySelector('.ql-label').value.trim(),
    url:   row.querySelector('.ql-url').value.trim(),
  })).filter(l => l.label || l.url);
}

async function doSave() {
  const links = collectQuickLinks();
  const payload = {
    footer_brand_name:           document.getElementById('footerBrandName').value,
    footer_brand_desc:           document.getElementById('footerBrandDesc').value,
    footer_quick_links:          JSON.stringify(links),
    footer_hours_days:           document.getElementById('footerHoursDays').value,
    footer_hours_time:           document.getElementById('footerHoursTime').value,
    footer_contact_location:     document.getElementById('footerContactLocation').value,
    footer_contact_location_url: document.getElementById('footerContactLocationUrl').value,
    footer_contact_email:        document.getElementById('footerContactEmail').value,
    footer_contact_phone:        document.getElementById('footerContactPhone').value,
    footer_contact_facebook:     document.getElementById('footerContactFacebook').value,
    footer_contact_facebook_url: document.getElementById('footerContactFacebookUrl').value,
    footer_copyright:            document.getElementById('footerCopyright').value,
  };
  try {
    const res = await fetch(`${API}/admin/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    window.showAdminPopup('Footer settings saved!', { title: 'Saved!' });
    await loadSettings();
  } catch {
    window.showAdminPopup('Failed to save. Try again.', { title: 'Error' });
  }
}
