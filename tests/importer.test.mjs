import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseSplitwise, toRecords } from '../js/importer.js';

const CSV = [
  'Date,Description,Category,Cost,Currency,Asha,Ben',
  '',
  '2026-11-23,"20 ka adrak',
  '20 ke tamatar",General,285.00,INR,285.00,-285.00',
  '2026-11-22,"Dinner, ""special""",Dining out,1000.00,INR,-500.00,500.00',
  '2026-11-24,Settle all balances,Payment,500.00,INR,-500.00,500.00',
  '2026-11-25,Free sample,General,0.00,INR,0.00,0.00',
  'Total balance, , ,,INR,-215.00,215.00',
].join('\r\n');

const idOf = { Asha: 'u1', Ben: 'u2' };

test('parseCsv handles quotes, doubled quotes and newlines inside a cell', () => {
  const t = parseCsv('a,"b\nc","d ""q"""\r\n1,2,3\n');
  assert.deepEqual(t, [['a', 'b\nc', 'd "q"'], ['1', '2', '3']]);
});

test('parseSplitwise reads members and rows and skips the total line', () => {
  const p = parseSplitwise(CSV);
  assert.deepEqual(p.members, ['Asha', 'Ben']);
  assert.equal(p.rows.length, 4);
  assert.equal(p.skipped, 1);
  assert.equal(p.rows[0].description, '20 ka adrak\n20 ke tamatar');
  assert.equal(p.rows[0].cost, 28500);
});

test('an expense: payer is the positive column, the other owes the whole amount', () => {
  const { expenses } = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  const e = expenses.find((x) => x.amount === 28500);
  assert.equal(e.payer, 'u1');
  assert.deepEqual(e.splits, { u2: 28500 });
  assert.equal(e.description, '20 ka adrak, 20 ke tamatar');
  assert.equal(e.notes, '20 ka adrak\n20 ke tamatar');
  assert.equal(e.date, '2026-11-23');
  assert.equal(e.imported, true);
  assert.equal(e.groupId, 'g1');
});

test('an even split: the payer keeps their own share', () => {
  const { expenses } = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  const e = expenses.find((x) => x.amount === 100000);
  assert.equal(e.payer, 'u2');
  assert.deepEqual(e.splits, { u1: 50000, u2: 50000 });
  assert.equal(e.description, 'Dinner, "special"');
  const sum = Object.values(e.splits).reduce((a, b) => a + b, 0);
  assert.equal(sum, e.amount);
});

test('a Payment row becomes a settlement from payer to receiver', () => {
  const { settlements } = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  assert.equal(settlements.length, 1);
  assert.deepEqual([settlements[0].from, settlements[0].to, settlements[0].amount], ['u2', 'u1', 50000]);
});

test('zero-cost rows are reported, not imported', () => {
  const { expenses, problems } = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  assert.equal(expenses.length, 2);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Free sample/);
});

test('ids are stable, so importing twice updates instead of duplicating', () => {
  const a = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  const b = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  assert.deepEqual(a.expenses.map((x) => x.id), b.expenses.map((x) => x.id));
  assert.equal(new Set(a.expenses.map((x) => x.id)).size, a.expenses.length);
});

test('two identical rows on one day stay two expenses', () => {
  const csv = 'Date,Description,Category,Cost,Currency,Asha,Ben\n2026-11-23,chai,General,10.00,INR,10.00,-10.00\n2026-11-23,chai,General,10.00,INR,10.00,-10.00\n';
  const { expenses } = toRecords(parseSplitwise(csv), { groupId: 'g', idOf });
  assert.equal(expenses.length, 2);
  assert.notEqual(expenses[0].id, expenses[1].id);
});

test('a file that is not a Splitwise export is refused', () => {
  assert.throws(() => parseSplitwise('a,b\n1,2'), /Splitwise/);
});

test('imported expenses keep their Splitwise category', () => {
  const { expenses } = toRecords(parseSplitwise(CSV), { groupId: 'g1', idOf });
  const dinner = expenses.find((e) => e.description.startsWith('Dinner'));
  assert.equal(dinner.category, 'Dining out');
});
