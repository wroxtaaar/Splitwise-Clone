import test from 'node:test';
import assert from 'node:assert/strict';

// minimal localStorage for Node
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../js/store.js');

test('put marks records dirty and clearDirty respects later edits', () => {
  store.init('t1');
  const id = store.put('groups', { name: 'Home', members: ['a'] });
  assert.equal(store.dirtyRecords().length, 1);
  const batch = store.dirtyRecords();
  store.put('groups', { id, name: 'Home 2' }); // edited while the upload was in flight
  store.clearDirty(batch);
  assert.equal(store.dirtyRecords().length, 1, 'the newer edit must still be uploaded');
  store.clearDirty(store.dirtyRecords());
  assert.equal(store.dirtyRecords().length, 0);
});

test('mergeRemote keeps the newest record and drops the dirty flag when the server wins', () => {
  store.init('t2');
  const id = store.put('expenses', { description: 'a', amount: 100, payer: 'x', splits: {}, date: '2026-01-01' });
  const mine = store.getState().expenses[id];
  assert.equal(store.mergeRemote([{ coll: 'expenses', id, data: { ...mine, description: 'older', updatedAt: mine.updatedAt - 5 } }]), false);
  assert.equal(store.getRecord('expenses', id).description, 'a');
  assert.equal(store.mergeRemote([{ coll: 'expenses', id, data: { ...mine, description: 'newer', updatedAt: mine.updatedAt + 5 } }]), true);
  assert.equal(store.getRecord('expenses', id).description, 'newer');
  assert.equal(store.dirtyRecords().length, 0);
});

test('deleting leaves a tombstone that syncs and hides the record', () => {
  store.init('t3');
  const id = store.put('expenses', { description: 'x', amount: 1, payer: 'a', splits: {}, date: '2026-01-01' });
  store.clearDirty(store.dirtyRecords());
  store.removeRecord('expenses', id);
  assert.equal(store.getRecord('expenses', id), null);
  const [d] = store.dirtyRecords();
  assert.equal(d.rec.deleted, true);
  assert.equal(store.snapshot().expenses[id], undefined);
});

test('each user has separate local data, and state survives a reload', () => {
  store.init('u1');
  store.put('people', { id: 'u1', name: 'Wasiq', isUser: true });
  store.init('u2');
  assert.equal(store.people().length, 0);
  store.init('u1');
  assert.equal(store.people()[0].name, 'Wasiq');
});

test('the two signed-in people are never removed by a restore or by removePerson', () => {
  store.init('t5');
  store.put('people', { id: 'me1', name: 'Wasiq', isUser: true });
  store.put('people', { id: 'pa', name: 'Papa', isUser: true });
  const friend = store.put('people', { name: 'Friend' });
  store.removePerson('pa');
  assert.ok(store.getRecord('people', 'pa'));
  store.importBackup({ people: {}, groups: {}, expenses: {}, settlements: {} }, 'me1');
  assert.ok(store.getRecord('people', 'pa') && store.getRecord('people', 'me1'));
  assert.equal(store.getRecord('people', friend), null);
});
