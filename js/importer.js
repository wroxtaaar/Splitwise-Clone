// Splitwise CSV export -> records for this app. Pure functions, unit tested (no DOM, no store).
//
// A Splitwise group export looks like:
//   Date,Description,Category,Cost,Currency,Alice,Bob
//   2026-11-23,"20 ka adrak
//   20 ke tamatar",General,285.00,INR,285.00,-285.00
//   2026-11-24,Settle all balances,Payment,500.00,INR,-500.00,500.00
//   Total balance, , ,,INR,-215.00,215.00
// Each person column is that person's NET for the row: positive = paid more than their share.

/** Minimal CSV reader: quotes, doubled quotes, newlines inside quotes, CRLF, BOM. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else if (c === '\r' && src[i + 1] === '\n') { /* keep \n only */ }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const minor = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function parseSplitwise(text) {
  const table = parseCsv(text);
  const h = table.findIndex((r) => r.length >= 6 && r[0].trim().toLowerCase() === 'date' && r[3].trim().toLowerCase() === 'cost');
  if (h < 0) throw new Error('This does not look like a Splitwise export');
  const members = table[h].slice(5).map((x) => x.trim()).filter(Boolean);
  if (members.length < 2) throw new Error('Could not find the people columns');
  const rows = [];
  let skipped = 0;
  for (const r of table.slice(h + 1)) {
    const date = (r[0] || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; } // "Total balance" and blank rows
    const nets = {};
    members.forEach((name, i) => { nets[name] = minor(r[5 + i]); });
    rows.push({ date, description: r[1] || '', category: (r[2] || '').trim(), cost: minor(r[3]), currency: (r[4] || '').trim(), nets });
  }
  return { members, rows, skipped };
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const noonOf = (date) => new Date(`${date}T12:00:00`).getTime();

/**
 * parsed: from parseSplitwise. idOf: { memberName: personId }.
 * Ids are derived from the row, so importing the same file twice updates instead of duplicating.
 * Records carry imported:true so the push-notification trigger stays quiet for history.
 */
export function toRecords(parsed, { groupId, idOf }) {
  const expenses = [];
  const settlements = [];
  const problems = [];
  const seen = new Map();
  const idFor = (row) => {
    const base = fnv([groupId, row.date, row.description, row.cost, JSON.stringify(row.nets)].join('|'));
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `sw-${base}${n > 1 ? `-${n}` : ''}`;
  };
  for (const row of parsed.rows) {
    const names = parsed.members;
    const net = names.map((n) => row.nets[n] || 0);
    const label = `${row.date} ${String(row.description).split(/\r?\n/)[0]}`.trim();
    if (row.category.toLowerCase() === 'payment') {
      const from = net.indexOf(Math.max(...net));
      const to = net.indexOf(Math.min(...net));
      if (from === to || net[from] <= 0) { problems.push(`${label}: payment without a clear payer`); continue; }
      settlements.push({ id: idFor(row), from: idOf[names[from]], to: idOf[names[to]], amount: row.cost || net[from], date: row.date, groupId, imported: true, createdAt: noonOf(row.date) });
      continue;
    }
    const payer = net.indexOf(Math.max(...net));
    if (!(net[payer] > 0) || !(row.cost > 0)) { problems.push(`${label}: nobody paid`); continue; }
    const shares = net.map((v, i) => (i === payer ? row.cost : 0) - v);
    if (shares.some((s) => s < 0)) { problems.push(`${label}: paid by more than one person (not supported)`); continue; }
    const diff = row.cost - shares.reduce((a, b) => a + b, 0);
    if (Math.abs(diff) > names.length) { problems.push(`${label}: shares do not add up`); continue; }
    shares[payer] += diff; // a paisa of rounding
    const lines = String(row.description).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let title = lines.join(', ') || 'Expense';
    if (title.length > 200) title = `${title.slice(0, 199).trimEnd()}…`;
    const splits = {};
    const splitValues = {};
    names.forEach((n, i) => { if (shares[i] > 0) { splits[idOf[n]] = shares[i]; splitValues[idOf[n]] = (shares[i] / 100).toFixed(2); } });
    expenses.push({
      id: idFor(row), createdBy: idOf[names[payer]], description: title,
      notes: lines.length > 1 || title !== lines[0] ? lines.join('\n') : '',
      amount: row.cost, payer: idOf[names[payer]], groupId, date: row.date,
      splitType: 'exact', splitValues, splits, imported: true, createdAt: noonOf(row.date),
    });
  }
  return { expenses, settlements, problems };
}
