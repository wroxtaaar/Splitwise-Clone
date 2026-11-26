// Bottom-sheet forms: add/edit expense, settle up, group, friend.
import { ME, toMinor, computeSplits, allocate } from '../logic.js';
import * as store from '../store.js';
import * as m from '../model.js';
import { toRecords } from '../importer.js';
import { esc, icon, money, today, toast, confirmDialog, avatarStyle, artStyle, initial, dayOf, monthShort } from './util.js';

export const sheetOpen = () => document.querySelector('.overlay') !== null;
export const closeSheets = () => document.querySelectorAll('.overlay').forEach((o) => o.remove());
/** Back button: close only the top-most sheet (a picker on top of the expense page, say). */
export const closeTopSheet = () => [...document.querySelectorAll('.overlay')].at(-1)?.remove();

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
  ({ expense: expenseSheet, settle: settleSheet, group: groupSheet, members: membersSheet, friend: friendSheet, import: importSheet })[kind]?.(opts);
}

const everyone = () => [store.getRecord('people', ME), ...m.friends()];
const nameOf = (p) => (p.id === ME ? 'You' : p.name === 'You' ? 'Partner' : p.name);
const options = (list, selected) => list.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(nameOf(p))}</option>`).join('');
const num = (minor) => (minor / 100).toFixed(2);

// ---------------- expense (full-screen page, like Splitwise) ----------------
const GROUP_GLYPH = '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7.5" r="3.3"/><path d="M5.8 19.5c0-3.3 2.7-5.2 6.2-5.2s6.2 1.9 6.2 5.2z"/><circle cx="4.6" cy="10.4" r="2.3"/><circle cx="19.4" cy="10.4" r="2.3"/><path d="M.6 18.4c0-2.3 1.5-3.8 3.6-3.8.7 0 1.3.1 1.8.4-1 1-1.6 2.1-1.8 3.4zM23.4 18.4c0-2.3-1.5-3.8-3.6-3.8-.7 0-1.3.1-1.8.4 1 1 1.6 2.1 1.8 3.4z"/></svg>';

/** Small bottom sheet with one tappable row per option. Resolves with the chosen value, or undefined if dismissed. */
function pickOne({ title, items, selected }) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'overlay';
    layer.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><button type="button" class="iconbtn" data-close aria-label="Close">${icon('close')}</button><h2>${esc(title)}</h2></div>
      <div class="sheet-body">${items.map((it) => `<button type="button" class="pick-row ${it.value === selected ? 'on' : ''}" data-v="${esc(it.value)}">${it.lead || ''}<span class="pick-main">${esc(it.label)}</span>${it.value === selected ? icon('check', 20, 2.2) : ''}</button>`).join('')}</div></div>`;
    const done = (v) => { layer.remove(); resolve(v); };
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.closest('[data-close]')) return done(undefined);
      const row = e.target.closest('[data-v]');
      if (row) done(row.dataset.v);
    });
    document.body.appendChild(layer);
  });
}

