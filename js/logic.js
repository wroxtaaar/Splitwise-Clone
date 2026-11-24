// Pure money logic. All amounts are integers in minor units (paise), so there are no float errors.

// Id of the person using THIS device. Defaults to the first person; each phone can pick itself in Account.
export let ME = 'me';
export const setMe = (id) => { ME = id; };

/** "12.5" -> 1250. Returns NaN for junk input. */
export function toMinor(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function formatMoney(minor, symbol = '₹') {
  const abs = Math.abs(minor || 0) / 100;
  return symbol + abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Split `total` (integer) proportionally to `weights` so the parts always add up to `total`.
 * Leftover units go to the largest fractional remainders (ties: earlier entries first).
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  const left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < left; k++) out[order[k % order.length].i]++;
  return out;
}

/**
 * Work out who owes what for one expense.
 * type: 'equal' | 'exact' (values in major units) | 'percent' | 'shares'
 * Returns { splits: {id: minor} } or { error, remaining } where remaining is in the unit of the type.
 */
export function computeSplits({ type, amount, participants, values = {} }) {
  if (!participants.length) return { error: 'Select at least one person' };
  if (!(amount > 0)) return { error: 'Enter an amount greater than zero' };
  let parts;
  if (type === 'equal') {
    parts = allocate(amount, participants.map(() => 1));
  } else if (type === 'exact') {
    parts = participants.map((id) => toMinor(values[id] || 0));
    if (parts.some((p) => Number.isNaN(p) || p < 0)) return { error: 'Amounts must be valid numbers' };
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum !== amount) return { error: 'Amounts must add up to the total', remaining: amount - sum };
  } else if (type === 'percent') {
    const pcts = participants.map((id) => Number(values[id]) || 0);
    if (pcts.some((p) => p < 0)) return { error: 'Percentages cannot be negative' };
    const sum = pcts.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.001) return { error: 'Percentages must add up to 100', remaining: 100 - sum };
    parts = allocate(amount, pcts);
  } else if (type === 'shares') {
    const weights = participants.map((id) => Number(values[id]) || 0);
    if (weights.some((w) => w < 0)) return { error: 'Shares cannot be negative' };
    if (!(weights.reduce((a, b) => a + b, 0) > 0)) return { error: 'Give at least one person a share' };
    parts = allocate(amount, weights);
  } else {
    return { error: 'Unknown split type' };
  }
  const splits = {};
  participants.forEach((id, i) => (splits[id] = parts[i]));
  return { splits };
}

/** Net position per person: positive = is owed money, negative = owes money. */
export function netBalances(expenses, settlements) {
  const net = {};
  const add = (id, v) => (net[id] = (net[id] || 0) + v);
  for (const e of expenses) {
    add(e.payer, e.amount);
    for (const [id, owed] of Object.entries(e.splits || {})) add(id, -owed);
  }
  for (const s of settlements) {
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return net;
}

/** How much `other` owes `person` (positive) or the reverse (negative), counting only the two of them. */
export function pairBalance(expenses, settlements, person, other) {
  let v = 0;
  for (const e of expenses) {
    if (e.payer === person) v += (e.splits || {})[other] || 0;
    else if (e.payer === other) v -= (e.splits || {})[person] || 0;
  }
  for (const s of settlements) {
    if (s.from === other && s.to === person) v -= s.amount;
    else if (s.from === person && s.to === other) v += s.amount;
  }
  return v;
}

/** Fewest-ish payments that settle everyone: repeatedly match the biggest debtor with the biggest creditor. */
export function simplifyDebts(net) {
  const creditors = [];
  const debtors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v > 0) creditors.push({ id, v });
    else if (v < 0) debtors.push({ id, v: -v });
  }
  const bySize = (a, b) => b.v - a.v || a.id.localeCompare(b.id);
  const out = [];
  while (creditors.length && debtors.length) {
    creditors.sort(bySize);
    debtors.sort(bySize);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.v, d.v);
    out.push({ from: d.id, to: c.id, amount });
    c.v -= amount;
    d.v -= amount;
    if (!c.v) creditors.shift();
    if (!d.v) debtors.shift();
  }
  return out;
}

/** What `me` gained (+) or lost (-) on one expense: lent = positive, borrowed = negative. null if not involved. */
export function myEffect(expense, me = ME) {
  const share = (expense.splits || {})[me] || 0;
  if (expense.payer === me) return expense.amount - share;
  return share ? -share : null;
}
