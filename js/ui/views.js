// Each view returns { bar, body, fab } as HTML strings. app.js puts them on screen.
import { ME } from '../logic.js';
import * as store from '../store.js';
import * as m from '../model.js';
import { getConfig, getStatus } from '../sync.js';
import { esc, icon, money, dayOf, monthShort, monthLong, prettyDate, artStyle, avatarStyle, initial, cat, catTile } from './util.js';

export const syncLabel = {
  off: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected · syncing automatically',
  error: 'Could not reach the database. Check the URL and rules.',
};

const who = (id) => m.personName(id);
const whoLower = (id) => m.personName(id, { you: 'you' });

const iconBtn = (name, attrs, label) => `<button class="iconbtn" aria-label="${label}" ${attrs}>${icon(name)}</button>`;
const backBtn = () => iconBtn('back', 'data-act="back"', 'Back');
const bar = (left, title, right = '') => `<div class="topbar">${left}${title ? `<h1>${esc(title)}</h1>` : '<span class="spacer"></span>'}${right}</div>`;
const rootBar = (title, right = '') => bar('', '', right).replace('<span class="spacer"></span>', `<h1 style="margin-left:12px">${esc(title)}</h1>`);
const searchBtn = () => iconBtn('search', 'data-act="open" data-view="search"', 'Search');
const addFriendBtn = () => iconBtn('userPlus', 'data-act="sheet" data-sheet="friend"', 'Add friend');
const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;

function overallLine() {
  const o = m.overall();
  if (o.net > 0) return `Overall, you are owed <b class="pos">${money(o.net)}</b>`;
  if (o.net < 0) return `Overall, you owe <b class="neg">${money(-o.net)}</b>`;
  return 'You are all settled up';
}

function balanceEnd(amount) {
  if (amount > 0) return `owes you<b class="pos">${money(amount)}</b>`;
  if (amount < 0) return `you owe<b class="neg">${money(-amount)}</b>`;
  return 'settled up';
}

function effectEnd(effect) {
  if (effect == null) return 'not involved';
  if (effect > 0) return `you lent<b class="pos">${money(effect)}</b>`;
  if (effect < 0) return `you borrowed<b class="neg">${money(-effect)}</b>`;
  return 'no balance';
}

function expenseRow(e, { effect, showGroup = true } = {}) {
  const g = e.groupId && store.getRecord('groups', e.groupId);
  const eff = effect === undefined ? m.myEffectOn(e) : effect;
  return `<button class="row" data-act="open" data-view="expense" data-id="${e.id}">
    <div class="datebox">${monthShort(e.date)}<b>${dayOf(e.date)}</b></div>${catTile(e.description)}
    <div class="main"><div class="title">${esc(e.description)}</div>
    <div class="sub">${who(e.payer)} paid ${money(e.amount)}${showGroup && g ? ' · ' + esc(g.name) : ''}</div></div>
    <div class="end">${effectEnd(eff)}</div></button>`;
}

function settlementRow(s, effect) {
  return `<button class="row" data-act="open" data-view="settlement" data-id="${s.id}">
    <div class="datebox muted">${icon('swap', 22)}</div>
    <div class="main"><div class="title">${who(s.from)} paid ${whoLower(s.to)}</div><div class="sub">${prettyDate(s.date)}</div></div>
    <div class="end"><b class="${effect > 0 ? 'pos' : effect < 0 ? 'neg' : ''}">${money(s.amount)}</b></div></button>`;
}

/** Expenses and payments, newest first, under month headings. */
function timeline(items, pairEffect = false, showGroup = true) {
  let current = '';
  return items
    .map((it) => {
      const month = monthLong(it.record.date);
      const head = month !== current ? `<div class="month">${month}</div>` : '';
      current = month;
      const effect = pairEffect ? it.effect : undefined;
      return head + (it.kind === 'expense' ? expenseRow(it.record, { effect, showGroup }) : settlementRow(it.record, it.effect));
    })
    .join('');
}

