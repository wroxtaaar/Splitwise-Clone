// Bottom-sheet forms: add/edit expense, settle up, group, friend.
import { ME, toMinor, computeSplits, allocate } from '../logic.js';
import * as store from '../store.js';
import * as m from '../model.js';
import { toRecords } from '../importer.js';
import { esc, icon, money, today, toast, confirmDialog, avatarStyle, initial } from './util.js';

export const sheetOpen = () => document.querySelector('.overlay') !== null;
export const closeSheets = () => document.querySelectorAll('.overlay').forEach((o) => o.remove());

function present(title, body, onSave) {
  const layer = document.createElement('div');
  layer.className = 'overlay';
  layer.innerHTML = `<form class="sheet" novalidate><div class="sheet-head"><button type="button" class="iconbtn" data-close aria-label="Close">${icon('close')}</button><h2>${esc(title)}</h2><button class="save">Save</button></div><div class="sheet-body">${body}</div></form>`;
  const form = layer.querySelector('form');
  layer.addEventListener('click', (e) => { if (e.target === layer) layer.remove(); });
  layer.querySelector('[data-close]').addEventListener('click', () => layer.remove());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (onSave(form) !== false) layer.remove();
  });
  document.body.appendChild(layer);
  return { form, layer };
}

export function openSheet(kind, opts = {}) {
  ({ expense: expenseSheet, settle: settleSheet, group: groupSheet, friend: friendSheet, import: importSheet })[kind]?.(opts);
}

