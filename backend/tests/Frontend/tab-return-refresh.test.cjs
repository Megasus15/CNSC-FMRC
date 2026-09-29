// Focused behavioral checks of production refresh functions with event/request stubs.
// These do not claim browser rendering or deployment verification.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '../../..');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function source(file) { return fs.readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n'); }
function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Missing production section: ${startMarker}`);
  return text.slice(start, end);
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(handler);
      listeners.set(type, callbacks);
    },
    emit(type, event = {}) { for (const handler of listeners.get(type) || []) handler(event); },
  };
}

async function checkCustomerEvents() {
  const text = source('home-page/main.js');
  const document = { ...events(), hidden: false, getElementById: () => null };
  const window = { ...events() };
  let siteRequests = 0;
  let orderRequests = 0;
  const customer = {
    document, window, setInterval: () => 1,
    SDG_CHANNEL: 'settings', SDG_STAMP_KEY: 'settings_stamp',
    ORDERS_REALTIME_SIGNAL_KEY: 'orders_stamp',
    overlay: { classList: { contains: () => true } },
    state: { lastDetailRefreshAt: 99 },
    shouldProcessRealtimeSignal: () => true,
    getOrdersRealtimeChannel: () => null,
    refreshSiteContentRealtime: () => { siteRequests++; },
    refreshOrders: () => { orderRequests++; },
    loadSdgs: () => {}, reloadSettings: () => {}, reloadServices: () => {},
  };
  const settings = section(text, '  function initSdgRealtime()', '\n\n\n  /*');
  const orderEnd = text.indexOf('      customerOrdersController = {');
  const orderStart = text.lastIndexOf('      window.addEventListener("fmrc:orders-updated"', orderEnd);
  assert(orderStart >= 0);
  vm.runInNewContext(settings + '\ninitSdgRealtime();\n' + text.slice(orderStart, orderEnd), customer);
  document.hidden = true;
  document.emit('visibilitychange');
  document.hidden = false;
  document.emit('visibilitychange');
  window.emit('focus');
  assert.equal(siteRequests, 0, 'Customer tab return must not re-read site content');
  assert.equal(orderRequests, 0, 'Customer tab return must not re-read My Orders');
  window.emit('storage', { key: 'settings_stamp' });
  window.emit('fmrc:orders-updated', { detail: { type: 'updated' } });
  assert.equal(siteRequests, 1, 'Settings-save signals must still refresh customer content');
  assert.equal(orderRequests, 1, 'Order mutation signals must still refresh My Orders');
  assert(!source('home-page/customer-announcements.js').includes('addEventListener("visibilitychange"'),
    'Campaigns must not reload on tab return');
  assert(!source('backend/public/frontend/home-page/main.js').includes('addEventListener("visibilitychange"'),
    'The legacy runtime My Orders handler must also be removed');
}

async function checkDashboardCadence() {
  const text = source('admin-page/dashboard.js');
  const document = { ...events(), hidden: false };
  const timerQueue = [];
  let requests = 0;
  let aborted = 0;
  const context = {
    document, DASHBOARD_LIVE_POLL_MS: 30000,
    dashboardLiveCountsTimer: null,
    dashboardLiveCountsController: { abort: () => { aborted++; } },
    syncDashboardLiveCounts: async () => { requests++; },
    window: {
      clearTimeout() {},
      setTimeout(handler, delay) { timerQueue.push({ handler, delay }); return timerQueue.length; },
    },
  };
  const schedule = section(text, '  const scheduleDashboardLiveCounts =', '\n  const refreshDashboardLiveCounts');
  const visibility = section(text, '  document.addEventListener("visibilitychange"', '\n  window.addEventListener("beforeunload"');
  vm.runInNewContext(schedule + visibility, context);
  document.hidden = true;
  document.emit('visibilitychange');
  document.hidden = false;
  document.emit('visibilitychange');
  assert.equal(aborted, 1, 'Hidden dashboard requests should still be cancelled');
  assert.equal(requests, 0, 'Returning must not fetch dashboard counts');
  assert.equal(timerQueue[0].delay, 30000, 'Returning resumes a full normal poll interval');
  await timerQueue[0].handler();
  assert.equal(requests, 1, 'Normal quiet polling remains active');
  assert.equal(timerQueue[1].delay, 30000, 'Polling keeps its normal cadence');
}

async function checkReportPagination() {
  const text = source('admin-page/reports.js');
  const filterCode = section(text, '    const reportFilterKey =', '\n    const copyReportFilters');
  const loadCode = section(text, '    const loadReport =', '\n    /**');
  const params = { category: 'orders', period: 'monthly', year: 2026, month: 9 };
  let loadingViews = 0;
  let rows = 50;
  const state = { isLoading: false, currentPage: 3, reportData: {}, activeParams: { ...params } };
  const context = {
    state, window: {}, elements: { lastUpdated: {} },
    setButtonPending() {}, syncActionButtons() {},
    renderLoadingState: () => { loadingViews++; },
    requestReport: async () => ({ report: { generated_at: '2026-09-29T12:00:00Z' }, table: { rows: Array(rows).fill({}) } }),
    copyReportFilters: value => ({ ...value }),
    hidePageMessage() {}, formatDateValue: value => value,
    renderReport: () => { state.currentPage = Math.min(state.currentPage, Math.max(1, Math.ceil(rows / 10))); },
  };
  vm.runInNewContext(filterCode + loadCode + '\nglobalThis.loadProductionReport = loadReport;', context);
  await context.loadProductionReport({ ...params }, 'poll');
  assert.equal(state.currentPage, 3, 'Quiet polls must preserve report pagination');
  assert.equal(loadingViews, 0, 'A successful quiet poll must keep loaded report content visible');
  await context.loadProductionReport({ ...params }, 'realtime');
  assert.equal(state.currentPage, 3, 'Realtime updates of the same report must preserve pagination');
  await context.loadProductionReport({ ...params }, 'refresh');
  assert.equal(state.currentPage, 1, 'Manual Refresh retains its intentional reset');
  state.currentPage = 3;
  await context.loadProductionReport({ ...params, month: 8 }, 'poll');
  assert.equal(state.currentPage, 1, 'Changing report filters resets pagination');
  state.currentPage = 3;
  rows = 5;
  await context.loadProductionReport({ ...params, month: 8 }, 'poll');
  assert.equal(state.currentPage, 1, 'Pagination must still clamp when records shrink');
  state.reportData = null;
  await context.loadProductionReport({ ...params }, 'initial');
  assert.equal(loadingViews, 1, 'Initial report loads retain their loading state');
  assert(!text.includes('refreshActiveReport("visible")'), 'Reports must not reload on tab return');
}

test('Customer return keeps content quiet while mutation signals stay active', checkCustomerEvents);
test('Dashboard return resumes its normal poll without fetching immediately', checkDashboardCadence);
test('Quiet report updates preserve pagination and initial/manual loads still work', checkReportPagination);