function debtLine(d) {
  if (d.from === ME) return `You owe ${esc(who(d.to))} <b class="neg">${money(d.amount)}</b>`;
  if (d.to === ME) return `${esc(who(d.from))} owes you <b class="pos">${money(d.amount)}</b>`;
  return `${esc(who(d.from))} owes ${esc(who(d.to))} <b>${money(d.amount)}</b>`;
}

// ---------- tabs ----------
export function groupsView(ui) {
  const rows = m.allGroups().map((g) => ({ g, s: m.groupSummary(g.id) }));
  const visible = rows.filter(({ s }) => !ui.hideSettled || s.lines.length);
  const loose = m.groupSummary(m.NO_GROUP);
  const hasLoose = loose.expenses.length || loose.settlements.length;

  const row = (id, name, s, art) => {
    const head = s.net > 0 ? `<div class="group-line strong pos">you are owed ${money(s.net)}</div>`
      : s.net < 0 ? `<div class="group-line strong neg">you owe ${money(-s.net)}</div>`
      : `<div class="group-line strong">${s.lines.length ? 'balanced out' : 'settled up'}</div>`;
    const lines = s.lines.slice(0, 2).map((l) =>
      `<div class="group-line">${l.amount > 0 ? `${esc(who(l.id))} owes you ${money(l.amount)}` : `you owe ${esc(who(l.id))} ${money(-l.amount)}`}</div>`).join('');
    const more = s.lines.length > 2 ? `<div class="group-line">plus ${s.lines.length - 2} other balance${s.lines.length > 3 ? 's' : ''}</div>` : '';
    return `<button class="group-row" data-act="open" data-view="group" data-id="${id}">${art}<div class="group-info"><div class="group-name">${esc(name)}</div>${head}${lines}${more}</div></button>`;
  };

  const list = visible.map(({ g, s }) => row(g.id, g.name, s, `<div class="art" style="${artStyle(g.id)}">${icon(/home|ghar|house|flat|rent|room/i.test(g.name) ? 'home' : 'list', 38)}</div>`)).join('')
    + (hasLoose ? row(m.NO_GROUP, 'Non-group expenses', loose, `<div class="art" style="background:linear-gradient(135deg,#1ec2a0 50%,#8a58d0 50%)">${icon('receipt', 36)}</div>`) : '');

  const body = `<div class="content">
    <div class="overall"><div class="grow">${overallLine()}</div>${iconBtn('filter', 'data-act="toggle-settled"', ui.hideSettled ? 'Show settled groups' : 'Hide settled groups')}</div>
    ${list || empty(rows.length ? 'All settled up' : 'No groups yet', rows.length ? 'Nothing outstanding in any group.' : 'Create a group to start splitting expenses.')}
    <button class="pill-btn" data-act="sheet" data-sheet="group">${icon('userPlus', 22)} Start a new group</button></div>`;
  return { bar: rootBar('', searchBtn() + addFriendBtn()), body, fab: true };
}

export function friendsView() {
  const o = m.overall();
  const list = m.friends().map((f) => `<button class="row" data-act="open" data-view="friend" data-id="${f.id}">
    <div class="avatar" style="${avatarStyle(f.id)}">${esc(initial(f.name))}</div>
    <div class="main"><div class="title">${esc(f.name)}</div></div>
    <div class="end">${balanceEnd(o.balances[f.id] || 0)}</div></button>`).join('');
  const body = `<div class="content"><div class="overall"><div class="grow">${overallLine()}</div></div>
    ${list || empty('No friends yet', 'Add a friend to start sharing expenses.')}
    <button class="pill-btn" data-act="sheet" data-sheet="friend">${icon('userPlus', 22)} Add a friend</button></div>`;
  return { bar: rootBar('', searchBtn() + addFriendBtn()), body, fab: true };
}

