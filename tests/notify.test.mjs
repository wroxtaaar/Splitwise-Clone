import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.PUSH_SECRET = 's3cret';
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'proj', client_email: 'sa@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const { compose, handle } = await import('../supabase/functions/notify/index.ts');

const W = 'w-id', P = 'p-id';
const names = { [W]: 'Wasiq', [P]: 'Papa' };
const expense = { description: 'WiFi Bill', amount: 50000, payer: W, splits: { [P]: 50000 }, groupId: 'g1' };

test('compose: the other person reads what they owe, the payer reads what they are owed', () => {
  assert.deepEqual(compose({ kind: 'added', coll: 'expenses', actor: W, data: expense }, P, names, 'Home'), { title: 'Wasiq added “WiFi Bill” in “Home”', body: 'You owe ₹500.00' });
  assert.equal(compose({ kind: 'added', coll: 'expenses', actor: P, data: { ...expense, payer: P, splits: { [W]: 50000 } } }, W, names, '').body, 'You owe ₹500.00');
  assert.equal(compose({ kind: 'added', coll: 'expenses', actor: P, data: { ...expense, payer: W } }, W, names, '').body, 'You are owed ₹500.00');
});
test('compose: payments and deletions', () => {
  const pay = { from: P, to: W, amount: 12345 };
  assert.equal(compose({ kind: 'added', coll: 'settlements', actor: P, data: pay }, W, names, '').title, 'Papa paid you ₹123.45');
  assert.equal(compose({ kind: 'deleted', coll: 'expenses', actor: W, data: expense }, P, names, '').title, 'Wasiq deleted “WiFi Bill” in “”'.replace(' in “”', ''));
});

function fakeFetch(log, { fcmStatus = 200 } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push({ url: u, init });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.startsWith('https://oauth2.googleapis.com')) return json({ access_token: 'ya29.fake', expires_in: 3600 });
    if (u.includes('/rest/v1/push_tokens') && !init.method) return json([{ token: 'tok-papa', user_id: P }]);
    if (u.includes('/rest/v1/push_tokens')) return json({});
    if (u.includes('coll=eq.people')) return json([{ id: W, data: { name: 'Wasiq' } }, { id: P, data: { name: 'Papa' } }]);
    if (u.includes('coll=eq.groups')) return json([{ data: { name: 'Home Expenses', members: [W, P] } }]);
    if (u.includes('fcm.googleapis.com')) return new Response('{}', { status: fcmStatus });
    return json({}, 404);
  };
}
const req = (body, secret = 's3cret') => new Request('https://f/notify', { method: 'POST', headers: { 'x-push-secret': secret }, body: JSON.stringify(body) });

test('handle: rejects a wrong secret', async () => {
  const res = await handle(req({}, 'nope'), fakeFetch([]));
  assert.equal(res.status, 403);
});
test('handle: sends one push to the other person only, signed with a Google token', async () => {
  const log = [];
  const res = await handle(req({ kind: 'added', coll: 'expenses', id: 'e1', actor: W, data: expense }), fakeFetch(log));
  assert.equal(await res.text(), 'sent 1');
  const tokenQuery = log.find((l) => l.url.includes('push_tokens?select'));
  assert.ok(tokenQuery.url.includes(`user_id=neq.${W}`), 'the sender is excluded');
  const fcm = log.find((l) => l.url.includes('fcm.googleapis.com'));
  assert.ok(fcm.url.includes('/projects/proj/'));
  assert.equal(fcm.init.headers.Authorization, 'Bearer ya29.fake');
  const m = JSON.parse(fcm.init.body).message;
  assert.equal(m.token, 'tok-papa');
  assert.equal(m.notification.title, 'Wasiq added “WiFi Bill” in “Home Expenses”');
  assert.equal(m.notification.body, 'You owe ₹500.00');
  const jwt = String(log.find((l) => l.url.includes('oauth2')).init.body.get('assertion')).split('.');
  assert.equal(jwt.length, 3);
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).iss, 'sa@proj.iam.gserviceaccount.com');
});
test('handle: forgets a token Firebase says is gone', async () => {
  const log = [];
  await handle(req({ kind: 'added', coll: 'expenses', id: 'e2', actor: W, data: expense }), fakeFetch(log, { fcmStatus: 404 }));
  assert.ok(log.some((l) => l.init.method === 'DELETE' && l.url.includes('push_tokens?token=eq.tok-papa')));
});
test('handle: ignores people/groups records', async () => {
  assert.equal(await (await handle(req({ kind: 'added', coll: 'people', id: 'x', actor: W, data: {} }), fakeFetch([]))).text(), 'ignored');
});

test('handle: nothing is sent for an expense outside a group', async () => {
  const log = [];
  const res = await handle(req({ kind: 'added', coll: 'expenses', id: 'e2', actor: W, data: { ...expense, groupId: null } }), fakeFetch(log));
  assert.match(await res.text(), /not in a group/);
  assert.ok(!log.some((l) => l.url.includes('fcm.googleapis.com')));
});
test('handle: only members of the group are told, and a deleted expense still finds its group', async () => {
  const log = [];
  const f = fakeFetch(log);
  const wrap = async (url, init) => (String(url).includes('coll=eq.groups') ? new Response(JSON.stringify([{ data: { name: 'Trip', members: [W, 'someone-else'] } }])) : f(url, init));
  const res = await handle(req({ kind: 'deleted', coll: 'expenses', id: 'e1', actor: W, data: { id: 'e1', deleted: true }, old: expense }), wrap);
  assert.match(await res.text(), /nobody to notify/); // Papa is not in this group
  assert.ok(!log.some((l) => l.url.includes('fcm.googleapis.com')));
});