const everyone = () => [store.getRecord('people', ME), ...m.friends()];
const nameOf = (p) => (p.id === ME ? 'You' : p.name === 'You' ? 'Partner' : p.name);
const options = (list, selected) => list.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(nameOf(p))}</option>`).join('');
const num = (minor) => (minor / 100).toFixed(2);

// ---------------- expense ----------------
function expenseSheet({ id, groupId, friendId }) {
  const editing = id ? store.getRecord('expenses', id) : null;
  const people = everyone();
  if (people.length < 2) return toast('Add a friend first');
  const symbol = store.getState().settings.currency;
  const groupList = m.allGroups();
  const startGroup = editing ? editing.groupId : groupId && groupId !== m.NO_GROUP ? groupId : null;
  const group0 = startGroup && store.getRecord('groups', startGroup) ? startGroup : null;
  // Whoever did not pay owes the whole amount (with more than two people they share it equally).
  // In a group that is everyone else in the group. With no group it is the people ticked under "Split with"
  // (by default only the signed-in people, so adding another friend later never changes how an expense splits).
  const nm = (pid) => nameOf(people.find((p) => p.id === pid));
  const gMembers = (gid) => { const g = gid && store.getRecord('groups', gid); return g ? g.members : null; };
  const defaultOthers = people.filter((p) => p.id !== ME && p.isUser).map((p) => p.id);
  const withSet = new Set(
    editing && !editing.groupId ? [...Object.keys(editing.splits || {}), editing.payer]
      : friendId ? [ME, friendId]
      : defaultOthers.length ? [ME, ...defaultOthers]
      : people.map((p) => p.id),
  );
  const othersOf = (gid, payer) => {
    const mem = gMembers(gid);
    if (mem) return mem.filter((x) => x !== payer);
    const cand = people.filter((p) => p.id !== payer).map((p) => p.id);
    return cand.length > 1 ? cand.filter((x) => withSet.has(x)) : cand;
  };

  const { form } = present(editing ? 'Edit expense' : 'Add expense', `
    <div class="field"><label for="f_desc">Description</label><input class="input" id="f_desc" name="description" maxlength="80" value="${esc(editing?.description || '')}" placeholder="Dinner, groceries, taxi…" autocomplete="off"></div>
    <div class="field"><label for="f_amount">Amount</label><div class="amount-row"><span class="cur">${esc(symbol)}</span><input class="input" id="f_amount" name="amount" inputmode="decimal" value="${editing ? num(editing.amount) : ''}" placeholder="0.00" autocomplete="off"></div></div>
    <div class="two"><div class="field"><label for="f_date">Date</label><input class="input" id="f_date" name="date" type="date" value="${editing?.date || today()}"></div>
    <div class="field"><label for="f_payer">Paid by</label><select class="select" id="f_payer" name="payer">${options(people, editing?.payer || ME)}</select></div></div>
    <div class="hint" id="f_hint" style="margin:-4px 0 14px"></div>
    <div class="field"><label for="f_group">Group</label><select class="select" id="f_group" name="groupId"><option value="">No group</option>${groupList.map((g) => `<option value="${g.id}" ${g.id === group0 ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field" id="f_with" hidden><span class="label">Split with</span><div class="people" id="f_withList"></div></div>
    <div class="field"><label for="f_notes">Notes (optional)</label><textarea class="textarea" id="f_notes" name="notes" rows="2">${esc(editing?.notes || '')}</textarea></div>`,
  (f) => {
    const el = (n) => f.elements[n];
    const description = el('description').value.trim();
    if (!description) { toast('Add a description'); return false; }
    const amount = toMinor(el('amount').value);
    if (!(amount > 0)) { toast('Enter an amount'); return false; }
    const payer = el('payer').value;
    const gid = el('groupId').value || null;
    const others = othersOf(gid, payer);
    if (!others.length) { toast('Pick at least one other person'); return false; }
    const r = computeSplits({ type: 'equal', amount, participants: others, values: {} });
    if (r.error) { toast(r.error); return false; }
    store.put('expenses', { id: editing?.id, createdBy: editing?.createdBy || ME, description, amount, payer, groupId: gid, date: el('date').value || today(), notes: el('notes').value.trim(), splitType: 'equal', splitValues: {}, splits: r.splits });
    toast(editing ? 'Expense updated' : 'Expense added');
  });

  function refresh() {
    const payer = form.elements.payer.value;
    const others = othersOf(form.elements.groupId.value || null, payer);
    const v = toMinor(form.elements.amount.value);
    const amt = Number.isNaN(v) || !v ? '' : ` of ${money(v)}`;
    const names = others.map(nm);
    const verb = names.length === 1 && names[0] !== 'You' ? 'owes' : 'owe';
    form.querySelector('#f_hint').textContent = names.length ? `${names.join(', ')} ${verb} ${payer === ME ? 'you' : nm(payer)} the full amount${amt}.` : '';
  }

  // the "Split with" list only matters without a group, and only when there is more than one person to choose from
  function renderWith() {
    const payer = form.elements.payer.value;
    const cand = people.filter((p) => p.id !== payer);
    form.querySelector('#f_with').hidden = Boolean(form.elements.groupId.value) || cand.length < 2;
    form.querySelector('#f_withList').innerHTML = cand.map((p) => `<div class="person"><input type="checkbox" id="w_${p.id}" value="${p.id}" ${withSet.has(p.id) ? 'checked' : ''}><label class="name" for="w_${p.id}">${esc(nameOf(p))}</label></div>`).join('');
  }

  function applyGroup() {
    const g = store.getRecord('groups', form.elements.groupId.value);
    const allowed = g ? new Set(g.members) : null;
    [...form.elements.payer.options].forEach((o) => {
      const ok = !allowed || allowed.has(o.value);
      o.hidden = !ok;
      o.disabled = !ok;
    });
    if (allowed && !allowed.has(form.elements.payer.value)) form.elements.payer.value = ME;
    renderWith();
    refresh();
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'groupId') applyGroup();
    else if (e.target.name === 'payer') { renderWith(); refresh(); }
    else if (e.target.closest('#f_withList')) { if (e.target.checked) withSet.add(e.target.value); else withSet.delete(e.target.value); refresh(); }
    else refresh();
  });
  applyGroup();
  if (!editing) form.elements.description.focus();
}