export function activityView() {
  const rows = m.activityFeed().map(({ kind, record: r }) => {
    if (kind === 'settlement') {
      return `<button class="row" data-act="open" data-view="settlement" data-id="${r.id}">
        <div class="art small" style="background:var(--surface);color:var(--muted)">${icon('swap', 22)}</div>
        <div class="main"><div class="title">${esc(who(r.from))} paid ${esc(whoLower(r.to))}</div><div class="sub">${prettyDate(r.date)}</div></div>
        <div class="end"><b>${money(r.amount)}</b></div></button>`;
    }
    const g = r.groupId && store.getRecord('groups', r.groupId);
    const eff = m.myEffectOn(r);
    const line = eff == null ? 'You are not involved' : eff > 0 ? `You get back ${money(eff)}` : `You owe ${money(-eff)}`;
    return `<button class="row" data-act="open" data-view="expense" data-id="${r.id}">
      <div class="art small" style="${artStyle(r.groupId || r.id)}">${icon('receipt', 22)}</div>
      <div class="main"><div class="title">You added “${esc(r.description)}”${g ? ' in ' + esc(g.name) : ''}</div>
      <div class="sub ${eff > 0 ? 'pos' : eff < 0 ? 'neg' : ''}">${line}</div></div>
      <div class="end">${prettyDate(r.date)}</div></button>`;
  }).join('');
  return { bar: rootBar('Recent activity', searchBtn()), body: `<div class="content">${rows || empty('No activity yet', 'Add an expense to get started.')}</div>`, fab: true };
}

export function accountView() {
  const st = store.getState();
  const me = store.getRecord('people', ME);
  const cfg = getConfig();
  const status = getStatus();
  const label = syncLabel[status];
  const theme = (v, text) => `<button class="${st.settings.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${text}</button>`;
  const body = `<div class="content">
    <div class="card"><h3>Who uses this phone?</h3>
      <div class="field"><select class="select" id="meSel" aria-label="Who uses this phone">${store.people().map((p) => `<option value="${p.id}" ${p.id === ME ? 'selected' : ''}>${esc(p.name === 'You' ? 'Owner' : p.name)}</option>`).join('')}</select></div>
      <small class="note">Each person picks themselves on their own phone. "You" and the other person's name flip automatically, and everything stays in sync.</small></div>
    <div class="card"><h3>Profile</h3>
      <form id="profileForm"><div class="field"><label for="meName">Your name</label><input class="input" id="meName" value="${esc(me?.name || '')}" maxlength="40"></div>
      <div class="field"><label for="currency">Currency symbol</label><input class="input" id="currency" value="${esc(st.settings.currency)}" maxlength="4"></div>
      <button class="btn solid">Save</button></form></div>
    <div class="card"><h3>Appearance</h3><div class="seg">${theme('system', 'System')}${theme('light', 'Light')}${theme('dark', 'Dark')}</div></div>
    <div class="card"><h3>Sync between your devices</h3>
      <div class="hint" style="margin:0 0 10px"><span class="status-dot ${status}" id="syncDot"></span><span id="syncStatus">${esc(label)}</span></div>
      <form id="syncForm">
        <div class="field"><label for="syncUrl">Firebase Realtime Database URL</label><input class="input" id="syncUrl" type="url" placeholder="https://your-project-default-rtdb.firebaseio.com" value="${esc(cfg.dbUrl)}" autocomplete="off"></div>
        <div class="field"><label for="syncCode">Shared code</label><input class="input code" id="syncCode" maxlength="16" value="${esc(cfg.code)}" autocomplete="off" autocapitalize="characters"></div>
        <div class="btn-row"><button type="button" class="btn solid" data-act="sync-create">Create new space</button><button type="button" class="btn" data-act="sync-join">Join with code</button>${cfg.code ? '<button type="button" class="btn danger" data-act="sync-off">Disconnect</button>' : ''}</div>
      </form>
      <small class="note">Anyone who has the database URL and code can read and change this data. Use a long random code and don’t share it.</small></div>
    <div class="card"><h3>Backup</h3><div class="btn-row"><button class="btn" data-act="export">Export JSON</button><button class="btn" data-act="import">Restore JSON</button></div>
      <input type="file" id="importFile" accept="application/json" hidden></div>
  </div>`;
  return { bar: rootBar('Account'), body, fab: false };
}

