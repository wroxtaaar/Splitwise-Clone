// Derived data the screens need, built from the store and the pure logic.
import { ME, netBalances, pairBalance, simplifyDebts, myEffect } from './logic.js';
import * as store from './store.js';

export const NO_GROUP = 'none';

export function personName(id, { you = 'You' } = {}) {
  if (id === ME) return you;
  return store.getRecord('people', id)?.name || 'Someone';
}

export const friends = () => store.people().filter((p) => p.id !== ME).sort((a, b) => a.name.localeCompare(b.name));
export const allGroups = () => store.groups().sort((a, b) => a.name.localeCompare(b.name));

export function scope(groupId) {
  const match = (g) => (groupId === NO_GROUP ? !g : g === groupId);
  return {
    expenses: store.expenses().filter((e) => match(e.groupId)),
    settlements: store.settlements().filter((s) => match(s.groupId)),
  };
}

/** What each other person owes me (positive) or I owe them (negative), within a scope. */
export function myBalances(expensesIn, settlementsIn) {
  const out = {};
  const ids = new Set();
  expensesIn.forEach((e) => { ids.add(e.payer); Object.keys(e.splits || {}).forEach((i) => ids.add(i)); });
  settlementsIn.forEach((s) => { ids.add(s.from); ids.add(s.to); });
  ids.delete(ME);
  ids.forEach((id) => { out[id] = pairBalance(expensesIn, settlementsIn, ME, id); });
  return out;
}

export function overall() {
  const balances = myBalances(store.expenses(), store.settlements());
  let owed = 0;
  let owe = 0;
  for (const v of Object.values(balances)) { if (v > 0) owed += v; else owe += -v; }
  return { owed, owe, net: owed - owe, balances };
}

/** Who owes whom directly, for every pair (used for non-group expenses, where simplifying would invent debts). */
function pairwiseDebts(expensesIn, settlementsIn) {
  const ids = new Set();
  expensesIn.forEach((e) => { ids.add(e.payer); Object.keys(e.splits || {}).forEach((i) => ids.add(i)); });
  settlementsIn.forEach((s) => { ids.add(s.from); ids.add(s.to); });
  const list = [...ids].sort();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const v = pairBalance(expensesIn, settlementsIn, list[i], list[j]); // what list[j] owes list[i]
      if (v > 0) out.push({ from: list[j], to: list[i], amount: v });
      else if (v < 0) out.push({ from: list[i], to: list[j], amount: -v });
    }
  }
  return out;
}

/**
 * Balances inside a group are simplified (fewest payments). Non-group expenses stay pairwise.
 * `lines` are the debts that involve me, so the list row and the detail page always agree.
 */
export function groupSummary(groupId) {
  const { expenses, settlements } = scope(groupId);
  const debts = groupId === NO_GROUP ? pairwiseDebts(expenses, settlements) : simplifyDebts(netBalances(expenses, settlements));
  const lines = debts
    .filter((d) => d.from === ME || d.to === ME)
    .map((d) => (d.from === ME ? { id: d.to, amount: -d.amount } : { id: d.from, amount: d.amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const net = lines.reduce((s, l) => s + l.amount, 0);
  return { net, lines, debts, expenses, settlements };
}

/** Everything that happened between me and one friend, newest first. */
export function friendLedger(friendId) {
  const items = [];
  for (const e of store.expenses()) {
    const effect =
      e.payer === ME ? (e.splits || {})[friendId] || 0
      : e.payer === friendId ? -((e.splits || {})[ME] || 0)
      : 0;
    if (effect !== 0) items.push({ kind: 'expense', record: e, effect });
  }
  for (const s of store.settlements()) {
    if (s.from === friendId && s.to === ME) items.push({ kind: 'settlement', record: s, effect: -s.amount });
    else if (s.from === ME && s.to === friendId) items.push({ kind: 'settlement', record: s, effect: s.amount });
  }
  items.sort(byRecent);
  return { items, balance: items.reduce((s, i) => s + i.effect, 0) };
}

export const byRecent = (a, b) =>
  (b.record?.date || b.date || '').localeCompare(a.record?.date || a.date || '') ||
  (b.record?.createdAt || b.createdAt || 0) - (a.record?.createdAt || a.createdAt || 0);

export function activityFeed() {
  const items = [
    ...store.expenses().map((record) => ({ kind: 'expense', record })),
    ...store.settlements().map((record) => ({ kind: 'settlement', record })),
  ];
  return items.sort((a, b) => (b.record.updatedAt || 0) - (a.record.updatedAt || 0));
}

export const myEffectOn = (e) => myEffect(e, ME);

/**
 * A payment from `from` to `to` that isn't pinned to one group is spread over the groups where
 * `from` actually owes `to` (largest first), so every group balance goes down. Any excess is
 * recorded as a non-group payment.
 */
export function planSettlement(from, to, amount) {
  const scopes = [...allGroups().map((g) => g.id), NO_GROUP];
  const owed = scopes
    .map((id) => {
      const { expenses, settlements } = scope(id);
      return { id, owes: pairBalance(expenses, settlements, to, from) };
    })
    .filter((s) => s.owes > 0)
    .sort((a, b) => b.owes - a.owes);
  const plan = [];
  let left = amount;
  for (const s of owed) {
    if (left <= 0) break;
    const part = Math.min(left, s.owes);
    plan.push({ groupId: s.id === NO_GROUP ? null : s.id, amount: part });
    left -= part;
  }
  if (left > 0) {
    const loose = plan.find((p) => p.groupId === null);
    if (loose) loose.amount += left;
    else plan.push({ groupId: null, amount: left });
  }
  return plan;
}
