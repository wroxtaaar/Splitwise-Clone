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