// ---------- details ----------
export function groupView(id) {
  const real = id !== m.NO_GROUP ? store.getRecord('groups', id) : null;
  if (id !== m.NO_GROUP && !real) return null;
  const s = m.groupSummary(id);
  const items = [
    ...s.expenses.map((record) => ({ kind: 'expense', record })),
    ...s.settlements.map((record) => ({ kind: 'settlement', record, effect: record.to === ME ? -record.amount : record.from === ME ? record.amount : 0 })),
  ].sort(m.byRecent);
  const people = real ? real.members.map((mid) => `<div class="row"><div class="avatar" style="${avatarStyle(mid)}">${esc(initial(who(mid)))}</div><div class="main"><div class="title">${esc(who(mid))}</div></div></div>`).join('') : '';
  const sum = s.debts.length ? s.debts.map((d) => `<div>${debtLine(d)}</div>`).join('') : `<div class="muted">${items.length ? 'You are all settled up' : 'No expenses yet'}</div>`;
  const n = real ? real.members.length : 0;
  const banner = `<div class="banner" style="${real ? artStyle(id) : 'background:linear-gradient(135deg,#1ec2a0 50%,#8a58d0 50%)'}"><div class="banner-top"><button class="circ" data-act="back" aria-label="Back">${icon('back', 22)}</button>${real ? `<button class="circ" data-act="sheet" data-sheet="group" data-id="${id}" aria-label="Group settings">${icon('gear', 20)}</button>` : ''}</div>
    <h1>${esc(real ? real.name : 'Non-group expenses')}</h1>${real ? `<div class="chip">${icon('users', 18)} ${n} ${n === 1 ? 'person' : 'people'}</div>` : ''}</div>`;
  const body = `${banner}<div class="sumline">${sum}</div>
    <div class="pills"><button data-act="sheet" data-sheet="settle" data-group="${id}">Settle up</button></div>
    <div class="content">${timeline(items, false, false)}${items.length ? '' : empty('Nothing here yet', 'Tap Add expense to add the first one.')}
    ${real ? `<div class="section-title">Members</div>${people}` : ''}</div>`;
  return { bar: '', body, fab: true };
}

export function friendView(id) {
  const f = store.getRecord('people', id);
  if (!f) return null;
  const { items, balance } = m.friendLedger(id);
  const headline = balance > 0 ? `${esc(f.name)} owes you <span class="pos">${money(balance)}</span>` : balance < 0 ? `You owe ${esc(f.name)} <span class="neg">${money(-balance)}</span>` : 'You are all settled up';
  const body = `<div class="content">
    <div class="row" style="border:0;padding-top:4px"><div class="avatar" style="${avatarStyle(id)};width:64px;height:64px;flex-basis:64px;font-size:26px">${esc(initial(f.name))}</div>
      <div class="main"><div style="font-size:20px;font-weight:600">${esc(f.name)}</div></div></div>
    <div class="summary"><div class="big">${headline}</div></div>
    <div class="pills" style="padding-left:0"><button data-act="sheet" data-sheet="settle" data-friend="${id}">Settle up</button></div>
    ${timeline(items, true)}${items.length ? '' : empty('No shared expenses', `You and ${f.name} haven’t shared anything yet.`)}</div>`;
  return { bar: bar(backBtn(), '', iconBtn('edit', `data-act="sheet" data-sheet="friend" data-id="${id}"`, 'Edit friend')), body, fab: true };
}

