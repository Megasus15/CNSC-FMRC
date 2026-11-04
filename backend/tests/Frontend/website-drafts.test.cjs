const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../admin-page/website-loading.js'), 'utf8');

function harness() {
  const listeners = {};
  const window = {};
  vm.runInNewContext(source.slice(source.indexOf('  const drafts ='), source.indexOf('  const nativeFetch =')), {
    window, queueMicrotask, document: { addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); } },
  });
  return { api: window.AdminWebsiteDraft, emit: (name, event = {}) => (listeners[name] || []).forEach(fn => fn(event)) };
}

test('Save starts disabled, enables for edits and disables again when values are reverted', () => {
  const h = harness(); const button = {}; const values = { title: 'Saved title' };
  const draft = h.api.create({ button, read: () => values });
  assert.equal(button.disabled, true);
  draft.capture();
  assert.equal(button.disabled, true);
  values.title = 'Edited title'; h.emit('input');
  assert.equal(button.disabled, false);
  values.title = 'Saved title'; h.emit('change');
  assert.equal(button.disabled, true);
});

test('pending uploads and saves keep dirty forms locked until they are eligible', () => {
  const h = harness(); const button = {}; const values = { title: 'Saved' };
  let loaded = false, pending = false;
  const draft = h.api.create({ button, read: () => values, ready: () => loaded, busy: () => pending });
  draft.capture(); values.title = 'Draft'; h.emit('input');
  assert.equal(button.disabled, true);
  loaded = true; pending = true; draft.refresh();
  assert.equal(button.disabled, true);
  pending = false; draft.refresh();
  assert.equal(button.disabled, false);
  draft.capture();
  assert.equal(button.disabled, true);
});

test('independent editors keep separate baselines and a failed write leaves its draft enabled', async () => {
  const h = harness(); const first = {}, second = {}; let title = 'Saved', categories = ['Design'];
  const one = h.api.create({ button: first, read: () => title });
  const two = h.api.create({ button: second, read: () => categories });
  one.capture(); two.capture();
  title = 'Unsaved'; h.emit('input');
  assert.equal(first.disabled, false); assert.equal(second.disabled, true);
  h.api.refresh(); // failed saves do not replace the last confirmed snapshot
  assert.equal(first.disabled, false);
  categories.push('Manufacturing'); h.emit('click'); await Promise.resolve();
  assert.equal(second.disabled, false);
  categories.pop(); h.emit('click'); await Promise.resolve();
  assert.equal(second.disabled, true);
});

test('collection changes omit untouched artwork and support additions, edits, and removals together', () => {
  const { api } = harness();
  const saved = [{id:1,title:'First',image_data:'original-image'}, {id:2,title:'Remove'}];
  const current = [{...saved[0],title:'Edited'}, {id:-1,title:'New',image_data:'new-image'}];
  assert.deepEqual(JSON.parse(JSON.stringify(api.changes(saved,current,['title','image_data']))), {
    upsert:[{id:1,title:'Edited'},{title:'New',image_data:'new-image'}],delete:[2],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.changes(saved,saved,['title','image_data']))), {upsert:[],delete:[]});
});

test('page guards include pending media and custom drafts while modal baselines stay independent', () => {
  const {api}=harness();let value='Saved',pending=false;
  const modal=api.create({read:()=>value,page:false});modal.capture();value='Unapplied';
  assert.equal(api.isDirty(),false);
  const remove=api.register({isDirty:()=>modal.isDirty(),busy:()=>pending});
  assert.equal(api.isDirty(),true);modal.capture();assert.equal(api.isDirty(),false);
  pending=true;assert.equal(api.isDirty(),true);remove();assert.equal(api.isDirty(),false);
});
