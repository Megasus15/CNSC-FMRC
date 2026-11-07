const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../../home-page/main.js'), 'utf8');
const start = source.indexOf('  const fetchCustomerOrders = async');
const end = source.indexOf('  const fetchCustomerOrderDetail = async', start);

function api(status, data, etag = '"current"') {
  const calls = [];
  const context = vm.createContext({API_BASE_URL: '/api', CUSTOMER_ORDERS_REQUEST_TIMEOUT_MS: 7000,
    fetchJsonWithTimeout: async (...args) => {calls.push(args); return {response: {status, ok: status === 200, headers: {get: () => etag}}, data};},
    createCustomerApiError: (response, body, fallback) => Object.assign(new Error(body?.message || fallback), {status: response.status}),
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.loadOrders=fetchCustomerOrders;', context);
  return {load: context.loadOrders, calls};
}

test('Only a valid order list can represent an empty account', async () => {
  for (const data of [null, {}, '<html>Temporary page</html>', {message: 'Deployment response'}, {data: {orders: []}}]) {
    await assert.rejects(api(200, data).load('customer-token'), /Unable to load.*orders/i);
  }
  const result = await api(200, {data: [], returns: [], counts: {all: 0}}).load('customer-token');
  assert.equal(result.orders.length, 0);
  assert.equal(result.notModified, false);
});

test('A bodyless 304 is valid only for an explicit conditional request', async () => {
  await assert.rejects(api(304, {}).load('customer-token'), /Unable to load.*orders/i);
  const {load, calls} = api(304, {});
  const result = await load('customer-token', '"saved"');
  assert.equal(result.notModified, true);
  assert.equal(calls[0][1].headers['If-None-Match'], '"saved"');
});

test('A successful full response keeps orders and returns together', async () => {
  const result = await api(200, {data: [{id: 103}], returns: [{id: 12}], counts: {all: 1}}).load('customer-token');
  assert.equal(result.orders[0].id, 103);
  assert.equal(result.returns[0].id, 12);
  assert.equal(result.etag, '"current"');
});