// ---------------- settle up ----------------
function settleSheet({ groupId, friendId }) {
  const people = everyone();
  if (people.length < 2) return toast('Add a friend first');
  const groupList = m.allGroups();
  let from = ME;
  let to = people[1].id;
  let amount = 0;
  let scope = '';
  if (friendId) {
    const { balance } = m.friendLedger(friendId);
    if (balance > 0) { from = friendId; to = ME; amount = balance; } else { from = ME; to = friendId; amount = -balance; }
  } else if (groupId) {
    scope = groupId;
    const s = m.groupSummary(groupId);
    const d = s.debts.find((x) => x.from === ME || x.to === ME) || s.debts[0];
    if (d) { from = d.from; to = d.to; amount = d.amount; }
    else { const g = store.getRecord('groups', groupId); const other = g?.members.find((x) => x !== ME); if (other) to = other; }
  }
  const { form } = present('Settle up', `
    <div class="field"><label for="s_from">Who paid?</label><select class="select" id="s_from" name="from">${options(people, from)}</select></div>
    <div class="field"><label for="s_to">Who received it?</label><select class="select" id="s_to" name="to">${options(people, to)}</select></div>
    <div class="field"><label for="s_amount">Amount</label><div class="amount-row"><span class="cur">${esc(store.getState().settings.currency)}</span><input class="input" id="s_amount" name="amount" inputmode="decimal" value="${amount ? num(amount) : ''}" placeholder="0.00" autocomplete="off"></div></div>
    <div class="two"><div class="field"><label for="s_date">Date</label><input class="input" id="s_date" name="date" type="date" value="${today()}"></div>
    <div class="field"><label for="s_scope">Applies to</label><select class="select" id="s_scope" name="scope"><option value="" ${scope === '' ? 'selected' : ''}>All shared balances</option><option value="none" ${scope === 'none' ? 'selected' : ''}>Non-group expenses</option>${groupList.map((g) => `<option value="${g.id}" ${scope === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div></div>`,
  (f) => {
    const a = f.elements.from.value;
    const b = f.elements.to.value;
    if (a === b) { toast('Choose two different people'); return false; }
    const amt = toMinor(f.elements.amount.value);
    if (!(amt > 0)) { toast('Enter an amount'); return false; }
    const date = f.elements.date.value || today();
    const sel = f.elements.scope.value;
    const plan = sel === '' ? m.planSettlement(a, b, amt) : [{ groupId: sel === 'none' ? null : sel, amount: amt }];
    plan.forEach((p) => store.put('settlements', { from: a, to: b, amount: p.amount, date, groupId: p.groupId }));
    toast('Payment recorded');
  });
  if (!amount) form.elements.amount.focus();
}

// ---------------- group ----------------
function groupSheet({ id }) {
  const editing = id ? store.getRecord('groups', id) : null;
  // a new group starts with the other signed-in person already ticked
  const picked = new Set(editing ? editing.members : m.friends().filter((p) => p.isUser).map((p) => p.id));
  const row = (p) => `<div class="person"><input type="checkbox" id="m_${p.id}" value="${p.id}" ${picked.has(p.id) ? 'checked' : ''}><label class="name" for="m_${p.id}">${esc(p.name)}</label></div>`;
  const { form, layer } = present(editing ? 'Edit group' : 'New group', `
    <div class="field"><label for="g_name">Group name</label><input class="input" id="g_name" name="name" maxlength="50" value="${esc(editing?.name || '')}" placeholder="Trip, apartment, office lunch…" autocomplete="off"></div>
    <div class="field"><span class="label">Members</span><div class="people" id="memberList"><div class="person"><input type="checkbox" checked disabled><span class="name">You</span></div>${m.friends().map(row).join('')}</div></div>
    <div class="field"><label for="g_new">Add someone new</label><div class="amount-row"><input class="input" id="g_new" placeholder="Name" maxlength="40" autocomplete="off"><button type="button" class="btn" data-add>Add</button></div></div>
    ${editing ? '<button type="button" class="btn danger block" data-delete>Delete group</button>' : ''}`,
  (f) => {
    const name = f.elements.name.value.trim();
    if (!name) { toast('Give the group a name'); return false; }
    const members = [ME, ...[...f.querySelectorAll('#memberList input[value]:checked')].map((c) => c.value)];
    store.put('groups', { id: editing?.id, name, members });
    toast(editing ? 'Group updated' : 'Group created');
  });
  layer.querySelector('[data-add]').addEventListener('click', () => {
    const input = form.querySelector('#g_new');
    const name = input.value.trim();
    if (!name) return;
    const pid = store.put('people', { name });
    picked.add(pid);
    form.querySelector('#memberList').insertAdjacentHTML('beforeend', row(store.getRecord('people', pid)));
    input.value = '';
  });
  layer.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (await confirmDialog('Delete this group and all of its expenses and payments?')) {
      layer.remove();
      store.removeGroup(editing.id);
      toast('Group deleted');
    }
  });
  if (!editing) form.elements.name.focus();
}

// ---------------- friend ----------------
function friendSheet({ id }) {
  const editing = id ? store.getRecord('people', id) : null;
  const { form, layer } = present(editing ? 'Edit friend' : 'Add a friend', `
    <div class="field"><label for="p_name">Name</label><input class="input" id="p_name" name="name" maxlength="40" value="${esc(editing?.name || '')}" autocomplete="off"></div>
    ${editing ? `<div class="row" style="border:0"><div class="avatar" style="${avatarStyle(id)}">${esc(initial(editing.name))}</div><div class="main muted">Friends can be added to groups and expenses.</div></div><button type="button" class="btn danger block" data-delete>Remove friend</button>` : ''}`,
  (f) => {
    const name = f.elements.name.value.trim();
    if (!name) { toast('Enter a name'); return false; }
    if (m.friends().some((p) => p.id !== editing?.id && p.name.toLowerCase() === name.toLowerCase())) { toast('You already have a friend with that name'); return false; }
    store.put('people', { id: editing?.id, name });
    toast(editing ? 'Friend updated' : 'Friend added');
  });
  layer.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (store.personInUse(editing.id)) { toast('Delete their expenses and payments first'); return; }
    if (await confirmDialog(`Remove ${editing.name}?`, 'Remove')) {
      layer.remove();
      store.removePerson(editing.id);
      toast('Friend removed');
    }
  });
  if (!editing) form.elements.name.focus();
}

// ---------------- import a Splitwise CSV (one group per file) ----------------
const cleanGroupName = (file) => file.replace(/\.csv$/i, '').replace(/[_-]?(export|\d{4}-\d{2}-\d{2})/gi, '').replace(/[_-]+/g, ' ').trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

function importSheet({ queue }) {
  const item = queue[0];
  if (!item) return;
  const { parsed, fileName } = item;
  const people = everyone();
  const used = new Set();
  const guess = parsed.members.map((name) => {
    const w = name.toLowerCase().split(/\s+/)[0];
    const hit = people.find((p) => !used.has(p.id) && p.name && (p.name.toLowerCase().includes(w) || w.includes(p.name.toLowerCase())));
    if (hit) used.add(hit.id);
    return hit?.id || null;
  }).map((id) => id || people.find((p) => !used.has(p.id) && (used.add(p.id), true))?.id || 'new');
  const dates = parsed.rows.map((r) => r.date).sort();
  const groupName = cleanGroupName(fileName) || 'Imported group';
  const pick = (selected) => `${people.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(nameOf(p))}</option>`).join('')}<option value="new" ${selected === 'new' ? 'selected' : ''}>Add as a new person</option>`;
  const { form, layer } = present(`Import from Splitwise${queue.length > 1 ? ` (${queue.length} files left)` : ''}`, `
    <div class="hint" style="margin:0 0 12px">${esc(fileName)}: ${parsed.rows.length} rows${dates.length ? `, ${dates[0]} to ${dates.at(-1)}` : ''}.</div>
    <div class="field"><label for="i_name">Group name</label><input class="input" id="i_name" name="name" maxlength="50" value="${esc(groupName)}" autocomplete="off"></div>
    ${parsed.members.map((name, i) => `<div class="field"><label for="i_m${i}">${esc(name)} in Splitwise is…</label><select class="select" id="i_m${i}" name="m${i}">${pick(guess[i])}</select></div>`).join('')}
    <small class="note">Importing the same file again updates the same entries instead of adding them twice. Old expenses do not send notifications once <b>supabase/push.sql</b> has been re-run.</small>`,
  (f) => {
    const name = f.elements.name.value.trim();
    if (!name) { toast('Give the group a name'); return false; }
    const chosen = parsed.members.map((_, i) => f.elements[`m${i}`].value);
    const real = chosen.filter((v) => v !== 'new');
    if (new Set(real).size !== real.length) { toast('Each Splitwise person needs a different person here'); return false; }
    const idOf = {};
    parsed.members.forEach((mn, i) => { idOf[mn] = chosen[i] === 'new' ? store.put('people', { name: mn }) : chosen[i]; });
    const memberIds = Object.values(idOf);
    const existing = m.allGroups().find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
    const groupId = store.put('groups', { id: existing?.id, name, members: [...new Set([...(existing?.members || []), ME, ...memberIds])] });
    const { expenses, settlements, problems } = toRecords(parsed, { groupId, idOf });
    store.putMany('expenses', expenses);
    store.putMany('settlements', settlements);
    toast(`Imported ${expenses.length} expenses and ${settlements.length} payments${problems.length ? `, ${problems.length} skipped` : ''}`);
    if (problems.length) console.warn('Splitwise import skipped:\n' + problems.join('\n'));
    queue.shift();
    if (queue.length) setTimeout(() => importSheet({ queue }), 350);
  });
  layer.querySelector('.save').textContent = 'Import';
  void form;
}
