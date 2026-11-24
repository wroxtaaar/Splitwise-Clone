import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, computeSplits, netBalances, pairBalance, simplifyDebts, myEffect, toMinor, formatMoney } from '../js/logic.js';

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('toMinor / formatMoney', () => {
  assert.equal(toMinor('12.5'), 1250);
  assert.equal(toMinor('0.1') + toMinor('0.2'), 30);
  assert.ok(Number.isNaN(toMinor('abc')));
  assert.equal(formatMoney(123456789), '₹12,34,567.89');
  assert.equal(formatMoney(-500), '₹5.00');
});

test('allocate always adds up to the total', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(10000, [50, 30, 20]), [5000, 3000, 2000]);
  for (let t = 0; t < 500; t++) {
    const w = [Math.random() * 5, Math.random() * 5, Math.random() * 5, 1];
    assert.equal(allocate(t * 7 + 1, w).reduce((a, b) => a + b, 0), t * 7 + 1);
  }
});

test('equal split puts the odd paise on the first people', () => {
  const r = computeSplits({ type: 'equal', amount: 1000, participants: ['a', 'b', 'c'] });
  assert.deepEqual(r.splits, { a: 334, b: 333, c: 333 });
});

test('exact split validates the sum', () => {
  const ok = computeSplits({ type: 'exact', amount: 1000, participants: ['a', 'b'], values: { a: '4', b: '6' } });
  assert.deepEqual(ok.splits, { a: 400, b: 600 });
  const bad = computeSplits({ type: 'exact', amount: 1000, participants: ['a', 'b'], values: { a: '4', b: '5' } });
  assert.equal(bad.remaining, 100);
  assert.ok(bad.error);
});

test('percent and shares splits', () => {
  const p = computeSplits({ type: 'percent', amount: 1000, participants: ['a', 'b', 'c'], values: { a: 50, b: 30, c: 20 } });
  assert.deepEqual(p.splits, { a: 500, b: 300, c: 200 });
  assert.ok(computeSplits({ type: 'percent', amount: 1000, participants: ['a', 'b'], values: { a: 50, b: 40 } }).error);
  const s = computeSplits({ type: 'shares', amount: 1000, participants: ['a', 'b'], values: { a: 2, b: 1 } });
  assert.equal(sum(s.splits), 1000);
  assert.equal(s.splits.a, 667);
  assert.ok(computeSplits({ type: 'shares', amount: 1000, participants: ['a'], values: { a: 0 } }).error);
});

test('rejects empty input', () => {
  assert.ok(computeSplits({ type: 'equal', amount: 0, participants: ['a'] }).error);
  assert.ok(computeSplits({ type: 'equal', amount: 100, participants: [] }).error);
});

const dinner = { payer: 'me', amount: 3000, splits: { me: 1000, a: 1000, b: 1000 } };
const taxi = { payer: 'a', amount: 600, splits: { me: 300, a: 300 } };

test('net and pair balances', () => {
  const net = netBalances([dinner, taxi], []);
  assert.deepEqual(net, { me: 3000 - 1000 - 300, a: -1000 + 600 - 300, b: -1000 });
  assert.equal(sum(net), 0);
  assert.equal(pairBalance([dinner, taxi], [], 'me', 'a'), 1000 - 300);
  assert.equal(pairBalance([dinner, taxi], [], 'a', 'me'), -(1000 - 300));
});

test('settlements reduce the debt in both views (regression for old sign bug)', () => {
  const owesMe = pairBalance([dinner], [], 'me', 'a');
  assert.equal(owesMe, 1000);
  const settled = [{ from: 'a', to: 'me', amount: 1000 }];
  assert.equal(pairBalance([dinner], settled, 'me', 'a'), 0);
  assert.equal(netBalances([dinner], settled).a, 0);
  // the other direction: I owe a, then I pay a
  const iOwe = { payer: 'a', amount: 100, splits: { me: 100 } };
  assert.equal(pairBalance([iOwe], [], 'me', 'a'), -100);
  assert.equal(pairBalance([iOwe], [{ from: 'me', to: 'a', amount: 100 }], 'me', 'a'), 0);
  // overpaying flips the direction
  assert.equal(pairBalance([iOwe], [{ from: 'me', to: 'a', amount: 150 }], 'me', 'a'), 50);
});

test('simplifyDebts settles everyone with few payments', () => {
  const net = { a: 500, b: -200, c: -300, d: 0 };
  const debts = simplifyDebts(net);
  assert.equal(debts.length, 2);
  const after = { ...net };
  for (const d of debts) { after[d.from] += d.amount; after[d.to] -= d.amount; }
  assert.ok(Object.values(after).every((v) => v === 0));
  // chain a->b->c collapses to a->c
  assert.deepEqual(simplifyDebts({ a: -100, b: 0, c: 100 }), [{ from: 'a', to: 'c', amount: 100 }]);
});

test('myEffect', () => {
  assert.equal(myEffect(dinner), 2000);
  assert.equal(myEffect(taxi), -300);
  assert.equal(myEffect({ payer: 'a', amount: 10, splits: { b: 10 } }), null);
});
