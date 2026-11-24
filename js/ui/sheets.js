// Bottom-sheet forms: add/edit expense, settle up, group, friend.
import { ME, toMinor, computeSplits, allocate } from '../logic.js';
import * as store from '../store.js';
import * as m from '../model.js';
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
  ({ expense: expenseSheet, settle: settleSheet, group: groupSheet, friend: friendSheet })[kind]?.(opts);
}

const everyone = () => [store.getRecord('people', ME), ...m.friends()];
const nameOf = (p) => (p.id === ME ? 'You' : p.name);
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
  let type = editing?.splitType || 'equal';
  const values0 = editing?.splitValues || {};
  const picked = new Set(
    editing ? Object.keys(editing.splits || {})
      : group0 ? store.getRecord('groups', group0).members
      : friendId ? [ME, friendId]
      : people.map((p) => p.id),
  );

  const rows = people.map((p) => `<div class="person" data-pid="${p.id}">
      <input type="checkbox" id="cb_${p.id}" ${picked.has(p.id) ? 'checked' : ''}>
      <label class="name" for="cb_${p.id}">${esc(nameOf(p))}</label>
      <input class="val" inputmode="decimal" data-val="${p.id}" value="${esc(values0[p.id] ?? '')}" aria-label="${esc(nameOf(p))} amount" hidden>
      <span class="unit" hidden></span></div>`).join('');
  const types = [['equal', 'Equally'], ['exact', 'Exact'], ['percent', 'Percent'], ['shares', 'Shares']];

  const { form } = present(editing ? 'Edit expense' : 'Add expense', `
    <div class="field"><label for="f_desc">Description</label><input class="input" id="f_desc" name="description" maxlength="80" value="${esc(editing?.description || '')}" placeholder="Dinner, groceries, taxi…" autocomplete="off"></div>
    <div class="field"><label for="f_amount">Amount</label><div class="amount-row"><span class="cur">${esc(symbol)}</span><input class="input" id="f_amount" name="amount" inputmode="decimal" value="${editing ? num(editing.amount) : ''}" placeholder="0.00" autocomplete="off"></div></div>
    <div class="two"><div class="field"><label for="f_date">Date</label><input class="input" id="f_date" name="date" type="date" value="${editing?.date || today()}"></div>
    <div class="field"><label for="f_payer">Paid by</label><select class="select" id="f_payer" name="payer">${options(people, editing?.payer || ME)}</select></div></div>
    <div class="field"><label for="f_group">Group</label><select class="select" id="f_group" name="groupId"><option value="">No group</option>${groupList.map((g) => `<option value="${g.id}" ${g.id === group0 ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field"><span class="label">Split</span>
      <div class="seg" role="group">${types.map(([v, t]) => `<button type="button" data-type="${v}" class="${v === type ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="people">${rows}</div><div class="hint" id="f_hint"></div></div>
    <div class="field"><label for="f_notes">Notes (optional)</label><textarea class="textarea" id="f_notes" name="notes" rows="2">${esc(editing?.notes || '')}</textarea></div>`,
  (f) => {
    const el = (n) => f.elements[n];
    const description = el('description').value.trim();
    if (!description) { toast('Add a description'); return false; }
    const amount = toMinor(el('amount').value);
    if (!(amount > 0)) { toast('Enter an amount'); return false; }
    const ids = checkedIds();
    const payer = el('payer').value;
    if (new Set([...ids, payer]).size < 2) { toast('Pick at least one other person'); return false; }
    const values = {};
    if (type !== 'equal') ids.forEach((pid) => { values[pid] = valueOf(pid); });
    const r = computeSplits({ type, amount, participants: ids, values });
    if (r.error) {
      const extra = r.remaining == null ? '' : type === 'exact' ? ` (${money(Math.abs(r.remaining))} ${r.remaining > 0 ? 'left' : 'over'})` : ` (${Math.round(Math.abs(r.remaining) * 100) / 100}% ${r.remaining > 0 ? 'left' : 'over'})`;
      toast(r.error + extra);
      return false;
    }
    store.put('expenses', { id: editing?.id, description, amount, payer, groupId: el('groupId').value || null, date: el('date').value || today(), notes: el('notes').value.trim(), splitType: type, splitValues: type === 'equal' ? {} : values, splits: r.splits });
    toast(editing ? 'Expense updated' : 'Expense added');
  });

  const rowEls = () => [...form.querySelectorAll('.person')];
  const visibleRows = () => rowEls().filter((r) => !r.hidden);
  const checkedIds = () => visibleRows().filter((r) => r.querySelector('input[type=checkbox]').checked).map((r) => r.dataset.pid);
  const valueOf = (pid) => form.querySelector(`[data-val="${pid}"]`).value;
  const amountMinor = () => { const v = toMinor(form.elements.amount.value); return Number.isNaN(v) ? 0 : v; };

  function refresh() {
    const ids = checkedIds();
    const amount = amountMinor();
    visibleRows().forEach((r) => {
      const on = r.querySelector('input[type=checkbox]').checked && type !== 'equal';
      r.querySelector('.val').hidden = !on;
      const unit = r.querySelector('.unit');
      unit.hidden = !on;
      unit.textContent = type === 'exact' ? symbol : type === 'percent' ? '%' : 'sh';
    });
    let text = '';
    let bad = false;
    if (type === 'equal') {
      text = ids.length && amount ? `${money(allocate(amount, ids.map(() => 1))[0])} each · ${ids.length} ${ids.length === 1 ? 'person' : 'people'}` : 'The total is split equally.';
    } else if (type === 'exact') {
      const sum = ids.reduce((s, pid) => s + (toMinor(valueOf(pid) || 0) || 0), 0);
      const left = amount - sum;
      text = `${money(sum)} of ${money(amount)} · ${left === 0 ? 'all assigned' : `${money(Math.abs(left))} ${left > 0 ? 'left' : 'over'}`}`;
      bad = left !== 0;
    } else if (type === 'percent') {
      const sum = ids.reduce((s, pid) => s + (Number(valueOf(pid)) || 0), 0);
      text = `${Math.round(sum * 100) / 100}% of 100%`;
      bad = Math.abs(sum - 100) > 0.001;
    } else {
      const total = ids.reduce((s, pid) => s + (Number(valueOf(pid)) || 0), 0);
      text = `${total} share${total === 1 ? '' : 's'} in total`;
    }
    const hint = form.querySelector('#f_hint');
    hint.textContent = text;
    hint.classList.toggle('bad', bad);
  }

  function prefill() {
    const ids = checkedIds();
    form.querySelectorAll('.val').forEach((v) => { v.value = ''; });
    if (!ids.length) return;
    if (type === 'exact' && amountMinor() > 0) allocate(amountMinor(), ids.map(() => 1)).forEach((v, i) => { form.querySelector(`[data-val="${ids[i]}"]`).value = num(v); });
    if (type === 'percent') allocate(10000, ids.map(() => 1)).forEach((v, i) => { form.querySelector(`[data-val="${ids[i]}"]`).value = (v / 100).toFixed(2); });
    if (type === 'shares') ids.forEach((pid) => { form.querySelector(`[data-val="${pid}"]`).value = '1'; });
  }

  function applyGroup(reset) {
    const g = store.getRecord('groups', form.elements.groupId.value);
    const allowed = g ? new Set(g.members) : null;
    rowEls().forEach((r) => {
      const ok = !allowed || allowed.has(r.dataset.pid);
      const cb = r.querySelector('input[type=checkbox]');
      r.hidden = !ok;
      if (!ok) cb.checked = false;
      else if (reset) cb.checked = true;
    });
    [...form.elements.payer.options].forEach((o) => {
      const ok = !allowed || allowed.has(o.value);
      o.hidden = !ok;
      o.disabled = !ok;
    });
    if (allowed && !allowed.has(form.elements.payer.value)) form.elements.payer.value = ME;
    if (type !== 'equal') prefill();
    refresh();
  }

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    type = b.dataset.type;
    form.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('on', x === b));
    prefill();
    refresh();
  });
  form.addEventListener('input', refresh);
  form.addEventListener('change', (e) => { if (e.target.name === 'groupId') applyGroup(true); else refresh(); });
  if (editing && type !== 'equal') refresh(); else applyGroup(false);
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
  const picked = new Set(editing ? editing.members : []);
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
