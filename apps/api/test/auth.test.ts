import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, TEST_ORIGIN, TEST_PASSWORD, loggedIn, makeTestApp, seedMember, seedSchool } from './helpers/app';
import { sessions, users, authTokens } from '../src/modules/auth/auth.repository';
import { hashToken } from '../src/modules/auth/crypto';

const t = makeTestApp();
const { app } = t;
let A: Awaited<ReturnType<typeof seedSchool>>;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  t.email.outbox.length = 0;
  A = await seedSchool('alpha');
});

const tokenFromEmail = (to: string) => /token=([A-Za-z0-9_-]+)/.exec(t.email.lastTo(to)?.text ?? '')?.[1];

describe('REQ-AUTH login & session cookie', () => {
  it('logs in with email, sets a hardened cookie, auto-selects the only school, leaks no secrets', async () => {
    const c = new Client(app);
    const res = await c.login(A.ownerEmail);
    expect(res.status).toBe(200);
    expect(res.body.data.school.code).toBe('alpha');
    expect(res.body.data.activeMembershipId).toBe(String(A.ownerMembershipId));
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/edunex_sid=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|\$argon2/);
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.permissions.length).toBeGreaterThan(10);
  });

  it('stores only a hash of the session token', async () => {
    const c = new Client(app);
    const res = await c.login(A.ownerEmail);
    const token = /edunex_sid=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;
    const rows = await sessions.find({}, 'test');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it('supports phone identifiers (D-03 flexible identity)', async () => {
    const u = await users.findOne({ email: A.ownerEmail }, 'test');
    await users.updateOne({ _id: u!._id }, { $set: { phone: '+919812345678' } }, 'test');
    const c = new Client(app);
    expect((await c.login('98123 45678')).status).toBe(200);
  });

  it('gives the SAME generic response for unknown user, bad password and disabled user (no enumeration)', async () => {
    const c = new Client(app);
    const unknown = await c.login('nobody@nowhere.test');
    const bad = await c.login(A.ownerEmail, 'wrong-password-1');
    expect(unknown.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    expect(unknown.body.error.code).toBe(bad.body.error.code);
    await users.updateOne({ email: A.ownerEmail }, { $set: { status: 'disabled' } }, 'test');
    const disabled = await c.login(A.ownerEmail);
    expect(disabled.body.error.message).toBe(bad.body.error.message);
  });

  it('locks the account after repeated failures — even the right password is refused, then recovers', async () => {
    const c = new Client(app);
    for (let i = 0; i < 5; i++) await c.login(A.ownerEmail, 'wrong-password-1');
    const locked = await c.login(A.ownerEmail);
    expect(locked.status).toBe(401);
    expect(locked.body.error.message).toBe('Invalid credentials'); // same message: lock state not revealed
    await users.updateOne({ email: A.ownerEmail }, { $set: { lockedUntil: new Date(Date.now() - 1000) } }, 'test');
    expect((await c.login(A.ownerEmail)).status).toBe(200);
  });

  it('rejects NoSQL operator injection in the login body', async () => {
    const c = new Client(app);
    const r1 = await c.post('/auth/login', { identifier: { $ne: null }, password: { $ne: null } });
    expect(r1.status).toBe(400);
    const r2 = await c.post('/auth/login', { identifier: A.ownerEmail, password: TEST_PASSWORD, 'x.y': 1 });
    expect(r2.status).toBe(400);
  });

  it('rotates the session on login (old cookie dies)', async () => {
    const c = new Client(app);
    await c.login(A.ownerEmail);
    const before = await sessions.find({ revokedAt: null }, 'test');
    await c.login(A.ownerEmail); // same cookie jar presents the old session
    const live = await sessions.find({ revokedAt: null }, 'test');
    expect(before).toHaveLength(1);
    expect(live).toHaveLength(1);
    expect(String(live[0]!._id)).not.toBe(String(before[0]!._id));
  });
});

describe('REQ-AUTH session lifecycle', () => {
  it('logout invalidates the cookie immediately', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('logout-all revokes every device', async () => {
    const c1 = await loggedIn(app, A.ownerEmail);
    const c2 = await loggedIn(app, A.ownerEmail);
    expect((await c1.post('/auth/logout-all')).status).toBe(204);
    expect((await c2.get('/auth/me')).status).toBe(401);
  });

  it('idle timeout and absolute expiry end the session', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    await sessions.updateMany({}, { $set: { lastSeenAt: new Date(Date.now() - 9 * 3600_000) } }, 'test'); // idle > 8h default
    expect((await c.get('/auth/me')).status).toBe(401);
    const c2 = await loggedIn(app, A.ownerEmail);
    await sessions.updateMany({ revokedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } }, 'test');
    expect((await c2.get('/auth/me')).status).toBe(401);
  });

  it('a disabled user is cut off on the next request', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    await users.updateOne({ email: A.ownerEmail }, { $set: { status: 'disabled' } }, 'test');
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('lists and revokes only own sessions', async () => {
    const c1 = await loggedIn(app, A.ownerEmail);
    const c2 = await loggedIn(app, A.ownerEmail);
    const list = await c1.get('/auth/sessions');
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    expect((await c1.delete(`/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await c2.get('/auth/me')).status).toBe(401);
    await seedMember(A.schoolId, 'someone@alpha.test', ['teacher']);
    const stranger = await loggedIn(app, 'someone@alpha.test');
    expect((await stranger.delete(`/auth/sessions/${other.id}`)).status).toBe(404);
  });
});

describe('REQ-AUTH CSRF (ADR-1)', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    // the browser would attach the cookie automatically; only the custom header is missing
    const res = await c.agent.post('/api/v1/auth/logout').set('Origin', TEST_ORIGIN).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });
  it('rejects a foreign Origin even with the header and a valid cookie', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    const res = await c.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'Another-Pass-77' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
    expect((await c.login(A.ownerEmail)).status).toBe(200); // password unchanged
  });
  it('rejects Sec-Fetch-Site cross-site when Origin is absent', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('X-Requested-With', 'edunex').set('Sec-Fetch-Site', 'cross-site').send({ identifier: A.ownerEmail, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });
  it('rejects form-encoded bodies (what a cross-site <form> can send)', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Origin', TEST_ORIGIN).set('X-Requested-With', 'edunex').type('form').send({ identifier: A.ownerEmail, password: TEST_PASSWORD });
    expect(res.status).toBe(415);
  });
  it('login itself is CSRF-protected (login CSRF)', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Origin', 'https://evil.example').set('X-Requested-With', 'edunex').send({ identifier: A.ownerEmail, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('REQ-AUTH password reset & change', () => {
  it('reset link works once, revokes all sessions, and old password stops working', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    const res = await new Client(app).post('/auth/forgot-password', { identifier: A.ownerEmail });
    expect(res.status).toBe(202);
    const token = tokenFromEmail(A.ownerEmail)!;
    expect(token).toBeTruthy();
    const stored = await authTokens.find({}, 'test');
    expect(JSON.stringify(stored)).not.toContain(token); // hashed at rest
    const anon = new Client(app);
    expect((await anon.post('/auth/reset-password', { token, password: 'Brand-New-Pass-5' })).status).toBe(204);
    expect((await anon.post('/auth/reset-password', { token, password: 'Yet-Another-Pass-6' })).status).toBe(400); // single use
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await anon.login(A.ownerEmail, TEST_PASSWORD)).status).toBe(401);
    expect((await anon.login(A.ownerEmail, 'Brand-New-Pass-5')).status).toBe(200);
  });
  it('is silent for unknown accounts (no enumeration, no email)', async () => {
    const res = await new Client(app).post('/auth/forgot-password', { identifier: 'ghost@nowhere.test' });
    expect(res.status).toBe(202);
    expect(t.email.outbox).toHaveLength(0);
  });
  it('expired reset tokens are refused', async () => {
    await new Client(app).post('/auth/forgot-password', { identifier: A.ownerEmail });
    const token = tokenFromEmail(A.ownerEmail)!;
    await authTokens.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } }, 'test');
    expect((await new Client(app).post('/auth/reset-password', { token, password: 'Brand-New-Pass-5' })).status).toBe(400);
  });
  it('enforces the password policy', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    expect((await c.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await c.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'onlyletterslongpassword' })).status).toBe(400);
  });
  it('change-password needs the current password and revokes OTHER sessions only', async () => {
    const c1 = await loggedIn(app, A.ownerEmail);
    const c2 = await loggedIn(app, A.ownerEmail);
    expect((await c1.post('/auth/change-password', { currentPassword: 'wrong-password-1', newPassword: 'Another-Pass-77' })).status).toBe(400);
    expect((await c1.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'Another-Pass-77' })).status).toBe(204);
    expect((await c1.get('/auth/me')).status).toBe(200);
    expect((await c2.get('/auth/me')).status).toBe(401);
  });
});

describe('REQ-AUTH invitations', () => {
  it('owner invites a teacher; the invite is single-use; teacher logs in with the chosen password', async () => {
    const owner = await loggedIn(app, A.ownerEmail);
    const inv = await owner.post('/users/invite', { name: 'Tina Teacher', email: 'tina@alpha.test', roleKeys: ['teacher'] });
    expect(inv.status).toBe(201);
    const token = tokenFromEmail('tina@alpha.test')!;
    const anon = new Client(app);
    expect((await anon.login('tina@alpha.test', 'whatever-123')).status).toBe(401); // not yet active
    expect((await anon.post('/auth/accept-invite', { token, password: 'Tina-Secret-42' })).status).toBe(204);
    expect((await anon.post('/auth/accept-invite', { token, password: 'Tina-Secret-42' })).status).toBe(400);
    const login = await anon.login('tina@alpha.test', 'Tina-Secret-42');
    expect(login.status).toBe(200);
    expect(login.body.data.roleKeys).toEqual(['teacher']);
  });
});

describe('REQ-AUTH tenant switching & stale-tab protection', () => {
  it('multi-school user must choose a school; switching changes data and the stale tab gets 409', async () => {
    const B = await seedSchool('bravo');
    const multi = await seedMember(A.schoolId, 'multi@x.test', ['admin']);
    await seedMember(B.schoolId, 'multi@x.test', ['admin']);
    const c = new Client(app);
    const login = await c.login('multi@x.test');
    expect(login.body.data.activeMembershipId).toBeNull();
    expect(login.body.data.memberships).toHaveLength(2);
    expect((await c.get('/schools/me')).status).toBe(403); // no active school yet

    const mA = login.body.data.memberships.find((m: { schoolCode: string }) => m.schoolCode === 'alpha').membershipId;
    const mB = login.body.data.memberships.find((m: { schoolCode: string }) => m.schoolCode === 'bravo').membershipId;
    expect((await c.post('/auth/select-school', { membershipId: mA })).status).toBe(200);
    expect((await c.get('/schools/me', { 'X-Active-Membership': mA })).body.data.code).toBe('alpha');

    // "tab 2" switches to B (same cookie jar = same session)
    expect((await c.post('/auth/select-school', { membershipId: mB })).status).toBe(200);
    // "tab 1" still believes it is on A → must be refused, not silently served from B
    const stale = await c.get('/schools/me', { 'X-Active-Membership': mA });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('TENANT_CONTEXT_CHANGED');
    expect((await c.get('/schools/me', { 'X-Active-Membership': mB })).body.data.code).toBe('bravo');
    void multi;
  });
  it("cannot select someone else's membership", async () => {
    const B = await seedSchool('bravo');
    const c = await loggedIn(app, A.ownerEmail);
    expect((await c.post('/auth/select-school', { membershipId: String(B.ownerMembershipId) })).status).toBe(404);
  });
  it('a suspended school cuts access', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    const { schools } = await import('../src/modules/auth/auth.repository');
    await schools.updateOne({ _id: A.schoolId }, { $set: { status: 'suspended' } }, 'test');
    expect((await c.get('/schools/me')).status).toBe(403);
  });
});

describe('transport & hygiene', () => {
  it('sets security headers and no-store; hides stack traces; unknown route is JSON 404', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
  it('rejects malformed JSON cleanly', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Origin', TEST_ORIGIN).set('X-Requested-With', 'edunex').set('Content-Type', 'application/json').send('{"identifier": ');
    expect(res.status).toBe(400);
  });
  it('health endpoints work without auth', async () => {
    expect((await request(app).get('/health/live')).body.status).toBe('ok');
    expect((await request(app).get('/health/ready')).body.status).toBe('ready');
  });
});
