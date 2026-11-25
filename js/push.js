// Push notifications on the Android app (Capacitor PushNotifications + Firebase Cloud Messaging).
// In a browser there is no plugin, so everything here quietly does nothing.
// The phone's token is stored on the server (register_push_token in supabase/push.sql); a database
// trigger + Edge Function then push to it whenever the other person adds or changes something.
import * as auth from './auth.js';

const plugin = () => {
  try { return window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.PushNotifications || null : null; } catch { return null; }
};
export const supported = () => Boolean(plugin());

let token = '';
let wired = false;
let state = 'unknown'; // unknown | granted | denied | error
const listeners = new Set();
const setState = (s) => { state = s; listeners.forEach((fn) => fn(s)); };
export const getState = () => state;
export const onState = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const label = (s = state) => ({ unknown: 'Checking…', granted: 'On: you will be told when the other person adds or changes something.', denied: 'Off. Allow notifications for Splits in Android settings.', error: 'Could not turn on. Will retry next time you open the app.' }[s] || '');

async function rpc(name, args) {
  const { url, key } = auth.server();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${await auth.accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
}

async function upload() {
  if (!token) return;
  try { await rpc('register_push_token', { t: token }); setState('granted'); } catch { setState('error'); }
}

/** Call once signed in. onOpen runs when the person taps a notification; onForeground when one arrives while the app is open. */
export async function start({ onOpen, onForeground } = {}) {
  const P = plugin();
  if (!P) return;
  try {
    if (!wired) {
      wired = true;
      P.addListener('registration', (t) => { token = t.value; upload(); });
      P.addListener('registrationError', () => setState('error'));
      P.addListener('pushNotificationReceived', (n) => onForeground?.(n));
      P.addListener('pushNotificationActionPerformed', (a) => onOpen?.(a.notification?.data || {}));
    }
    let perm = await P.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await P.requestPermissions();
    if (perm.receive !== 'granted') { setState('denied'); return; }
    await P.register(); // fires 'registration' with the token
    if (token) upload();
  } catch { setState('error'); }
}

/** Sign-out: stop this phone receiving the account's notifications. */
export async function stop() {
  if (!token) return;
  try { await rpc('unregister_push_token', { t: token }); } catch { /* best effort */ }
}
