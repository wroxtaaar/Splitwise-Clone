// Supabase Edge Function "notify": turns a database change into a push notification for the OTHER person.
// Called only by the database trigger in supabase/push.sql (checked with the x-push-secret header).
// Secrets it needs (Edge Functions -> Secrets): PUSH_SECRET, FIREBASE_SERVICE_ACCOUNT. Turn "Verify JWT" OFF.
// Written as plain JavaScript so it also runs under Node for the tests.

const env = (k) => (globalThis.Deno ? globalThis.Deno.env.get(k) : process.env[k]);
const CURRENCY = () => env('CURRENCY') || '₹';

const money = (paise) => `${CURRENCY()}${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** What this person should read. Pure: easy to test. */
export function compose({ kind, coll, actor, data, old }, target, names, groupName) {
  const who = names[actor] || 'Someone';
  const d = data || old || {};
  if (coll === 'settlements') {
    const from = names[d.from] || 'Someone', to = names[d.to] || 'Someone';
    const line = d.to === target ? `${from} paid you ${money(d.amount || 0)}` : d.from === target ? `You paid ${to} ${money(d.amount || 0)}` : `${from} paid ${to} ${money(d.amount || 0)}`;
    const verb = { added: '', edited: ' (edited)', deleted: ' (deleted)' }[kind];
    return { title: kind === 'deleted' ? `${who} deleted a payment` : kind === 'edited' ? `${who} edited a payment` : line, body: kind === 'added' ? '' : line + verb };
  }
  const desc = clip(String(d.description || 'an expense'), 60);
  const verb = { added: 'added', edited: 'edited', deleted: 'deleted' }[kind];
  const title = `${who} ${verb} “${desc}”${groupName ? ` in “${clip(groupName, 40)}”` : ''}`;
  const splits = d.splits || {};
  let body;
  if (d.payer === target) {
    const owed = Object.entries(splits).filter(([id]) => id !== target).reduce((s, [, v]) => s + v, 0);
    body = owed > 0 ? `You are owed ${money(owed)}` : `You paid ${money(d.amount || 0)}`;
  } else if (splits[target] > 0) body = `You owe ${money(splits[target])}`;
  else body = `Total ${money(d.amount || 0)}`;
  return { title, body };
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let tokenCache = { value: '', exp: 0 };

async function googleToken(sa, fetchFn) {
  if (tokenCache.value && tokenCache.exp > Date.now() + 60000) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Google sign-in failed: ' + JSON.stringify(j));
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

export async function handle(req, fetchFn = fetch) {
  const secret = env('PUSH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) return new Response('forbidden', { status: 403 });
  const evt = await req.json();
  if (!evt || !evt.actor || !['expenses', 'settlements'].includes(evt.coll)) return new Response('ignored');

  const base = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
  const sb = (path, init = {}) => fetchFn(`${base}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, ...init.headers } });
  const [tokens, people] = await Promise.all([
    sb(`push_tokens?select=token,user_id&user_id=neq.${encodeURIComponent(evt.actor)}`).then((r) => r.json()),
    sb('records?select=id,data&coll=eq.people&deleted=eq.false').then((r) => r.json()),
  ]);
  if (!Array.isArray(tokens) || !tokens.length) return new Response('nobody to notify');
  const names = Object.fromEntries((Array.isArray(people) ? people : []).map((p) => [p.id, p.data?.name]));
  const gid = (evt.data || evt.old || {}).groupId;
  let groupName = '';
  if (gid) {
    const g = await sb(`records?select=data&coll=eq.groups&id=eq.${encodeURIComponent(gid)}`).then((r) => r.json());
    groupName = (Array.isArray(g) && g[0]?.data?.name) || '';
  }

  const sa = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT'));
  const access = await googleToken(sa, fetchFn);
  let sent = 0;
  for (const t of tokens) {
    const { title, body } = compose(evt, t.user_id, names, groupName);
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: t.token, notification: { title, body }, data: { tab: 'activity', coll: evt.coll, id: String(evt.id) }, android: { priority: 'HIGH', notification: { tag: String(evt.id) } } } }),
    });
    if (res.ok) sent++;
    else if (res.status === 404 || res.status === 400) await sb(`push_tokens?token=eq.${encodeURIComponent(t.token)}`, { method: 'DELETE' }); // phone uninstalled the app
    else console.error('FCM error', res.status, await res.text());
  }
  return new Response(`sent ${sent}`);
}

if (globalThis.Deno) globalThis.Deno.serve((req) => handle(req).catch((e) => { console.error(e); return new Response('error', { status: 500 }); }));
