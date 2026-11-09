import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isPermissionKey } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, seedMember, seedSchool, type SeededSchool } from './helpers/app';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { memberships, sessions } from '../src/modules/auth/auth.repository';
import type { ManifestEntry } from '../src/core/http/route';

const t = makeTestApp();
const { app, registrar } = t;
let A: SeededSchool;
let B: SeededSchool;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  t.email.outbox.length = 0;
  A = await seedSchool('alpha');
  B = await seedSchool('bravo');
});

describe('REQ-RBAC route manifest (deny-by-default, doc 06 lock 4)', () => {
  const manifest: ManifestEntry[] = registrar.manifest;

  it('registers routes and has no duplicates', () => {
    expect(manifest.length).toBeGreaterThan(15);
    const keys = manifest.map((m) => `${m.method} ${m.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every school route declares a valid permission or anyMember; platform routes declare roles', () => {
    for (const m of manifest) {
      if (m.tenancy === 'school') {
        expect(m.permission || m.anyMember, `${m.method} ${m.path}`).toBeTruthy();
        if (m.permission) expect(isPermissionKey(m.permission), `${m.permission}`).toBe(true);
        expect(m.auth).toBe('session');
      }
      if (m.tenancy === 'platform') expect(m.platformRoles?.length).toBeGreaterThan(0);
    }
  });
  it('every mutating route states audit:true or an explicit exemption reason; strict body schema present', () => {
    for (const m of manifest.filter((x) => x.mutating)) {
      expect(m.audit, `${m.method} ${m.path} lacks audit declaration`).toBeTruthy();
      if (typeof m.audit === 'object') expect(m.audit.exempt.length).toBeGreaterThan(10);
      if (m.method !== 'delete') expect(m.hasBody, `${m.method} ${m.path} needs a body schema`).toBe(true);
    }
  });
  it('only public routes are in the auth namespace and tenant-less', () => {
    for (const m of manifest.filter((x) => x.auth === 'public')) {
      expect(m.tenancy).toBe('none');
      expect(m.path.startsWith('/api/v1/auth/')).toBe(true);
    }
  });
  it('unauthenticated callers get 401 on every non-public route', async () => {
    const anon = new Client(app);
    for (const m of manifest.filter((x) => x.auth === 'session')) {
      const path = m.path.replace('/api/v1', '').replace(/:(\w+)/g, '64b64b64b64b64b64b64b64b');
      const res = await (anon as unknown as Record<string, (p: string, b?: unknown) => Promise<{ status: number }>>)[m.method]!(path, {});
      expect(res.status, `${m.method.toUpperCase()} ${m.path}`).toBe(401);
    }
  });
});

describe('REQ-TEN isolation harness v1 — every school route attacked with the other tenant\'s identity', () => {
  /** Fixture ids belonging to SCHOOL B, by resource kind. Add a kind here when a module introduces one. */
  const fixtures = async (): Promise<Record<string, string>> => {
    const bTeacher = await seedMember(B.schoolId, 'teacher@bravo.test', ['teacher']);
    return { membership: String(bTeacher.membershipId) };
  };

  it('every id-bearing route returns 404 for School B ids and changes nothing', async () => {
    const fx = await fixtures();
    const ownerA = await loggedIn(app, A.ownerEmail);
    const manifest = registrar.manifest.filter((m) => m.tenancy === 'school' && m.idParams);
    expect(manifest.length).toBeGreaterThan(0);
    const before = await memberships.find({ schoolId: B.schoolId }, 'test snapshot');
    for (const m of manifest) {
      const path = m.path.replace('/api/v1', '').replace(/:(\w+)/g, (_s, p: string) => {
        const kind = m.idParams![p];
        if (!kind || !fx[kind]) throw new Error(`Isolation harness has no fixture for resource kind "${kind}" (${m.method} ${m.path}) — add one`);
        return fx[kind]!;
      });
      const body = m.method === 'patch' ? { status: 'suspended' } : {};
      const res = await (ownerA as unknown as Record<string, (p: string, b?: unknown) => Promise<{ status: number }>>)[m.method]!(path, body);
      expect(res.status, `${m.method.toUpperCase()} ${m.path} with a School B id`).toBe(404);
    }
    const after = await memberships.find({ schoolId: B.schoolId }, 'test snapshot');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('lists never leak across schools and totals count only own rows', async () => {
    await seedMember(B.schoolId, 'teacher@bravo.test', ['teacher']);
    await seedMember(A.schoolId, 'teacher@alpha.test', ['teacher']);
    const ownerA = await loggedIn(app, A.ownerEmail);
    const res = await ownerA.get('/users');
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.map((u: { email: string }) => u.email).sort()).toEqual(['owner@alpha.test', 'teacher@alpha.test']);
    const audit = await ownerA.get('/audit-logs');
    for (const row of audit.body.data) expect(row.entityId === undefined || typeof row.entityId === 'string').toBe(true);
  });

  it('payload schoolId is rejected (strict schemas), never trusted', async () => {
    const ownerA = await loggedIn(app, A.ownerEmail);
    const res = await ownerA.patch('/schools/me', { name: 'Hacked', schoolId: String(B.schoolId) });
    expect(res.status).toBe(400);
    const res2 = await ownerA.post('/users/invite', { name: 'X', email: 'x@y.test', roleKeys: ['teacher'], schoolId: String(B.schoolId) });
    expect(res2.status).toBe(400);
    const res3 = await ownerA.get(`/users?schoolId=${B.schoolId}`);
    expect(res3.status).toBe(400);
  });

  it("a user from school A with no membership in B cannot switch into B or read B's data", async () => {
    const ownerA = await loggedIn(app, A.ownerEmail);
    expect((await ownerA.post('/auth/select-school', { membershipId: String(B.ownerMembershipId) })).status).toBe(404);
    expect((await ownerA.get('/schools/me')).body.data.code).toBe('alpha');
  });

  it('a membership ended/suspended mid-session loses access on the very next request', async () => {
    const tina = await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const c = await loggedIn(app, 'tina@alpha.test');
    expect((await c.get('/schools/me')).status).toBe(200);
    await memberships.updateOne({ _id: tina.membershipId }, { $set: { status: 'suspended' } }, 'test');
    expect((await c.get('/schools/me')).status).toBe(403);
  });
});

describe('REQ-RBAC permissions, escalation and owner protection', () => {
  it('a teacher cannot invite, list users, read the audit log or change school settings', async () => {
    await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const c = await loggedIn(app, 'tina@alpha.test');
    expect((await c.get('/users')).status).toBe(403);
    expect((await c.post('/users/invite', { name: 'X', email: 'x@alpha.test', roleKeys: ['teacher'] })).status).toBe(403);
    expect((await c.get('/audit-logs')).status).toBe(403);
    expect((await c.patch('/schools/me/settings', { themeColor: '#112233' })).status).toBe(403);
    expect((await c.get('/schools/me')).status).toBe(200); // anyMember
  });

  it('an admin can invite staff but cannot grant Owner, Accountant (finance) or any role above their own permissions', async () => {
    await seedMember(A.schoolId, 'ada@alpha.test', ['admin']);
    const c = await loggedIn(app, 'ada@alpha.test');
    expect((await c.post('/users/invite', { name: 'T', email: 't@alpha.test', roleKeys: ['teacher'] })).status).toBe(201);
    expect((await c.post('/users/invite', { name: 'O', email: 'o@alpha.test', roleKeys: ['owner'] })).status).toBe(403);
    expect((await c.post('/users/invite', { name: 'F', email: 'f@alpha.test', roleKeys: ['accountant'] })).status).toBe(403);
    expect((await c.post('/users/invite', { name: 'P', email: 'p@alpha.test', roleKeys: ['parent'] })).status).toBe(400); // not a staff role
  });

  it('nobody can change their own roles/status', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    expect((await c.patch(`/users/${A.ownerMembershipId}`, { status: 'suspended' })).status).toBe(403);
    expect((await c.patch(`/users/${A.ownerMembershipId}`, { roleKeys: ['teacher'] })).status).toBe(403);
  });

  it('only an Owner may demote or suspend an Owner (an Admin cannot, even with users:update)', async () => {
    await seedMember(A.schoolId, 'ada@alpha.test', ['admin']);
    const ada = await loggedIn(app, 'ada@alpha.test');
    expect((await ada.patch(`/users/${A.ownerMembershipId}`, { status: 'suspended' })).status).toBe(403);
    expect((await ada.patch(`/users/${A.ownerMembershipId}`, { roleKeys: ['admin'] })).status).toBe(403);
    const o2 = await seedMember(A.schoolId, 'owner2@alpha.test', ['owner'], { personType: 'owner' });
    const owner = await loggedIn(app, A.ownerEmail);
    expect((await owner.patch(`/users/${o2.membershipId}`, { roleKeys: ['admin'] })).status).toBe(200); // owners may demote owners
    // the owner row is untouched by the failed attempts
    const [row] = await memberships.find({ _id: A.ownerMembershipId }, 'test');
    expect(row!.roleKeys).toEqual(['owner']);
    expect(row!.status).toBe('active');
  });

  it('suspending a member revokes their sessions at once; role changes also bite immediately', async () => {
    const tina = await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const tinaC = await loggedIn(app, 'tina@alpha.test');
    const owner = await loggedIn(app, A.ownerEmail);
    expect((await owner.patch(`/users/${tina.membershipId}`, { status: 'suspended' })).status).toBe(200);
    expect((await tinaC.get('/schools/me')).status).toBe(401);
    const live = await sessions.find({ userId: tina.userId, revokedAt: null }, 'test');
    expect(live).toHaveLength(0);
  });

  it('optimistic locking on membership edits returns 409 for stale versions', async () => {
    const tina = await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const owner = await loggedIn(app, A.ownerEmail);
    const list = await owner.get('/users');
    const row = list.body.data.find((u: { email: string }) => u.email === 'tina@alpha.test');
    expect((await owner.patch(`/users/${tina.membershipId}`, { roleKeys: ['class_teacher'], version: row.version })).status).toBe(200);
    expect((await owner.patch(`/users/${tina.membershipId}`, { roleKeys: ['teacher'], version: row.version })).status).toBe(409);
  });

  it('staff limits (entitlement-lite) block invites beyond the plan, existing data stays readable', async () => {
    const S = await seedSchool('tiny', { limits: { students: 10, staff: 2 } });
    const owner = await loggedIn(app, S.ownerEmail);
    expect((await owner.post('/users/invite', { name: 'T1', email: 't1@tiny.test', roleKeys: ['teacher'] })).status).toBe(201);
    const over = await owner.post('/users/invite', { name: 'T2', email: 't2@tiny.test', roleKeys: ['teacher'] });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('ENTITLEMENT_REQUIRED');
    expect((await owner.get('/users')).status).toBe(200);
  });
});

describe('REQ-AUD audit trail', () => {
  it('audited writes always leave a row with actor, school and request id; secrets are redacted; reads are school-scoped', async () => {
    const owner = await loggedIn(app, A.ownerEmail);
    await owner.post('/users/invite', { name: 'T', email: 't@alpha.test', roleKeys: ['teacher'] });
    await owner.patch('/schools/me', { name: 'Alpha Public School' });
    const rows = await _auditRowsForTest({ schoolId: A.schoolId });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('users.invited');
    expect(actions).toContain('school.profile_updated');
    expect(actions).toContain('auth.login');
    const invited = rows.find((r) => r.action === 'users.invited')!;
    expect(String(invited.actorUserId)).toBeTruthy();
    expect(invited.requestId).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(/password|tokenHash|\$argon2/i);

    const bOwner = await loggedIn(app, B.ownerEmail);
    const bLog = await bOwner.get('/audit-logs');
    expect(bLog.body.data.some((r: { action: string }) => r.action === 'users.invited')).toBe(false);
  });
});
