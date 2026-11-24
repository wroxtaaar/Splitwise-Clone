// Supabase email + password login using plain fetch (no library).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SERVER_KEY = 'splits-server';
const SESSION_KEY = 'splits-session';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const cleanUrl = (v) => String(v || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
// https only, except a local server for development
const URL_OK = /^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** Project URL and anon key, from config.js or from what was typed on the login screen. */
export function server() {
  const saved = read(SERVER_KEY) || {};
  return { url: cleanUrl(SUPABASE_URL || saved.url), key: String(SUPABASE_ANON_KEY || saved.key || '').trim() };
}
export function configured() {
  const s = server();
  return URL_OK.test(s.url) && s.key.length > 20;
}
export function setServer(url, key) {
  write(SERVER_KEY, { url: cleanUrl(url), key: String(key || '').trim() });
}

export const getSession = () => read(SESSION_KEY);

function saveSession(j) {
  if (!j || !j.access_token || !j.user) throw new Error('Unexpected reply from the server');
  const session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user.id, email: j.user.email },
  };
  write(SESSION_KEY, session);
  return session;
}

async function tokenRequest(grant, body) {
  const { url, key } = server();
  const res = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.error_description || j.msg || j.message || `Sign-in failed (${res.status})`);
    err.status = res.status;
    err.auth = res.status >= 400 && res.status < 500; // the server said no, as opposed to being unreachable
    throw err;
  }
  return saveSession(j);
}

export const signIn = (email, password) => tokenRequest('password', { email: String(email).trim(), password });

let refreshing = null;
export function refresh() {
  const s = getSession();
  if (!s) return Promise.reject(Object.assign(new Error('Signed out'), { auth: true }));
  if (!refreshing) refreshing = tokenRequest('refresh_token', { refresh_token: s.refresh_token }).finally(() => { refreshing = null; });
  return refreshing;
}

/** A valid access token, refreshing it first when it is about to expire. */
export async function accessToken() {
  let s = getSession();
  if (!s) throw Object.assign(new Error('Signed out'), { auth: true });
  if (s.expires_at - 60 < Date.now() / 1000) s = await refresh();
  return s.access_token;
}

export function signOut() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
