// Local-first store. Every record has an id and updatedAt; deletes are tombstones ({deleted:true})
// so they can sync. Records changed on this device are remembered in `dirty` until they reach the server.
// Persisted to localStorage, one copy per signed-in user.

export const COLLECTIONS = ['people', 'groups', 'expenses', 'settlements'];

const blank = () => {
  const s = { settings: { currency: '₹', theme: 'system' }, meta: { cursor: '' }, dirty: {} };
  COLLECTIONS.forEach((c) => (s[c] = {}));
  return s;
};

let KEY = 'splits-v3:none';
let state = blank();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const b = blank();
      COLLECTIONS.forEach((c) => (b[c] = saved[c] || {}));
      b.settings = { ...b.settings, ...(saved.settings || {}) };
      b.meta = { ...b.meta, ...(saved.meta || {}) };
      b.dirty = saved.dirty || {};
      return b;
    }
  } catch { /* corrupt or unavailable storage: start fresh */ }
  return blank();
}

/** Switch to the data belonging to one signed-in user. */
export function init(namespace) {
  KEY = 'splits-v3:' + namespace;
  state = load();
}

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}
function emit(source) {
  persist();
  listeners.forEach((fn) => fn(source));
}
const mark = (coll, id) => { state.dirty[`${coll}/${id}`] = 1; };

const live = (coll) => Object.values(state[coll]).filter((r) => !r.deleted);
export const people = () => live('people');
export const groups = () => live('groups');
export const expenses = () => live('expenses');
export const settlements = () => live('settlements');
export const getRecord = (coll, id) => {
  const r = state[coll][id];
  return r && !r.deleted ? r : null;
};

export function put(coll, rec) {
  const id = rec.id || uid();
  const now = Date.now();
  const before = state[coll][id];
  state[coll][id] = { ...before, ...rec, id, deleted: false, createdAt: before?.createdAt || now, updatedAt: Math.max(now, (before?.updatedAt || 0) + 1) };
  mark(coll, id);
  emit('local');
  return id;
}

/** Add many records at once (an import): one change event instead of one per record. */
export function putMany(coll, recs) {
  const now = Date.now();
  for (const rec of recs) {
    const before = state[coll][rec.id];
    state[coll][rec.id] = { ...before, ...rec, deleted: false, createdAt: rec.createdAt || before?.createdAt || now, updatedAt: Math.max(now, (before?.updatedAt || 0) + 1) };
    mark(coll, rec.id);
  }
  emit('local');
}

function tombstone(coll, id, now) {
  const r = state[coll][id];
  if (r && !r.deleted) {
    state[coll][id] = { id, deleted: true, updatedAt: Math.max(now, (r.updatedAt || 0) + 1) };
    mark(coll, id);
  }
}

export function removeRecord(coll, id) {
  tombstone(coll, id, Date.now());
  emit('local');
}

/** Deleting a group deletes its expenses and payments too, like Splitwise. */
export function removeGroup(id) {
  const now = Date.now();
  expenses().filter((e) => e.groupId === id).forEach((e) => tombstone('expenses', e.id, now));
  settlements().filter((s) => s.groupId === id).forEach((s) => tombstone('settlements', s.id, now));
  tombstone('groups', id, now);
  emit('local');
}

/** A person can only be removed once nothing refers to them. */
export function personInUse(id) {
  return (
    expenses().some((e) => e.payer === id || (e.splits && id in e.splits)) ||
    settlements().some((s) => s.from === id || s.to === id)
  );
}

export function removePerson(id) {
  if (state.people[id]?.isUser) return; // the two signed-in accounts can't be removed
  const now = Date.now();
  groups().filter((g) => g.members.includes(id)).forEach((g) => {
    state.groups[g.id] = { ...g, members: g.members.filter((m) => m !== id), updatedAt: Math.max(now, (g.updatedAt || 0) + 1) };
    mark('groups', g.id);
  });
  tombstone('people', id, now);
  emit('local');
}

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  emit('settings');
}

// ---- sync helpers ----
export const getCursor = () => state.meta.cursor || '';
export function setCursor(v) { state.meta.cursor = v; persist(); }

/** Live records for backups (tombstones are not exported). */
export function snapshot() {
  const out = {};
  COLLECTIONS.forEach((c) => {
    out[c] = Object.fromEntries(Object.entries(state[c]).filter(([, r]) => !r.deleted));
  });
  return out;
}

/** Records that still have to be uploaded. */
export function dirtyRecords() {
  return Object.keys(state.dirty)
    .map((key) => {
      const i = key.indexOf('/');
      const coll = key.slice(0, i);
      const id = key.slice(i + 1);
      return { key, coll, id, rec: state[coll]?.[id] };
    })
    .filter((x) => x.rec);
}

/** Forget the dirty flag, unless the record was edited again while it was being uploaded. */
export function clearDirty(batch) {
  for (const { key, coll, id, rec } of batch) {
    if (state[coll][id]?.updatedAt === rec.updatedAt) delete state.dirty[key];
  }
  persist();
}

/** Take any remote record that is newer than ours. rows: [{coll, id, data}]. Returns true if anything changed. */
export function mergeRemote(rows) {
  let changed = false;
  for (const { coll, id, data } of rows) {
    if (!COLLECTIONS.includes(coll) || !data || typeof data !== 'object') continue;
    const mine = state[coll][id];
    if (!mine || (data.updatedAt || 0) > (mine.updatedAt || 0)) {
      state[coll][id] = { ...data, id };
      delete state.dirty[`${coll}/${id}`]; // the server copy is newer than anything we still had to send
      changed = true;
    }
  }
  if (changed) emit('remote');
  return changed;
}

/** Replace everything with a backup. Records not in the backup are tombstoned so other devices follow. */
export function importBackup(data, myId) {
  if (!data || typeof data !== 'object' || !data.people || !data.expenses) throw new Error('Not a valid backup');
  const now = Date.now();
  const mine = state.people[myId];
  for (const c of COLLECTIONS) {
    const incoming = data[c] || {};
    for (const id of Object.keys(state[c])) {
      if (c === 'people' && state.people[id]?.isUser) continue; // never delete the two accounts
      if (!incoming[id]) tombstone(c, id, now);
    }
    for (const [id, r] of Object.entries(incoming)) {
      if (!r || r.deleted) continue;
      if (c === 'people' && state.people[id]?.isUser) continue;
      state[c][id] = { ...r, id, updatedAt: Math.max(now, (state[c][id]?.updatedAt || 0) + 1) };
      mark(c, id);
    }
  }
  if (mine && (!state.people[myId] || state.people[myId].deleted)) {
    state.people[myId] = { ...mine, updatedAt: now + 1 };
    mark('people', myId);
  }
  emit('local');
}
