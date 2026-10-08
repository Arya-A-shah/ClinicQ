// End-to-end API tests. Start the server first (with DEV_LOGIN=true and a staff
// login "reception" / "clinic1234"), then run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE || 'http://localhost:4000/api';

// Minimal cookie-keeping client, so each "browser" has its own session.
function client() {
  const jar = {};
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      jar[k] = v;
    }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

const staff = client();
const alice = client();
const bob = client();
const anon = client();

test('staff routes need login', async () => {
  assert.equal((await anon('/staff/queue')).status, 401);
  assert.equal((await anon('/staff/call-next', { method: 'POST' })).status, 401);
});

test('wrong staff password is rejected', async () => {
  const r = await staff('/staff/login', { method: 'POST', body: { username: 'reception', password: 'nope' } });
  assert.equal(r.status, 401);
});

test('staff can log in and close booking', async () => {
  const r = await staff('/staff/login', { method: 'POST', body: { username: 'reception', password: 'clinic1234' } });
  assert.equal(r.status, 200);
  assert.equal((await staff('/staff/settings', { method: 'PATCH', body: { bookingOpen: false } })).status, 200);
});

test('booking needs sign-in, and is refused while closed', async () => {
  assert.equal((await anon('/tokens', { method: 'POST', body: { patientName: 'Ravi' } })).status, 401);
  await alice('/auth/dev', { method: 'POST', body: { email: 'alice@example.com' } });
  const r = await alice('/tokens', { method: 'POST', body: { patientName: 'Alice' } });
  assert.equal(r.status, 403);
});

let aliceToken;
test('patient books once booking opens; bad input rejected', async () => {
  await staff('/staff/settings', { method: 'PATCH', body: { bookingOpen: true, maxActivePerAccount: 2 } });
  assert.equal((await alice('/tokens', { method: 'POST', body: { patientName: '<script>' } })).status, 400);
  assert.equal((await alice('/tokens', { method: 'POST', body: { patientName: 'Alice', phone: '12345' } })).status, 400);
  const r = await alice('/tokens', { method: 'POST', body: { patientName: 'Alice Kulkarni', phone: '+91 98765 43210' } });
  assert.equal(r.status, 201);
  aliceToken = r.data;
});

test('one account cannot hold more than the limit', async () => {
  assert.equal((await alice('/tokens', { method: 'POST', body: { patientName: 'Alice Son' } })).status, 201);
  assert.equal((await alice('/tokens', { method: 'POST', body: { patientName: 'Third Person' } })).status, 429);
});

test('simultaneous bookings never get the same number', async () => {
  const users = Array.from({ length: 8 }, (_, i) => client());
  await Promise.all(users.map((u, i) => u('/auth/dev', { method: 'POST', body: { email: `p${i}@example.com` } })));
  const results = await Promise.all(users.map((u, i) => u('/tokens', { method: 'POST', body: { patientName: `Patient ${'abcdefgh'[i]}` } })));
  const nums = results.map((r) => r.data.number);
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(nums).size, nums.length);
});

test('walk-in, call next, position and ETA update', async () => {
  await bob('/auth/dev', { method: 'POST', body: { email: 'bob@example.com' } });
  const w = await staff('/staff/walkin', { method: 'POST', body: { patientName: 'Walk In Uncle' } });
  assert.equal(w.status, 201);

  const before = (await alice('/me')).data.tokens.find((t) => t.number === aliceToken.number);
  assert.equal(before.ahead, 0);

  const c = await staff('/staff/call-next', { method: 'POST' });
  assert.equal(c.data.called.number, aliceToken.number);
  const after = (await alice('/me')).data.tokens.find((t) => t.number === aliceToken.number);
  assert.equal(after.status, 'called');

  const pub = (await anon('/queue')).data;
  assert.equal(pub.nowServing, aliceToken.number);
  assert.ok(!JSON.stringify(pub).includes('Alice'), 'public state must not leak names');
});

test('patient cannot cancel someone else’s token; can cancel own', async () => {
  const q = (await staff('/staff/queue')).data;
  const aliceSecond = q.tokens.find((t) => t.patientName === 'Alice Son');
  assert.equal((await bob(`/tokens/${aliceSecond.id}/cancel`, { method: 'POST' })).status, 404);
  assert.equal((await alice(`/tokens/${aliceSecond.id}/cancel`, { method: 'POST' })).status, 200);
});

test('skip and put back in line', async () => {
  const c = await staff('/staff/call-next', { method: 'POST' });
  const q = (await staff('/staff/queue')).data;
  const cur = q.tokens.find((t) => t.status === 'called');
  assert.equal(cur.number, c.data.called.number);
  assert.equal((await staff(`/staff/tokens/${cur.id}/status`, { method: 'POST', body: { status: 'skipped' } })).status, 200);
  assert.equal((await staff(`/staff/tokens/${cur.id}/status`, { method: 'POST', body: { status: 'done' } })).status, 400);
  assert.equal((await staff(`/staff/tokens/${cur.id}/status`, { method: 'POST', body: { status: 'waiting' } })).status, 200);
  const next = await staff('/staff/call-next', { method: 'POST' });
  assert.equal(next.data.called.number, cur.number, 're-queued patient goes first');
});

test('double-tapping "call next" calls exactly two different people', async () => {
  const [a, b] = await Promise.all([
    staff('/staff/call-next', { method: 'POST' }),
    staff('/staff/call-next', { method: 'POST' }),
  ]);
  assert.notEqual(a.data.called.number, b.data.called.number);
  const q = (await staff('/staff/queue')).data;
  assert.equal(q.tokens.filter((t) => t.status === 'called').length, 1);
});

test('bad ids and settings are handled', async () => {
  assert.equal((await staff('/staff/tokens/not-an-id/status', { method: 'POST', body: { status: 'done' } })).status, 404);
  assert.equal((await staff('/staff/settings', { method: 'PATCH', body: { dailyLimit: -5 } })).status, 400);
});
