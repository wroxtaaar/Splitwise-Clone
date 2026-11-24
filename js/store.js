// Local-first store. Every record has an id and updatedAt; deletes are tombstones ({deleted:true})
// so they can sync. Persisted to localStorage.
import { ME } from './logic.js';

const KEY = 'splitwise-clone-v2';
export const COLLECTIONS = ['people', 'groups', 'expenses', 'settlements'];

function blank() {
  const s = { settings: { currency: '₹', theme: 'system' } };
  COLLECTIONS.forEach((c) => (s[c] = {}));
  s.people[ME] = { id: ME, name: 'You', updatedAt: 0 };
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const b = blank();
      COLLECTIONS.forEach((c) => (b[c] = saved[c] || b[c]));
      b.settings = { ...b.settings, ...(saved.settings || {}) };
      return b;
    }
  } catch { /* corrupt or unavailable storage: start fresh */ }
  return blank();
}

let state = load();
const listeners = new Set();

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function emit(source) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  listeners.forEach((fn) => fn(source));
}

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
  state[coll][id] = { ...state[coll][id], ...rec, id, deleted: false, createdAt: state[coll][id]?.createdAt || now, updatedAt: now };
  emit('local');
  return id;
}

function tombstone(coll, id, now) {
  const r = state[coll][id];
  if (r && !r.deleted) state[coll][id] = { id, deleted: true, updatedAt: now };
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
  const now = Date.now();
  groups().filter((g) => g.members.includes(id)).forEach((g) => {
    state.groups[g.id] = { ...g, members: g.members.filter((m) => m !== id), updatedAt: now };
  });
  tombstone('people', id, now);
  emit('local');
}

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  emit('settings');
}

// ---- sync helpers ----
export function snapshot() {
  const out = {};
  COLLECTIONS.forEach((c) => (out[c] = state[c]));
  return out;
}

/** Take any remote record that is newer than ours. Returns true if anything changed. */
export function mergeRemote(remote) {
  let changed = false;
  for (const c of COLLECTIONS) {
    for (const [id, r] of Object.entries((remote && remote[c]) || {})) {
      if (!r || typeof r !== 'object') continue;
      const mine = state[c][id];
      if (!mine || (r.updatedAt || 0) > (mine.updatedAt || 0)) {
        state[c][id] = { ...r, id };
        changed = true;
      }
    }
  }
  if (changed) emit('remote');
  return changed;
}

/** Multi-path PATCH body of local records that are missing from or newer than the remote copy. */
export function diffForPush(remote) {
  const patch = {};
  for (const c of COLLECTIONS) {
    const theirs = (remote && remote[c]) || {};
    for (const [id, r] of Object.entries(state[c])) {
      if (!theirs[id] || (r.updatedAt || 0) > (theirs[id].updatedAt || 0)) patch[`${c}/${id}`] = r;
    }
  }
  return patch;
}

/** Replace everything with a backup. Records not in the backup are tombstoned so other devices follow. */
export function importBackup(data) {
  if (!data || typeof data !== 'object' || !data.people || !data.expenses) throw new Error('Not a valid backup');
  const now = Date.now();
  for (const c of COLLECTIONS) {
    const incoming = data[c] || {};
    for (const id of Object.keys(state[c])) if (!incoming[id]) tombstone(c, id, now);
    for (const [id, r] of Object.entries(incoming)) state[c][id] = { ...r, id, updatedAt: now };
  }
  if (!state.people[ME] || state.people[ME].deleted) state.people[ME] = { id: ME, name: 'You', updatedAt: now };
  emit('local');
}
