import test from 'node:test';
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = { querySelector: () => null };
const { cat } = await import('../js/ui/util.js');

test('category from the import picks the icon, falling back to the description', () => {
  assert.equal(cat('whatever', 'Groceries').icon, 'cart');
  assert.equal(cat('whatever', 'Dining out').icon, 'food');
  assert.equal(cat('petrol pump', 'General').icon, 'fuel');
  assert.equal(cat('misc', 'General').icon, 'receipt');
});

test('a long group draws 50 rows first and the rest only on demand', async () => {
  const store = await import('../js/store.js');
  const { setMe } = await import('../js/logic.js');
  const views = await import('../js/ui/views.js');
  setMe('a');
  store.init('paging-test');
  store.putMany('people', [{ id: 'a', name: 'Me', isUser: true }, { id: 'b', name: 'Other', isUser: true }]);
  store.put('groups', { id: 'g', name: 'Home', members: ['a', 'b'] });
  store.putMany('expenses', Array.from({ length: 120 }, (_, i) => ({
    id: `e${i}`, description: `Item ${i}`, amount: 1000, payer: 'b', groupId: 'g',
    date: `2026-${String((i % 6) + 1).padStart(2, '0')}-10`, splits: { a: 1000 }, createdBy: 'b',
  })));
  const rows = (html) => (html.match(/data-view="expense"/g) || []).length;

  views.startPaging(0);
  const first = views.groupView('g').body;
  assert.equal(rows(first), 50);
  assert.match(first, /data-more/);
  assert.equal(views.pagedCount(), 50);

  const second = views.loadMore();
  assert.equal(rows(second), 50);
  assert.match(second, /data-more/);
  const third = views.loadMore();
  assert.equal(rows(third), 20);
  assert.doesNotMatch(third, /data-more/);
  assert.equal(views.loadMore(), '');

  // a re-render keeps what was already loaded
  views.startPaging(100);
  assert.equal(rows(views.groupView('g').body), 100);
});