export function expenseView(id) {
  const e = store.getRecord('expenses', id);
  if (!e) return null;
  const c = cat(e.description);
  const own = (e.splits || {})[e.payer] || 0;
  const avatar = (pid) => (pid === ME ? '<div class="avatar mepie"></div>' : `<div class="avatar" style="${avatarStyle(pid)}">${esc(initial(who(pid)))}</div>`);
  const others = Object.entries(e.splits || {}).filter(([pid, owed]) => pid !== e.payer && owed > 0)
    .map(([pid, owed]) => `<div class="tl">${esc(who(pid))} owes ${money(owed)}</div>`).join('');
  const body = `<div class="xhead" style="background:${c.bg}"><div class="xbar"><button class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><span class="spacer"></span>
      <button class="iconbtn" data-act="delete-expense" data-id="${id}" aria-label="Delete">${icon('trash')}</button><button class="iconbtn" data-act="sheet" data-sheet="expense" data-id="${id}" aria-label="Edit">${icon('edit')}</button></div>
      <div class="xicon">${icon(c.icon, 54)}</div></div>
    <div class="xt"><div class="xtitle">${esc(e.description)}</div><div class="xamt">${money(e.amount)}</div>
      <div class="xmeta">Added by you on ${prettyDate(e.date)}${(e.groupId && store.getRecord('groups', e.groupId)) ? ' · ' + esc(store.getRecord('groups', e.groupId).name) : ''}</div></div>
    <div class="payer">${avatar(e.payer)}<div>${esc(who(e.payer))} paid ${money(e.amount)}</div></div>
    <div class="tree"><div class="tl">${esc(who(e.payer))} paid ${money(e.amount)}${own > 0 ? ` and ${e.payer === ME ? 'owe' : 'owes'} ${money(own)}` : ''}</div>${others}</div>
    ${e.notes ? `<div class="xnotes">${esc(e.notes).replace(/\n/g, '<br>')}</div>` : ''}`;
  return { bar: '', body, fab: false };
}

export function settlementView(id) {
  const s = store.getRecord('settlements', id);
  if (!s) return null;
  const g = s.groupId && store.getRecord('groups', s.groupId);
  const body = `<div class="content"><div class="summary"><div class="big">${esc(who(s.from))} paid ${esc(whoLower(s.to))}</div>
    <div style="font-size:24px;font-weight:600;margin-top:6px">${money(s.amount)}</div><div class="sub muted">${prettyDate(s.date)}${g ? ' · ' + esc(g.name) : ''}</div></div>
    <div class="btn-row"><button class="btn danger" data-act="delete-settlement" data-id="${id}">Delete payment</button></div></div>`;
  return { bar: bar(backBtn(), 'Payment'), body, fab: false };
}

export function searchView() {
  return { bar: bar(backBtn(), '', ''), body: `<div class="content"><input class="input" id="searchBox" placeholder="Search groups, friends, expenses" autocomplete="off"><div id="searchResults"></div></div>`, fab: false };
}

export function searchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return '';
  const g = m.allGroups().filter((x) => x.name.toLowerCase().includes(q)).map((x) => `<button class="row" data-act="open" data-view="group" data-id="${x.id}"><div class="art small" style="${artStyle(x.id)}">${icon('users', 22)}</div><div class="main"><div class="title">${esc(x.name)}</div></div></button>`);
  const f = m.friends().filter((x) => x.name.toLowerCase().includes(q)).map((x) => `<button class="row" data-act="open" data-view="friend" data-id="${x.id}"><div class="avatar" style="${avatarStyle(x.id)}">${esc(initial(x.name))}</div><div class="main"><div class="title">${esc(x.name)}</div></div></button>`);
  const e = store.expenses().filter((x) => x.description.toLowerCase().includes(q) || (x.notes || '').toLowerCase().includes(q)).sort(m.byRecent).slice(0, 30).map((x) => expenseRow(x));
  const section = (t, a) => (a.length ? `<div class="section-title">${t}</div>${a.join('')}` : '');
  return section('Groups', g) + section('Friends', f) + section('Expenses', e) || empty('No matches', 'Try a different word.');
}
