// Automatic sync with Supabase (PostgREST) using plain fetch.
//
//   pull: everything the server changed since the last pull (plus a small overlap), merged per record
//   push: only the records this device changed and the server hasn't seen yet
//
// The server keeps the newest version of each record (see supabase/setup.sql), so two devices
// adding expenses at the same time never overwrite each other. Runs on open, after every change,
// when the app comes back to the foreground or the network returns, and every few seconds while open.
import * as store from './store.js';
import * as auth from './auth.js';

const PAGE = 500;
const OVERLAP_MS = 10000;
const pollMs = () => {
  try { return Number(localStorage.getItem('splits-poll-ms')) || 8000; } catch { return 8000; }
};

let status = 'off'; // off | connecting | connected | offline | error | denied
let running = false;
let current = null;
let again = false;
let pushTimer = null;
let pollTimer = null;
let installed = false;
let authLost = () => {};
const listeners = new Set();

const TEXT = {
  off: 'Not syncing',
  connecting: 'Connecting…',
  connected: 'Synced',
  offline: 'Offline. Changes will sync when you reconnect.',
  error: 'Sync problem. Will retry.',
  denied: 'This account is not allowed. Check the SQL setup.',
};
export const getStatus = () => status;
export const statusText = (s = status) => TEXT[s] || '';
export const onStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const onAuthLost = (fn) => { authLost = fn; };
function setStatus(s) {
  if (s === status) return;
  status = s;
  listeners.forEach((fn) => fn(s));
}

class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function rest(path, init = {}, retried = false) {
  const { url, key } = auth.server();
  let token;
  try { token = await auth.accessToken(); } catch (e) { throw e.auth ? new SyncError('auth', e.message) : e; }
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (res.status === 401) {
    if (retried) throw new SyncError('auth', 'Session expired');
    try { await auth.refresh(); } catch (e) { throw e.auth ? new SyncError('auth', e.message) : e; }
    return rest(path, init, true);
  }
  if (res.status === 403) throw new SyncError('denied', 'Not allowed');
  if (!res.ok) throw new SyncError('http', `HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function pull() {
  const known = store.getCursor();
  const t = known ? Date.parse(known) : NaN;
  let from = Number.isNaN(t) ? '' : new Date(t - OVERLAP_MS).toISOString();
  let newest = known;
  for (;;) {
    const q = `records?select=coll,id,data,server_ts&order=server_ts.asc&limit=${PAGE}` + (from ? `&server_ts=gt.${encodeURIComponent(from)}` : '');
    const rows = await rest(q);
    if (!rows.length) break;
    store.mergeRemote(rows.map((r) => ({ coll: r.coll, id: r.id, data: r.data })));
    newest = rows[rows.length - 1].server_ts;
    from = newest;
    if (rows.length < PAGE) break;
  }
  if (newest !== known) store.setCursor(newest);
}

async function push() {
  const batch = store.dirtyRecords();
  if (!batch.length) return;
  const body = batch.map(({ coll, id, rec }) => ({ coll, id, data: rec, updated_at: rec.updatedAt || 0, deleted: !!rec.deleted }));
  await rest('records?on_conflict=coll,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) });
  store.clearDirty(batch);
}

function handle(e) {
  if (e.kind === 'auth') authLost(e.message);
  else if (e.kind === 'denied') setStatus('denied');
  else if (e instanceof TypeError) setStatus('offline'); // fetch could not reach the network
  else setStatus('error');
}

/** Pull, then push. Resolves when finished; overlapping calls share one run (and trigger one more). */
export function syncNow() {
  if (!running) return Promise.resolve();
  if (current) { again = true; return current; }
  if (status === 'off') setStatus('connecting'); // while retrying, keep showing Offline / Not allowed instead of flickering
  current = (async () => {
    try {
      await pull();
      await push();
      setStatus('connected');
    } catch (e) {
      handle(e);
    } finally {
      current = null;
      if (again) { again = false; schedule(50); }
    }
  })();
  return current;
}

function schedule(delay = 400) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, delay);
}

export function start() {
  running = true;
  if (!installed) {
    installed = true;
    store.subscribe((source) => { if (source === 'local' && running) schedule(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && running) syncNow(); });
    window.addEventListener('online', () => { if (running) syncNow(); });
  }
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) syncNow(); }, pollMs());
  return syncNow();
}

export function stop() {
  running = false;
  clearTimeout(pushTimer);
  clearInterval(pollTimer);
  setStatus('off');
}
