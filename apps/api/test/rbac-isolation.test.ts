import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isPermissionKey } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, seedMember, seedSchool, type SeededSchool } from './helpers/app';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { memberships, sessions } from '../src/modules/auth/auth.repository';
import mongoose, { Types } from 'mongoose';
import { buildSchoolData, todayIst, type SchoolData } from './helpers/fixtures';
import { modelRegistry } from '../src/core/tenancy/registry';
import { runAsPlatform } from '../src/core/tenancy/context';
import { AttendanceCorrectionModel } from '../src/modules/attendance/attendance.model';
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

describe("REQ-TEN isolation harness v2 — every school route attacked with the other tenant's identity", () => {
  /** Request shapes that pass validation, so the attack reaches the handler and the 404 is the TENANT answer. */
  const specs = (bd: SchoolData): Record<string, { body?: object; query?: string }> => ({
    'patch /academics/sessions/:id': { body: { name: 'Hack' } }, 'post /academics/sessions/:id/activate': {}, 'post /academics/sessions/:id/close': {},
    'patch /classes/:id': { body: { name: 'x' } }, 'delete /classes/:id': {}, 'patch /sections/:id': { body: { name: 'x' } }, 'delete /sections/:id': {},
    'delete /subjects/:id': {}, 'delete /academics/teacher-assignments/:id': {}, 'delete /academics/calendar/events/:id': {},
    'get /staff/:id': {}, 'patch /staff/:id': { body: { name: 'x' } }, 'post /staff/:id/status': { body: { status: 'on_leave' } },
    'get /students/:id': {}, 'patch /students/:id': { body: { firstName: 'x' } }, 'post /students/:id/status': { body: { status: 'withdrawn' } },
    'get /students/:id/guardians': {}, 'post /students/:id/guardians': { body: { name: 'g', phone: '9000000000', relationship: 'father' } },
    'patch /students/:id/guardians/:linkId': { body: { verified: true } }, 'get /academics/sections/:id/roster': {},
    'get /attendance/sections/:sectionId': { query: `?date=${todayIst()}` },
    'put /attendance/sections/:sectionId': { body: { date: todayIst(), entries: [{ studentId: bd.studentsA[0], status: 'present' }] } },
    'get /attendance/students/:studentId': { query: `?from=${todayIst()}&to=${todayIst()}` },
    'post /attendance/corrections/:id/approve': { body: {} }, 'post /attendance/corrections/:id/reject': { body: {} },
    'patch /users/:membershipId': { body: { status: 'suspended' } },
  });

  const snapshotSchool = async (schoolId: Types.ObjectId) => {
    const out: Record<string, unknown[]> = {};
    for (const [name, info] of modelRegistry) {
      if (info.kind !== 'tenant') continue;
      out[name] = await runAsPlatform('test: snapshot', async () => await mongoose.models[name]!.find({ schoolId }).sort({ _id: 1 }).lean());
    }
    return JSON.stringify(out);
  };

  async function twoSchools() {
    const HA = await buildSchoolData(app, 'harna');
    const HB = await buildSchoolData(app, 'harnb');
    const bCorrection = await runAsPlatform('test: B correction', async () =>
      AttendanceCorrectionModel.create({ schoolId: HB.school.schoolId, studentId: new Types.ObjectId(HB.studentsA[0]), sectionId: new Types.ObjectId(HB.sectionA), date: '2026-01-05', to: 'present', reason: 'fixture', requestedBy: new Types.ObjectId(), status: 'pending' }));
    const fx: Record<string, string> = {
      session: HB.sessionId, class: HB.classId, section: HB.sectionA, subject: HB.subjectId, assignment: HB.assignmentId, event: HB.eventId,
      staff: HB.teacherStaffId, student: HB.studentsA[0]!, guardian_link: HB.guardianLinkId, correction: String(bCorrection._id), membership: String(HB.teacherMembershipId),
    };
    return { HA, HB, fx };
  }

  it("every id-bearing route returns 404 for School B ids, and School B's data is byte-for-byte unchanged", async () => {
    const { HA, HB, fx } = await twoSchools();
    const sp = specs(HB);
    const routes = registrar.manifest.filter((m) => m.tenancy === 'school' && m.idParams);
    expect(routes.length).toBeGreaterThan(25);
    const before = await snapshotSchool(HB.school.schoolId);
    for (const m of routes) {
      const key = `${m.method} ${m.path.replace('/api/v1', '')}`;
      const spec = sp[key];
      if (!spec) throw new Error(`Isolation harness has no attack spec for "${key}" — add one so the route is covered`);
      const path = m.path.replace('/api/v1', '').replace(/:(\w+)/g, (_s, p: string) => {
        const kind = m.idParams![p];
        if (!kind || !fx[kind]) throw new Error(`Isolation harness has no fixture for resource kind "${kind}" (${key}) — add one`);
        return fx[kind]!;
      });
      const res = await (HA.owner as unknown as Record<string, (p: string, b?: unknown) => Promise<{ status: number }>>)[m.method]!(`${path}${spec.query ?? ''}`, spec.body ?? {});
      expect(res.status, `${key} with a School B id`).toBe(404);
    }
    expect(await snapshotSchool(HB.school.schoolId)).toBe(before);
  });

  it("every collection route returns only the caller's own rows (no School B id appears anywhere)", async () => {
    const { HA, HB } = await twoSchools();
    const bIds = [HB.sessionId, HB.classId, HB.sectionA, HB.sectionB, HB.subjectId, HB.teacherStaffId, HB.assignmentId, HB.eventId, HB.guardianLinkId, ...HB.studentsA, ...HB.studentsB, String(HB.school.schoolId), String(HB.teacherMembershipId)];
    const routes = registrar.manifest.filter((m) => m.method === 'get' && m.tenancy === 'school' && !m.path.includes(':'));
    const queries: Record<string, string> = { '/attendance/reports/monthly': `?sectionId=${HA.sectionA}&month=${todayIst().slice(0, 7)}` };
    let checked = 0;
    for (const m of routes) {
      const p = m.path.replace('/api/v1', '');
      const res = await HA.owner.get(`${p}${queries[p] ?? ''}`);
      if (res.status === 400) continue; // route needs params we did not supply (covered by the id-route attack)
      expect(res.status, p).toBe(200);
      const text = JSON.stringify(res.body);
      for (const id of bIds) expect(text.includes(id), `${p} leaked School B id ${id}`).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    expect((await HA.owner.get('/students')).body.meta.total).toBe(6);
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
