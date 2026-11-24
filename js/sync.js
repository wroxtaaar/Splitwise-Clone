// Optional multi-device sync through a Firebase Realtime Database, using only fetch + EventSource.
// Each record syncs on its own (newest updatedAt wins), so two devices adding expenses
// at the same time no longer overwrite each other.
import { snapshot, mergeRemote, diffForPush, subscribe } from './store.js';

const KEY = 'splitwise-clone-sync';
let cfg = { dbUrl: '', code: '' };
try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ignore */ }

let status = 'off'; // off | connecting | connected | error
const statusListeners = new Set();
let stream = null;
let busy = false;
let again = false;
let timer = null;

export const getConfig = () => ({ ...cfg });
export const getStatus = () => status;
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));
const setStatus = (s) => { status = s; statusListeners.forEach((fn) => fn(s)); };
const enabled = () => Boolean(cfg.dbUrl && cfg.code);

export const cleanUrl = (v) => String(v || '').trim().replace(/\/+$/, '').replace(/\.json$/, '');
export const newCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
};
const url = () => `${cleanUrl(cfg.dbUrl)}/spaces/${encodeURIComponent(cfg.code)}.json`;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } };

async function request(method, body) {
  const res = await fetch(url(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Pull, merge, then push whatever the remote is missing. */
export async function syncNow() {
  if (!enabled()) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    const remote = (await request('GET')) || {};
    mergeRemote(remote);
    const patch = diffForPush(remote);
    if (Object.keys(patch).length) await request('PATCH', patch);
    setStatus('connected');
  } catch {
    setStatus('error');
  } finally {
    busy = false;
    if (again) { again = false; schedule(); }
  }
}

function schedule(delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

function listen() {
  stream?.close();
  stream = null;
  if (!enabled() || typeof EventSource === 'undefined') return;
  stream = new EventSource(url());
  const wake = () => schedule(250);
  stream.addEventListener('put', wake);
  stream.addEventListener('patch', wake);
  stream.onopen = () => setStatus('connected');
  stream.onerror = () => setStatus('connecting');
}

/** mode 'create' uploads this device's data to a new space; 'join' downloads an existing one. */
export async function connect(mode, dbUrl, code) {
  const cleaned = cleanUrl(dbUrl);
  const c = String(code || '').trim().toUpperCase();
  if (!/^https:\/\//.test(cleaned)) throw new Error('Enter a valid https:// database URL');
  if (c.length < 6) throw new Error('The shared code must be at least 6 characters');
  const previous = cfg;
  cfg = { dbUrl: cleaned, code: c };
  setStatus('connecting');
  try {
    if (mode === 'create') {
      await request('PATCH', snapshot());
    } else {
      const remote = await request('GET');
      if (!remote || !remote.people) throw new Error('No shared space found for that code');
      mergeRemote(remote);
    }
  } catch (err) {
    cfg = previous;
    setStatus(enabled() ? 'error' : 'off');
    throw err;
  }
  save();
  listen();
  schedule(0);
}

export function disconnect() {
  stream?.close();
  stream = null;
  cfg = { dbUrl: '', code: '' };
  save();
  setStatus('off');
}

export function startSync() {
  subscribe((source) => { if (source === 'local' && enabled()) schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled()) schedule(100); });
  window.addEventListener('online', () => enabled() && schedule(100));
  if (enabled()) { setStatus('connecting'); listen(); schedule(0); }
}
