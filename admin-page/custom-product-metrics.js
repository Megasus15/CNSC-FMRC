(() => {
  'use strict';
  let selected = 'all';
  try { selected = sessionStorage.getItem('fmrc_sales_type') || 'all'; } catch {}
  if (!['all','regular','custom'].includes(selected)) selected='all';
  window.FMRCSalesType = {value:()=>selected};
  document.addEventListener('DOMContentLoaded',()=>{
    let schemaUnavailable = false;
    const changeType = value => {
      selected = value;
      try { sessionStorage.setItem('fmrc_sales_type', selected); } catch {}
      window.dispatchEvent(new Event('fmrc:sales-type'));
    };
    const syncFilter = () => {
      const select = document.getElementById('customSalesType');
      if (!select) return;
      select.querySelector('[value="custom"]').disabled = schemaUnavailable;
      select.value = selected;
    };
    const mountFilter = () => {
      if (document.getElementById('customSalesType')) return true;
      const host = document.querySelector('#productAnalyticsPeriodBar,.dashboard-analytics-period-bar,.report-filter-grid')
        || document.getElementById('dashboardAnalyticsToolbar')?.parentElement;
      if (!host) return false;
      const label = document.createElement('label');
      label.className = 'report-filter-field cp-sales-filter';
      label.innerHTML = '<span>Sales type</span><select class="filter-select" id="customSalesType"><option value="all">All</option><option value="regular">Regular</option><option value="custom">Custom</option></select>';
      host.append(label);
      syncFilter();
      label.querySelector('select').addEventListener('change', event => changeType(event.target.value));
      return true;
    };
    if(!mountFilter()){const observer=new MutationObserver(()=>{if(mountFilter())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});}
    const dashboard=location.pathname.includes('dashboard');
    const panel=document.createElement('section');panel.className='cp-workspace';panel.style.cssText='max-width:none;padding:0;margin:24px 0';panel.innerHTML='<div class="cp-card"><div class="cp-heading"><h2>Custom Products</h2><a class="cp-btn secondary" href="orders.html?custom_requests=1">View Custom Requests</a></div><p class="cp-help">Requests and quotations are operational counts. Confirmed custom payments are included once in Total Revenue.</p><div class="cp-stats" data-custom-counts aria-live="polite">Loading custom work…</div></div>';
    const target=document.querySelector('.dashboard-content');if(dashboard&&target)target.append(panel);
    const labels={requests_to_review:'Requests to review',needs_information:'Waiting for details',quotations_awaiting_payment:'Awaiting payment',awaiting_production:'Paid · awaiting production',in_production:'In production'};
    let timer,busy=false,lastRevision=null,delay=5000;
    const counts = panel.querySelector('[data-custom-counts]');
    const refresh = async () => {
      clearTimeout(timer);
      if (!document.hidden && !busy) {
        busy = true;
        try {
          const base = (window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content || location.origin + '/api').replace(/\/$/, '');
          const token = window.AdminSession?.getToken() || localStorage.getItem('auth_token');
          const response = await fetch(base + '/admin/custom-requests-summary', {
            headers: {Accept: 'application/json', Authorization: 'Bearer ' + token},
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json();
          if (!response.ok) {
            if (result.code === 'custom_requests_unavailable') {
              schemaUnavailable = true;
              if (selected === 'custom') changeType('all');
              syncFilter();
            }
            throw new Error();
          }
          schemaUnavailable = false;
          syncFilter();
          const data = result.data;
          if (lastRevision && lastRevision !== data.revision) window.dispatchEvent(new Event('fmrc:custom-metrics-updated'));
          lastRevision = data.revision;
          delay = 5000;
          counts.innerHTML = Object.entries(labels).map(([key, label]) => `<div class="cp-stat"><strong>${Number(data[key] || 0)}</strong>${label}</div>`).join('');
        } catch {
          delay = Math.min(delay * 2, 30000);
          counts.innerHTML = '<p>Custom work is temporarily unavailable.</p><button type="button" class="btn-admin btn-secondary">Try again</button>';
          counts.querySelector('button').addEventListener('click', refresh);
        } finally {
          busy = false;
        }
      }
      timer = setTimeout(refresh, delay);
    };
    void refresh();
  });
})();