/** Same, but with tick boxes. Resolves with the ticked values after "Done", or undefined if dismissed. */
function pickMany({ title, items, checked }) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'overlay';
    layer.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><button type="button" class="iconbtn" data-close aria-label="Close">${icon('close')}</button><h2>${esc(title)}</h2><button type="button" class="save" data-done>Done</button></div>
      <div class="sheet-body"><div class="people">${items.map((it) => `<div class="person"><input type="checkbox" id="pm_${it.value}" value="${esc(it.value)}" ${checked.has(it.value) ? 'checked' : ''}><label class="name" for="pm_${it.value}">${esc(it.label)}</label></div>`).join('')}</div></div></div>`;
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.closest('[data-close]')) { layer.remove(); resolve(undefined); }
      else if (e.target.closest('[data-done]')) { const v = [...layer.querySelectorAll('input:checked')].map((c) => c.value); layer.remove(); resolve(v); }
    });
    document.body.appendChild(layer);
  });
}

/** Full-screen page: back arrow, title, tick to save. Stays above the keyboard. */
function presentScreen(title, body, onSave) {
  const layer = document.createElement('div');
  layer.className = 'overlay screen';
  layer.innerHTML = `<form class="xs" novalidate>
    <div class="xs-bar"><button type="button" class="iconbtn" data-close aria-label="Back">${icon('back', 24, 2.2)}</button><h2>${esc(title)}</h2><button class="iconbtn xs-save" aria-label="Save">${icon('check', 26, 2.2)}</button></div>${body}</form>`;
  const form = layer.querySelector('form');
  layer.querySelector('[data-close]').addEventListener('click', () => layer.remove());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (onSave(form) !== false) layer.remove();
  });
  document.body.appendChild(layer);
  // Browsers that don't resize the page for the keyboard: follow the visible area so the bottom bar stays visible.
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      if (!layer.isConnected) { vv.removeEventListener('resize', fit); return; }
      form.style.height = `${Math.round(vv.height)}px`;
    };
    vv.addEventListener('resize', fit);
    fit();
  }
  return { form, layer };
}

function expenseSheet({ id, groupId, friendId }) {
  const editing = id ? store.getRecord('expenses', id) : null;
  const people = everyone();
  if (people.length < 2) return toast('Add a friend first');
  const symbol = store.getState().settings.currency;
  const groupList = m.allGroups();
  const startGroup = editing ? editing.groupId : groupId && groupId !== m.NO_GROUP ? groupId : null;
  const group0 = startGroup && store.getRecord('groups', startGroup) ? startGroup : null;
  // Whoever did not pay owes the whole amount (with more than two people they share it equally).
  // In a group that is everyone else in the group. With no group it is the people ticked under "With you and"
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

  const date0 = editing?.date || today();
  const { form } = presentScreen(editing ? 'Edit expense' : 'Add expense', `
    <div class="xs-with"><span>With <b>you</b> and:</span><button type="button" class="xs-chip" data-x="chip"><span class="xs-av" id="x_av"></span><span class="xs-chiptext" id="x_with"></span></button></div>
    <div class="xs-fields">
      <div class="xs-row"><div class="xs-box">${icon('receipt', 30, 1.8)}</div><input class="xs-in" id="f_desc" name="description" maxlength="80" value="${esc(editing?.description || '')}" placeholder="Enter a description" autocomplete="off" enterkeyhint="next"></div>
      <div class="xs-row"><div class="xs-box xs-cur">${esc(symbol)}</div><input class="xs-in xs-amt" id="f_amount" name="amount" inputmode="decimal" value="${editing ? num(editing.amount) : ''}" placeholder="0.00" autocomplete="off"></div>
    </div>
    <button type="button" class="xs-split" data-x="split" id="x_split"></button>
    <div class="xs-hint" id="f_hint"></div>
    <div class="xs-notes" id="x_notes" ${editing?.notes ? '' : 'hidden'}><textarea class="textarea" name="notes" rows="3" placeholder="Add notes">${esc(editing?.notes || '')}</textarea></div>
    <div class="xs-grow"></div>
    <div class="xs-bottom">
      <button type="button" class="xs-group" data-x="group"><span class="xs-gicon">${GROUP_GLYPH}</span><span id="x_group">No group</span></button>
      <span class="xs-date" id="x_dateText"></span>
      <label class="xs-act cal" aria-label="Date">${icon('calendar', 30, 2.2)}<input type="date" name="date" class="xs-datein" value="${date0}"></label>
      <button type="button" class="xs-act cam" data-x="cam" aria-label="Add a photo">${icon('camera', 30, 2.2)}</button>
      <button type="button" class="xs-act note" data-x="note" aria-label="Notes">${icon('note', 30, 2.2)}</button>
    </div>
    <input type="hidden" name="payer" value="${editing?.payer || ME}"><input type="hidden" name="groupId" value="${group0 || ''}">`,
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

  const q = (sel) => form.querySelector(sel);
  const curGroup = () => store.getRecord('groups', form.elements.groupId.value);

  function refresh() {
    const payer = form.elements.payer.value;
    const g = curGroup();
    const others = othersOf(form.elements.groupId.value || null, payer);
    const v = toMinor(form.elements.amount.value);
    const amt = Number.isNaN(v) || !v ? '' : ` of ${money(v)}`;
    const names = others.map(nm);
    const verb = names.length === 1 && names[0] !== 'You' ? 'owes' : 'owe';
    q('#f_hint').textContent = names.length ? `${names.join(', ')} ${verb} ${payer === ME ? 'you' : nm(payer)} the full amount${amt}.` : '';
    q('#x_split').innerHTML = `Paid by <b>${esc(payer === ME ? 'you' : nm(payer))}</b> and split <b>equally</b>.`;
    q('#x_group').textContent = g ? g.name : 'No group';
    // the "With you and:" chip: the whole group, or the people ticked
    const others2 = people.filter((p) => p.id !== ME);
    const picked = others2.filter((p) => others2.length === 1 || withSet.has(p.id));
    const label = g ? `All of ${g.name}` : (picked.map((p) => nameOf(p)).join(', ') || 'Choose people');
    q('#x_with').textContent = label;
    const av = q('#x_av');
    if (g) { av.setAttribute('style', artStyle(g.id)); av.innerHTML = icon('users', 16, 2); }
    else { av.setAttribute('style', picked[0] ? avatarStyle(picked[0].id) : ''); av.textContent = picked[0] ? initial(picked[0].name) : '?'; }
  }

  function updateDate() {
    const d = form.elements.date.value;
    q('#x_dateText').textContent = d && d !== today() ? `${dayOf(d)} ${monthShort(d)}` : '';
  }

  function applyGroup() {
    const g = curGroup();
    if (g && !g.members.includes(form.elements.payer.value)) form.elements.payer.value = ME;
    refresh();
  }

  async function chooseGroup() {
    const v = await pickOne({
      title: 'Group',
      selected: form.elements.groupId.value,
      items: [{ value: '', label: 'No group', lead: `<span class="pick-lead">${GROUP_GLYPH}</span>` },
        ...groupList.map((g) => ({ value: g.id, label: g.name, lead: `<span class="pick-lead art-dot" style="${artStyle(g.id)}"></span>` }))],
    });
    if (v === undefined) return;
    form.elements.groupId.value = v;
    applyGroup();
  }

  async function choosePayer() {
    const mem = gMembers(form.elements.groupId.value || null);
    const v = await pickOne({
      title: 'Who paid?',
      selected: form.elements.payer.value,
      items: people.filter((p) => !mem || mem.includes(p.id)).map((p) => ({ value: p.id, label: nameOf(p), lead: `<span class="avatar pick-lead" style="${avatarStyle(p.id)}">${esc(initial(p.name))}</span>` })),
    });
    if (v === undefined) return;
    form.elements.payer.value = v;
    refresh();
  }

  async function chooseWith() {
    const cand = people.filter((p) => p.id !== form.elements.payer.value);
    if (curGroup() || cand.length < 2) return chooseGroup();
    const v = await pickMany({ title: 'Split with', items: cand.map((p) => ({ value: p.id, label: nameOf(p) })), checked: withSet });
    if (v === undefined) return;
    cand.forEach((p) => withSet.delete(p.id));
    v.forEach((x) => withSet.add(x));
    refresh();
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', (e) => { if (e.target.name === 'date') updateDate(); refresh(); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.name === 'description') { e.preventDefault(); form.elements.amount.focus(); }
  });
  form.addEventListener('click', (e) => {
    const t = e.target.closest('[data-x]');
    if (!t) return;
    switch (t.dataset.x) {
      case 'chip': chooseWith(); break;
      case 'split': choosePayer(); break;
      case 'group': chooseGroup(); break;
      case 'cam': toast('Receipt photos aren’t supported yet'); break;
      case 'note': {
        const box = q('#x_notes');
        box.hidden = !box.hidden;
        if (!box.hidden) form.elements.notes.focus();
        break;
      }
      default:
    }
  });
  form.elements.date.addEventListener('click', () => { try { form.elements.date.showPicker(); } catch { /* the phone opens its own picker */ } });
  updateDate();
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
  const others = editing ? everyone().filter((p) => p && p.id !== id) : [];
  const { form, layer } = present(editing ? 'Edit friend' : 'Add a friend', `
    <div class="field"><label for="p_name">Name</label><input class="input" id="p_name" name="name" maxlength="40" value="${esc(editing?.name || '')}" autocomplete="off"></div>
    ${editing ? `<div class="row" style="border:0"><div class="avatar" style="${avatarStyle(id)}">${esc(initial(editing.name))}</div><div class="main muted">Friends can be added to groups and expenses.</div></div>${others.length ? `<div class="field" style="margin-top:14px"><label for="p_merge">Same person as another friend?</label><select class="select" id="p_merge"><option value="">Choose who to merge into…</option>${others.map((p) => `<option value="${p.id}">${esc(nameOf(p))}</option>`).join('')}</select><button type="button" class="btn block" data-merge style="margin-top:8px">Merge into selected</button><div class="hint">Moves all expenses, payments and group memberships to them, then removes ${esc(editing.name)}.</div></div>` : ''}<button type="button" class="btn danger block" data-delete>Remove friend</button>` : ''}`,
  (f) => {
    const name = f.elements.name.value.trim();
    if (!name) { toast('Enter a name'); return false; }
    if (m.friends().some((p) => p.id !== editing?.id && p.name.toLowerCase() === name.toLowerCase())) { toast('You already have a friend with that name'); return false; }
    store.put('people', { id: editing?.id, name });
    toast(editing ? 'Friend updated' : 'Friend added');
  });
  layer.querySelector('[data-merge]')?.addEventListener('click', async () => {
    const to = layer.querySelector('#p_merge').value;
    if (!to) { toast('Choose who to merge into'); return; }
    const target = store.getRecord('people', to);
    if (await confirmDialog(`Merge ${editing.name} into ${nameOf(target)}?`, 'Merge')) {
      layer.remove();
      store.mergePerson(editing.id, to);
      toast('Merged');
    }
  });
  layer.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (store.personInUse(editing.id)) { toast('Has expenses or payments: use "Merge into selected" or delete those first'); return; }
    if (await confirmDialog(`Remove ${editing.name}?`, 'Remove')) {
      layer.remove();
      store.removePerson(editing.id);
      toast('Friend removed');
    }
  });
  if (!editing) form.elements.name.focus();
}

// ---------------- group members: see and rename ----------------
function membersSheet({ id }) {
  const g = store.getRecord('groups', id);
  if (!g) return;
  const list = g.members.map((pid) => store.getRecord('people', pid)).filter(Boolean);
  const row = (p) => p.id === ME
    ? `<div class="row" style="border:0"><div class="avatar" style="${avatarStyle(p.id)}">${esc(initial(p.name))}</div><div class="main"><div class="title">You</div><div class="muted">Change your own name under Account → Profile</div></div></div>`
    : `<div class="row" style="border:0"><div class="avatar" style="${avatarStyle(p.id)}">${esc(initial(p.name))}</div><div class="main"><input class="input" data-pid="${p.id}" value="${esc(p.name)}" maxlength="40" autocomplete="off" aria-label="Name"></div></div>`;
  present(`${g.name}: people`, list.map(row).join('') + '<div class="hint">Renaming changes the name everywhere (all groups and expenses).</div>', (f) => {
    const inputs = [...f.querySelectorAll('[data-pid]')];
    const names = new Set(list.filter((p) => !inputs.some((i) => i.dataset.pid === p.id)).map((p) => (p.name || '').toLowerCase()));
    for (const i of inputs) {
      const name = i.value.trim();
      if (!name) { toast('Names cannot be empty'); return false; }
      if (names.has(name.toLowerCase())) { toast(`Two people are called ${name}`); return false; }
      names.add(name.toLowerCase());
    }
    let changed = 0;
    inputs.forEach((i) => {
      const p = store.getRecord('people', i.dataset.pid);
      if (p && p.name !== i.value.trim()) { store.put('people', { id: p.id, name: i.value.trim() }); changed += 1; }
    });
    if (changed) toast('Renamed');
  });
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
